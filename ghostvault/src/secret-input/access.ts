import { randomBytes } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

interface FormGrant { expiresAt: number; requestId?: string; idempotencyKey?: string }

export class SecretInputAccess {
  private grants = new Map<string, FormGrant>();
  constructor(private now = Date.now) {}

  public allowed = (request: FastifyRequest): boolean => {
    const socket = request.raw.socket;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(socket.remoteAddress || '')) return false;
    if (!/^(localhost|127\.0\.0\.1|\[::1\])(?::[0-9]+)?$/i.test(request.headers.host || '')) return false;
    try {
      const address = new URL('http://' + request.headers.host);
      if (Number(address.port || 80) !== socket.localPort) return false;
      const site = request.headers['sec-fetch-site'];
      if (site && site !== 'same-origin' && site !== 'none') return false;
      const origin = request.headers.origin;
      if (origin !== undefined && origin !== address.origin) return false;
      if (request.method === 'GET') return true;
      return origin === address.origin && request.headers['x-ghostvault-input'] === '1' && /^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] || '');
    } catch { return false; }
  };

  public issue = (requestId?: string): { formToken: string; expiresAt: number } => {
    for (const [token, grant] of this.grants) if (grant.expiresAt <= this.now()) this.grants.delete(token);
    if (this.grants.size >= 128) throw Object.assign(new Error('Too many input forms'), { code: 'INPUT_BUSY' });
    const formToken = randomBytes(32).toString('base64url');
    const expiresAt = this.now() + 600_000;
    this.grants.set(formToken, { expiresAt, requestId });
    return { formToken, expiresAt };
  };

  public authorize = (authorization: string | undefined, requestId?: string): FormGrant | undefined => {
    if (!authorization?.startsWith('Intake ')) return undefined;
    const grant = this.grants.get(authorization.slice(7));
    return grant && grant.expiresAt > this.now() && (!requestId || grant.requestId === requestId) ? grant : undefined;
  };

  public clear = (): void => this.grants.clear();
}
