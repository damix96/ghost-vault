import { randomUUID } from 'node:crypto';
import { SecretInputBrowser } from './browser-launcher.js';
import { SecretInputError } from './errors.js';
import { inputNotice, inputRequestSchema, inputSubmitSchema, inputViewSchema, InputRevision, SecretInputStorage, SecretInputView } from './schema.js';

interface PendingInput { view: SecretInputView; revisions: InputRevision[]; key: string; fingerprint: string; submissionId?: string; finishedAt?: number }

export class SecretInputManager {
  private requests = new Map<string, PendingInput>();
  private keys = new Map<string, string>();
  private commits = new Set<Promise<SecretInputView>>();
  private stopping = false;
  constructor(private storage: SecretInputStorage, private browser = new SecretInputBrowser(), private now = Date.now) {}

  public request = async (raw: unknown, origin?: string): Promise<SecretInputView> => {
    this.admit();
    const parsed = inputRequestSchema.safeParse(raw);
    if (!parsed.success) throw new SecretInputError('INVALID_INPUT');
    const input = parsed.data;
    this.prune();
    const fingerprint = JSON.stringify([input.operation, [...input.names].sort()]);
    const previous = this.keys.get(input.idempotencyKey);
    if (previous) {
      const request = this.find(previous);
      if (request.fingerprint !== fingerprint) throw new SecretInputError('REQUEST_CONFLICT');
      return this.project(request);
    }
    if (this.requests.size >= 128) throw new SecretInputError('INPUT_BUSY');
    for (const request of this.requests.values()) {
      if (['awaiting_input', 'committing'].includes(request.view.state) && request.view.names.some(name => input.names.includes(name))) throw new SecretInputError('NAME_CONFLICT');
    }
    const revisions = this.storage.inspect(input.operation, input.names);
    const requestId = randomUUID();
    const request: PendingInput = { key: input.idempotencyKey, fingerprint, revisions, view: { requestId, operation: input.operation, names: input.names, state: 'awaiting_input', expiresAt: this.now() + 600_000, launch: 'not_requested' } };
    this.requests.set(requestId, request);
    this.keys.set(input.idempotencyKey, requestId);
    if (origin) {
      const address = new URL('/vault-secret/' + input.operation, origin);
      address.searchParams.set('secrets', input.names.join(','));
      address.searchParams.set('request', requestId);
      request.view.launch = await this.browser.open(address);
    }
    return this.project(request);
  };

  public status = (requestId: string): SecretInputView => this.project(this.find(requestId));

  public cancel = (requestId: string): SecretInputView => {
    const request = this.find(requestId);
    if (request.view.state === 'committing') throw new SecretInputError('COMMIT_IN_PROGRESS');
    if (request.view.state === 'awaiting_input') this.finish(request, 'cancelled');
    return this.project(request);
  };

  public submit = (requestId: string, raw: unknown): Promise<SecretInputView> => {
    this.admit();
    const request = this.find(requestId);
    const parsed = inputSubmitSchema.safeParse(raw);
    if (!parsed.success) throw new SecretInputError('INVALID_INPUT');
    const input = parsed.data;
    if (request.view.state === 'completed' && request.submissionId === input.submissionId) return Promise.resolve(this.project(request));
    if (request.view.state === 'committing') throw new SecretInputError('COMMIT_IN_PROGRESS');
    if (request.view.state === 'expired') throw new SecretInputError('REQUEST_EXPIRED');
    if (request.view.state !== 'awaiting_input') throw new SecretInputError('REQUEST_CLOSED');
    const values = new Map(input.values.map(entry => [entry.name, entry.value]));
    if (values.size !== input.values.length || values.size !== request.view.names.length || request.view.names.some(name => !values.has(name))) throw new SecretInputError('REQUEST_CONFLICT');
    request.submissionId = input.submissionId;
    request.view.state = 'committing';
    const task = this.commit(request, values);
    this.commits.add(task);
    void task.then(() => this.commits.delete(task), () => this.commits.delete(task));
    return task;
  };

  public close = async (): Promise<void> => {
    this.stopping = true;
    for (const request of this.requests.values()) if (request.view.state === 'awaiting_input') this.finish(request, 'cancelled');
    await Promise.allSettled([...this.commits]);
  };

  private commit = async (request: PendingInput, values: Map<string, string>): Promise<SecretInputView> => {
    try {
      const receipt = await this.storage.commit(request.view.operation, request.revisions.map(entry => ({ ...entry, value: values.get(entry.name)! })), request.view.requestId);
      request.view.result = receipt.variables.map(entry => ({ name: entry.name, token: entry.token }));
      if (receipt.notice) request.view.notice = { ...inputNotice };
      this.finish(request, 'completed');
    } catch (error) {
      request.view.error = SecretInputError.safe(error).public();
      this.finish(request, 'failed');
    } finally { values.clear(); }
    return this.project(request);
  };

  private admit = (): void => { if (this.stopping) throw new SecretInputError('INPUT_STOPPING'); };
  private project = (request: PendingInput): SecretInputView => inputViewSchema.parse(request.view);
  private finish = (request: PendingInput, state: SecretInputView['state']): void => { request.view.state = state; request.finishedAt = this.now(); request.revisions = []; };
  private find = (requestId: string): PendingInput => {
    this.prune();
    const request = this.requests.get(requestId);
    if (!request) throw new SecretInputError('REQUEST_NOT_FOUND');
    return request;
  };
  private prune = (): void => {
    for (const [id, request] of this.requests) {
      if (request.view.state === 'awaiting_input' && request.view.expiresAt <= this.now()) this.finish(request, 'expired');
      if (request.finishedAt !== undefined && request.finishedAt + 600_000 <= this.now()) { this.requests.delete(id); this.keys.delete(request.key); }
    }
  };
}
