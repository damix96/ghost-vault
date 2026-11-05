import type { FastifyInstance } from 'fastify';
import { SecretInputAccess } from './access.js';

export class SecretInputPages {
  private access = new SecretInputAccess();
  constructor(private app: FastifyInstance) {}

  public register = (): void => {
    for (const url of ['/vault-secret/new', '/vault-secret/update']) this.app.get(url, { logLevel: 'silent', exposeHeadRoute: false }, async (request, reply) => {
      reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer').header('x-frame-options', 'DENY').header('x-content-type-options', 'nosniff');
      if (!this.access.allowed(request)) return reply.code(403).send({ error: 'Local input page access denied' });
      return reply.sendFile('index.html', { cacheControl: false, etag: false, lastModified: false });
    });
  };
}
