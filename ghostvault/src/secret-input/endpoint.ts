import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { SecretInputAccess } from './access.js';
import { SecretInputManager } from './manager.js';
import { SecretInputError } from './errors.js';
import { inputRequestSchema, SecretInputView } from './schema.js';

const sessionSchema = z.object({ requestId: z.string().uuid().optional() }).strict();
const paramsSchema = z.object({ id: z.string().uuid() });

export class SecretInputEndpoint {
  private access = new SecretInputAccess();
  private closed = false;
  private closing?: Promise<void>;
  private creating = new WeakMap<object, { fingerprint: string; task: Promise<SecretInputView> }>();
  constructor(private app: FastifyInstance, private manager: SecretInputManager) {}

  public register = (): void => {
    this.app.decorate('secretInput', this.manager);
    this.app.decorate('secretInputEndpoint', this as SecretInputEndpoint);
    this.app.register(async scope => {
      scope.addHook('onRequest', async (request, reply) => {
        reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-content-type-options', 'nosniff');
        if (!this.access.allowed(request)) return this.error(reply, new SecretInputError('INPUT_FORBIDDEN'));
        if (this.closed) return this.error(reply, new SecretInputError('INPUT_STOPPING'));
      });
      scope.setErrorHandler((error, _request, reply) => {
        const code = (error as { code?: string }).code;
        return this.error(reply, code?.startsWith('FST_ERR_') || error instanceof z.ZodError ? new SecretInputError('INVALID_INPUT') : error);
      });
      scope.post('/session', { bodyLimit: 262144, logLevel: 'silent' }, (request, reply) => {
        const { requestId } = sessionSchema.parse(request.body);
        const view = requestId ? this.manager.status(requestId) : undefined;
        return reply.send({ ...this.access.issue(requestId), ...(view ? { request: view } : {}) });
      });
      scope.post('/requests', { bodyLimit: 262144, logLevel: 'silent' }, this.create);
      scope.get('/requests/:id', { logLevel: 'silent', exposeHeadRoute: false }, (request, reply) => {
        const id = this.requestId(request);
        return reply.send(this.manager.status(id));
      });
      scope.post('/requests/:id/cancel', { bodyLimit: 262144, logLevel: 'silent' }, (request, reply) => {
        const id = this.requestId(request);
        z.object({}).strict().parse(request.body);
        return reply.send(this.manager.cancel(id));
      });
      scope.post('/requests/:id/submit', { bodyLimit: 262144, logLevel: 'silent' }, async (request, reply) => {
        const id = this.requestId(request);
        const view = await this.manager.submit(id, request.body);
        if (view.state === 'failed') {
          const error = new SecretInputError(view.error!.code);
          return reply.code(error.status).send({ error: error.public(), request: view });
        }
        return reply.send(view);
      });
      scope.addHook('onClose', this.close);
    }, { prefix: '/api/secret-input' });
  };

  public close = (): Promise<void> => {
    this.closed = true;
    this.access.clear();
    this.closing ??= this.manager.close();
    return this.closing;
  };

  private create = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const grant = this.access.authorize(request.headers.authorization);
    if (!grant) throw new SecretInputError('INPUT_FORBIDDEN');
    const input = inputRequestSchema.parse(request.body);
    if (grant.requestId && grant.idempotencyKey !== input.idempotencyKey) throw new SecretInputError('INPUT_FORBIDDEN');
    const fingerprint = JSON.stringify([input.idempotencyKey, input.operation, [...input.names].sort()]);
    const existing = this.creating.get(grant);
    if (existing && existing.fingerprint !== fingerprint) throw new SecretInputError('REQUEST_CONFLICT');
    const task = existing?.task ?? this.manager.request(input);
    this.creating.set(grant, { fingerprint, task });
    try {
      const view = await task;
      if (grant.requestId && grant.requestId !== view.requestId) throw new SecretInputError('INPUT_FORBIDDEN');
      grant.requestId = view.requestId;
      grant.idempotencyKey = input.idempotencyKey;
      await reply.send(view);
    } finally { this.creating.delete(grant); }
  };

  private requestId = (request: FastifyRequest): string => {
    const { id } = paramsSchema.parse(request.params);
    if (!this.access.authorize(request.headers.authorization, id)) throw new SecretInputError('INPUT_FORBIDDEN');
    return id;
  };
  private error = (reply: FastifyReply, error: unknown): FastifyReply => {
    const safe = SecretInputError.safe(error);
    return reply.code(safe.status).send({ error: safe.public() });
  };
}
