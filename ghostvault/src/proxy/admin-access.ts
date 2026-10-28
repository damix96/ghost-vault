import { FastifyInstance, FastifyRequest } from 'fastify';

export class AdminAccess {
  constructor(private host: string) {}

  public install = (app: FastifyInstance): void => {
    app.addHook('onRequest', async (request, reply) => {
      if (request.url.split('?')[0].startsWith('/api/') && !this.allowed(request)) {
        await reply.code(403).send({ error: 'Administrative API accepts requests from its own origin only' });
      }
    });
  };

  public cors = (request: FastifyRequest, callback: (error: null, options: { origin: boolean | string }) => void): void => {
    callback(null, { origin: request.url.split('?')[0].startsWith('/api/') ? request.headers.origin || false : true });
  };

  private allowed = (request: FastifyRequest): boolean => {
    try {
      const address = new URL(request.protocol + '://' + request.headers.host);
      const localAddress = request.raw.socket.localAddress?.replace(/^::ffff:/, '');
      const allowedHosts = new Set(['localhost', '127.0.0.1', '[::1]', this.host, localAddress]);
      if (!allowedHosts.has(address.hostname) || address.username || address.password || address.pathname !== '/' || address.search || address.hash) return false;
      const port = Number(address.port || (address.protocol === 'https:' ? 443 : 80));
      if (request.raw.socket.localPort && port !== request.raw.socket.localPort) return false;
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return false;
      const origin = request.headers.origin;
      if (!origin) return true;
      const source = new URL(origin);
      return origin === source.origin && source.origin === address.origin;
    } catch { return false; }
  };
}
