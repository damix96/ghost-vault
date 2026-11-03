import { createServer, IncomingMessage, ServerResponse } from 'node:http';
import { RuntimeIdentity, RuntimeProof } from './identity.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeDeadline } from './deadline.js';

export class RuntimeListener {
  private server = createServer((request, response) => this.dispatch(request, response));
  private handler?: (request: IncomingMessage, response: ServerResponse) => void;
  private active = new Set<ServerResponse>();
  private waiters = new Set<() => void>();

  constructor(private settings: RuntimeSettings, private identity: RuntimeIdentity, private controlToken: string, private shutdown: () => Promise<void>) {
    this.server.headersTimeout = 10000;
    this.server.requestTimeout = 30000;
  }

  public claim = async (): Promise<void> => new Promise((resolve, reject) => {
    this.server.once('error', reject);
    this.server.listen({ host: this.settings.host, port: this.settings.port, exclusive: true }, () => {
      this.server.off('error', reject);
      resolve();
    });
  });

  public route = (handler: (request: IncomingMessage, response: ServerResponse) => void): void => { this.handler = handler; };
  public drain = async (timeoutMs = 5000): Promise<void> => {
    if (this.active.size === 0) return;
    let done = (): void => {};
    const task = new Promise<void>(resolve => { done = resolve; this.waiters.add(done); });
    try { await RuntimeDeadline.wait(task, timeoutMs); }
    finally { this.waiters.delete(done); }
  };
  public abortRequests = (): void => { for (const response of this.active) response.destroy(); };
  public close = async (): Promise<void> => {
    if (!this.server.listening) return;
    await new Promise<void>((resolve, reject) => {
      this.server.close(error => error ? reject(error) : resolve());
      this.server.closeAllConnections();
    });
  };

  private send = (response: ServerResponse, status: number, body: unknown): void => {
    response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', connection: 'close' });
    response.end(JSON.stringify(body));
  };

  private allowed = (request: IncomingMessage): boolean => !request.headers.origin && ['127.0.0.1:' + this.settings.port, 'localhost:' + this.settings.port].includes(request.headers.host ?? '') && (!request.headers['sec-fetch-site'] || request.headers['sec-fetch-site'] === 'none');

  private dispatch = (request: IncomingMessage, response: ServerResponse): void => {
    let url: URL;
    try { url = new URL(request.url ?? '/', this.settings.url); }
    catch { this.send(response, 400, { error: 'Invalid request URL' }); return; }
    if (url.pathname.startsWith('/.ghostvault/')) {
      if (!this.allowed(request)) { this.send(response, 403, { error: 'Forbidden' }); return; }
      const challenge = url.searchParams.get('challenge') ?? '';
      if (url.pathname === '/.ghostvault/identity' && request.method === 'GET' && RuntimeProof.validChallenge(challenge)) {
        this.send(response, 200, { identity: this.identity, proof: RuntimeProof.sign(this.controlToken, challenge, this.identity) });
        return;
      }
      if (url.pathname === '/.ghostvault/shutdown' && request.method === 'POST') {
        const token = request.headers.authorization?.replace(/^Bearer /, '') ?? '';
        if (!RuntimeProof.equal(token, this.controlToken) || request.headers['x-ghostvault-instance'] !== this.identity.instanceId) { this.send(response, 403, { error: 'Forbidden' }); return; }
        this.identity.state = 'stopping';
        response.once('finish', () => { void this.shutdown().catch(() => { process.exitCode = 1; }); });
        this.send(response, 202, { instanceId: this.identity.instanceId, state: 'stopping' });
        return;
      }
      this.send(response, 404, { error: 'Unknown runtime endpoint' });
      return;
    }
    if (this.identity.state !== 'ready' || !this.handler) { this.send(response, 503, { error: 'GhostVault is ' + this.identity.state }); return; }
    this.active.add(response);
    let completed = false;
    const done = (): void => {
      if (completed) return;
      completed = true;
      this.active.delete(response);
      if (this.active.size === 0) for (const waiter of this.waiters) waiter();
    };
    response.once('finish', done);
    response.once('close', done);
    this.handler(request, response);
  };
}
