import type { FastifyReply, FastifyRequest } from 'fastify';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { VaultCatalogProvider } from './catalog-schema.js';
import { VaultCatalogServer } from './catalog-server.js';
import { McpSecretInput } from './secret-input-tools.js';

export class McpHttpRequest {
  private server: VaultCatalogServer;
  private transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  private closing?: Promise<void>;
  private complete: () => void = () => {};
  public readonly done = new Promise<void>(resolve => { this.complete = resolve; });

  constructor(vault: VaultCatalogProvider, version: string, private reply: FastifyReply, private released: () => void, input?: McpSecretInput) {
    this.server = new VaultCatalogServer(vault, version, input);
  }

  public close = (): Promise<void> => {
    this.closing ??= this.dispose();
    return this.closing;
  };

  private dispose = async (): Promise<void> => {
    this.reply.raw.off('close', this.onResponseClose);
    if (!this.reply.raw.writableEnded) this.reply.raw.destroy();
    try {
      await this.server.mcp.close();
    } finally {
      this.released();
      this.complete();
    }
  };

  private onResponseClose = (): void => {
    void this.close().catch(() => {});
  };

  public handle = async (request: FastifyRequest): Promise<void> => {
    this.reply.hijack();
    this.reply.raw.once('close', this.onResponseClose);
    try {
      await this.server.connect(this.transport);
      await this.transport.handleRequest(request.raw, this.reply.raw, request.body);
    } catch {
      if (!this.reply.raw.headersSent && !this.reply.raw.destroyed) {
        this.reply.raw.writeHead(500, { 'content-type': 'application/json' });
        this.reply.raw.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32603, message: 'MCP request failed' } }));
      }
    } finally {
      await this.close();
    }
  };
}
