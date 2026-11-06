import { FastifyInstance, FastifyRequest } from 'fastify';
import { VaultStore } from '../vault/store.js';
import { RuntimeSessions } from './runtime-sessions.js';
import { ResponseNormalizer } from './response-normalizer.js';
import { ProtectedEvents } from '../secret-input/protected-events.js';

export class InterfaceApi {
  private approved = new WeakSet<FastifyRequest>();

  constructor(private app: FastifyInstance, private vault: VaultStore, private runtime: RuntimeSessions, private events: ProtectedEvents) {}

  public original = (request: FastifyRequest): boolean => this.approved.has(request);

  private authorize = async (request: FastifyRequest): Promise<void> => {
    const origin = request.protocol + '://' + request.headers.host;
    const stream = request.method === 'GET';
    const valid = stream ? request.headers['sec-fetch-site'] === 'same-origin' : request.headers.origin === origin && request.headers['x-ghostvault-display'] === 'original';
    if (!valid) throw Object.assign(new Error('Original values require an explicit same-origin interface request'), { statusCode: 403 });
    this.approved.add(request);
  };

  public register = (): void => {
    const options = { preHandler: this.authorize };
    this.app.post('/api/interface/vault', options, async (_, reply) => {
      reply.header('cache-control', 'no-store');
      const manual = this.vault.getManualSecrets().map(entry => ({ ...entry, isSecret: Boolean(entry.isSecret) }));
      const auto = this.vault.getAutoSecrets().map(entry => ({ ...entry, isSecret: Boolean(entry.isSecret) }));
      return { manual, auto, manualSecrets: manual, autoSecrets: auto, retention: this.vault.getRetention() };
    });
    this.app.post<{ Params: { id: string } }>('/api/interface/sessions/:id', options, async (request, reply) => {
      reply.header('cache-control', 'no-store');
      return this.runtime.display(request.params.id).map(record => ({ ...record, response: record.response ? { ...record.response, body: ResponseNormalizer.normalize(record.response.body) } : undefined }));
    });
    this.app.get('/api/interface/events', options, async (_, reply) => this.events.subscribeOriginal(reply));
  };
}
