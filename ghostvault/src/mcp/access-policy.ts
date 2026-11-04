import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

export class McpAccessPolicy {
  constructor(private mcpToken: string) {
    if (!mcpToken) throw new Error('MCP access token is required');
  }

  public allowed = (request: FastifyRequest): boolean => {
    const remote = request.raw.socket.remoteAddress;
    if (!remote || !['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) return false;
    const host = request.headers.host;
    if (!host || !/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(host)) return false;
    try {
      const address = new URL(request.protocol + '://' + host);
      const port = Number(address.port || (address.protocol === 'https:' ? 443 : 80));
      if (port !== request.raw.socket.localPort) return false;
      if (request.headers.origin !== undefined) return false;
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return false;
      const actual = Buffer.from(request.headers.authorization || '');
      const expected = Buffer.from('Bearer ' + this.mcpToken);
      return actual.length === expected.length && timingSafeEqual(actual, expected);
    } catch {
      return false;
    }
  };
}
