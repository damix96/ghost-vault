import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { VaultMcpBridge } from './mcp/bridge.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { VAULT_MCP_INSTRUCTIONS } from './mcp/instructions.js';
import { RuntimeSettings } from './runtime/settings.js';

class McpBridgeTests {
  private app = Fastify();
  private mcpToken = 'synthetic-bridge-mcp-token';
  private revision = 'one';
  private provider = { listVariables: () => ({ revision: this.revision, variables: [{ name: 'BASE_URL', token: '$${<BASE_URL>}', source: 'fixed' as const }] }) };
  private endpoint = new VaultMcpEndpoint(this.app, this.provider, { version: '0.1.0-bridge-test', mcpToken: this.mcpToken });
  private clients: Client[] = [];
  private diagnostics: string[] = [];
  private url!: URL;
  private clientVersions: string[] = [];

  private client = async (mcpToken = this.mcpToken): Promise<Client> => {
    const index = this.clients.length;
    const client = new Client({ name: 'stdio-client-' + index, version: '1.0.0' });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp/test-bridge-child.js', import.meta.url))],
      env: { MCP_TEST_URL: this.url.href, MCP_TEST_TOKEN: mcpToken },
      stderr: 'pipe',
    });
    this.clients.push(client);
    this.diagnostics[index] = '';
    transport.stderr!.on('data', chunk => { this.diagnostics[index] += chunk.toString(); });
    await client.connect(transport);
    return client;
  };

  private forwarding = async (): Promise<void> => {
    const [first, second] = await Promise.all([this.client(), this.client()]);
    assert.equal(first.getInstructions(), VAULT_MCP_INSTRUCTIONS);
    assert.equal(second.getInstructions(), VAULT_MCP_INSTRUCTIONS);
    assert.deepEqual(first.getServerVersion(), { name: 'ghostvault', version: '0.1.0-bridge-test' });
    const { tools } = await first.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['ghostvault_list_variables']);
    assert.ok(tools[0].description!.includes(VAULT_MCP_INSTRUCTIONS));
    assert.equal(first.getServerCapabilities()?.resources, undefined);
    assert.equal(first.getServerCapabilities()?.prompts, undefined);
    const result = await first.callTool({ name: 'ghostvault_list_variables' });
    assert.deepEqual(result.structuredContent, this.provider.listVariables());
    this.revision = 'two';
    assert.deepEqual((await second.callTool({ name: 'ghostvault_list_variables', arguments: {} })).structuredContent, this.provider.listVariables());
    assert.equal((await first.callTool({ name: 'ghostvault_get_last_context', arguments: {} })).isError, true);
    await first.close();
    assert.ok(this.diagnostics[0].includes('bridge-exit:0'), 'Bridge must exit gracefully on stdin EOF');
    assert.equal((await second.listTools()).tools.length, 1);
    await assert.rejects(this.client('synthetic-invalid-credential'), /Connection closed/);
    assert.ok(this.diagnostics[2].includes('bridge-start-failed'));
    assert.equal(this.diagnostics[2].includes('synthetic-invalid-credential'), false);
    await this.endpoint.close();
    const unavailable = await second.callTool({ name: 'ghostvault_list_variables', arguments: {} });
    assert.equal(unavailable.isError, true);
    assert.equal(JSON.stringify(unavailable).includes(this.mcpToken), false);
    await second.close();
    assert.ok(this.diagnostics[1].includes('bridge-exit:0'));
  };

  private options = (): void => {
    for (const url of ['https://127.0.0.1/mcp', 'http://foreign.invalid/mcp', 'http://127.0.0.1/admin', 'http://127.0.0.1/mcp?token=test', 'http://user:pass@127.0.0.1/mcp']) {
      assert.throws(() => new VaultMcpBridge({ url: new URL(url), mcpToken: this.mcpToken }), /Invalid local MCP/);
    }
    assert.throws(() => new VaultMcpBridge({ url: this.url, mcpToken: '' }), /Invalid local MCP/);
  };

  public run = async (): Promise<void> => {
    this.app.addHook('preHandler', async request => {
      const body = request.body as { method?: string; params?: { clientInfo?: { version?: string } } };
      if (body?.method === 'initialize') this.clientVersions.push(body.params?.clientInfo?.version ?? '');
    });
    this.endpoint.register();
    try {
      this.url = new URL('/mcp', await this.app.listen({ port: 0, host: '127.0.0.1' }));
      this.options();
      await this.forwarding();
      assert.ok(this.clientVersions.length >= 2);
      assert.ok(this.clientVersions.every(version => version === RuntimeSettings.installedVersion()));
      assert.equal(this.endpoint.getActiveRequestCount(), 0);
      for (const diagnostic of this.diagnostics) assert.equal(diagnostic.includes(this.mcpToken), false);
      console.log('MCP SDK stdio bridge metadata, multi-client forwarding, errors and EOF cleanup tests passed');
    } finally {
      await Promise.all(this.clients.map(client => client.close()));
      await this.app.close();
    }
  };
}

await new McpBridgeTests().run();
