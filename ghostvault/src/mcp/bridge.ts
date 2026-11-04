import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ErrorCode, ListToolsRequestSchema, McpError } from '@modelcontextprotocol/sdk/types.js';
import { RuntimeSettings } from '../runtime/settings.js';

export interface VaultMcpBridgeOptions {
  url: URL;
  mcpToken: string;
}

export class VaultMcpBridge {
  private client = new Client({ name: 'ghostvault-stdio-bridge', version: RuntimeSettings.installedVersion() });
  private server?: Server;
  private started = false;
  private closing?: Promise<void>;

  constructor(private options: VaultMcpBridgeOptions) {
    const { url, mcpToken } = options;
    if (!mcpToken || url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)
      || url.username || url.password || url.pathname !== '/mcp' || url.search || url.hash) throw new Error('Invalid local MCP connection options');
  }

  public start = async (): Promise<void> => {
    if (this.started || this.closing) throw new Error('MCP bridge has already been started or closed');
    this.started = true;
    try {
      const transport = new StreamableHTTPClientTransport(this.options.url, { requestInit: { headers: { authorization: 'Bearer ' + this.options.mcpToken }, redirect: 'error' } });
      await this.client.connect(transport);
      const info = this.client.getServerVersion();
      if (this.closing || !info || info.name !== 'ghostvault' || !this.client.getServerCapabilities()?.tools) throw new Error('Unavailable MCP server');
      this.server = new Server(info, { instructions: this.client.getInstructions(), capabilities: { tools: {} } });
      this.server.setRequestHandler(ListToolsRequestSchema, async request => {
        try {
          return await this.client.listTools(request.params);
        } catch {
          throw new McpError(ErrorCode.InternalError, 'Vault catalog is temporarily unavailable');
        }
      });
      this.server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
        try {
          return await this.client.callTool({ ...request.params, arguments: request.params.arguments ?? {} }, undefined, { signal: extra.signal });
        } catch {
          return { isError: true, content: [{ type: 'text', text: 'Vault catalog is temporarily unavailable. Retry the catalog request.' }] };
        }
      });
      this.server.onclose = this.onDisconnect;
      process.stdin.once('end', this.onDisconnect);
      process.stdin.once('close', this.onDisconnect);
      process.stdout.once('error', this.onDisconnect);
      await this.server.connect(new StdioServerTransport());
    } catch {
      await this.close();
      throw new Error('Unable to connect to the local GhostVault MCP server');
    }
  };

  private onDisconnect = (): void => {
    void this.close().catch(() => {});
  };

  public close = (): Promise<void> => {
    this.closing ??= Promise.resolve().then(this.dispose);
    return this.closing;
  };

  private dispose = async (): Promise<void> => {
    process.stdin.off('end', this.onDisconnect);
    process.stdin.off('close', this.onDisconnect);
    process.stdout.off('error', this.onDisconnect);
    await Promise.all([this.server?.close(), this.client.close()]);
  };
}
