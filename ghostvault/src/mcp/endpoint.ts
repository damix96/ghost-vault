import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { McpAccessPolicy } from './access-policy.js';
import { VaultCatalogProvider } from './catalog-schema.js';
import { McpHttpRequest } from './http-request.js';

export interface VaultMcpEndpointOptions {
  version: string;
  mcpToken: string;
}

export class VaultMcpEndpoint {
  private active = new Set<McpHttpRequest>();
  private access: McpAccessPolicy;
  private closed = false;
  private closing?: Promise<void>;

  constructor(private app: FastifyInstance, private vault: VaultCatalogProvider, private options: VaultMcpEndpointOptions) {
    this.access = new McpAccessPolicy(options.mcpToken);
  }

  public register = (): void => {
    this.app.register(async scope => {
      scope.addHook('onRequest', async (request, reply) => {
        if (!this.access.allowed(request)) await reply.code(403).send({ error: 'MCP access denied' });
        else if (this.closed) await reply.code(503).send({ error: 'MCP endpoint is stopping' });
        else if (request.method !== 'POST') await reply.code(405).header('allow', 'POST').send({ error: 'MCP endpoint accepts POST requests' });
      });
      scope.setErrorHandler((_error, _request, reply) => reply.code(400).send({ error: 'Invalid MCP request' }));
      scope.route({ method: ['POST', 'GET', 'DELETE'], url: '/mcp', logLevel: 'silent', handler: this.handle });
      scope.addHook('onClose', this.close);
    });
  };

  public getActiveRequestCount = (): number => this.active.size;

  public close = (): Promise<void> => {
    this.closing ??= this.drain();
    return this.closing;
  };

  private drain = async (): Promise<void> => {
    this.closed = true;
    const connections = [...this.active];
    if (!connections.length) return;
    await new Promise<void>(resolve => {
      const timeout = setTimeout(resolve, 5000);
      timeout.unref();
      void Promise.all(connections.map(connection => connection.done)).then(() => {
        clearTimeout(timeout);
        resolve();
      });
    });
    await Promise.all(connections.map(connection => connection.close()));
  };

  private handle = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const connection = new McpHttpRequest(this.vault, this.options.version, reply, () => this.active.delete(connection));
    this.active.add(connection);
    await connection.handle(request);
  };
}
