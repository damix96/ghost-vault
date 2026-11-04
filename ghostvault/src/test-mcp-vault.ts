import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { catalogSchema } from './mcp/catalog-schema.js';

class McpVaultTests {
  private directory = mkdtempSync(join(tmpdir(), 'ghostvault-mcp-vault-'));
  private db = new VaultDatabase(join(this.directory, 'vault.db'));
  private vault = new VaultStore(this.db);
  private app = Fastify();
  private mcpToken = 'synthetic-vault-mcp-token';
  private endpoint = new VaultMcpEndpoint(this.app, this.vault, { version: '0.1.0-vault-test', mcpToken: this.mcpToken });
  private clients = [new Client({ name: 'vault-client-a', version: '1.0.0' }), new Client({ name: 'vault-client-b', version: '1.0.0' })];
  private originals = ['synthetic:/first secret\\quote"', 'synthetic:/updated secret\\quote"', 'synthetic:/auto secret', 'synthetic-disabled-secret'];

  private catalog = async (index: number, args: Record<string, unknown> = {}) => {
    const result = await this.clients[index].callTool({ name: 'ghostvault_list_variables', arguments: args });
    assert.equal(result.isError, undefined);
    const catalog = catalogSchema.parse(result.structuredContent);
    assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(catalog) }]);
    const serialized = JSON.stringify(result);
    for (const original of this.originals) {
      for (const value of Object.values(VaultStore.computeVariants(original))) assert.equal(serialized.includes(value), false);
    }
    for (const item of catalog.variables) assert.deepEqual(Object.keys(item).sort(), item.description ? ['description', 'name', 'source', 'token'] : ['name', 'source', 'token']);
    return catalog;
  };

  private projection = async (): Promise<void> => {
    const fixed = await this.catalog(0);
    assert.deepEqual(fixed.variables, [{ name: 'BASE_URL', token: '$${<BASE_URL>}', description: 'Service address', source: 'fixed' }]);
    const automatic = await this.catalog(1, { includeAutomatic: true });
    assert.deepEqual(automatic.variables.map(variable => [variable.name, variable.source]), [['AUTO_URL', 'automatic'], ['BASE_URL', 'fixed']]);
    assert.notEqual(automatic.revision, fixed.revision);
    const filtered = await this.catalog(0, { includeAutomatic: true, names: ['BASE_URL'] });
    assert.equal(filtered.revision, automatic.revision);
    assert.deepEqual(filtered.variables, fixed.variables);
    for (const names of [[], ['base_url'], ['MISSING'], ['AUTO_URL']]) {
      const absent = await this.catalog(1, { names });
      assert.deepEqual(absent.variables, []);
      assert.equal(absent.revision, fixed.revision);
    }
  };

  private updates = async (): Promise<void> => {
    const previous = await this.catalog(0);
    const token = previous.variables[0].token;
    this.vault.setManualSecret('BASE_URL', this.originals[1], 'Service address');
    const updated = await this.catalog(1);
    assert.deepEqual(updated, previous);
    assert.equal(this.vault.unmaskInboundText(token), this.originals[1]);
    this.vault.setManualSecret('BASE_URL', this.originals[1], 'Updated service description');
    const described = await this.catalog(0);
    assert.notEqual(described.revision, updated.revision);
    assert.equal(described.variables[0].token, token);
    this.vault.renameManualSecret('BASE_URL', 'SERVICE_URL');
    const renamed = await this.catalog(1);
    assert.notEqual(renamed.revision, described.revision);
    assert.deepEqual(renamed.variables, [{ name: 'SERVICE_URL', token: '$${<SERVICE_URL>}', description: 'Updated service description', source: 'fixed' }]);
    assert.equal(this.vault.unmaskInboundText(token), token);
    assert.equal(this.vault.unmaskInboundText(renamed.variables[0].token), this.originals[1]);
    this.vault.setManualSecret('ADDED', 'synthetic-new-entry', '');
    const added = await this.catalog(0);
    assert.deepEqual(added.variables.map(variable => variable.name), ['ADDED', 'SERVICE_URL']);
    assert.equal('description' in added.variables[0], false);
    assert.notEqual(added.revision, renamed.revision);
    this.vault.deleteSecret('ADDED');
    assert.deepEqual(await this.catalog(1), renamed);
    await this.clients[0].close();
    assert.deepEqual(await this.catalog(1), renamed);
  };

  public run = async (): Promise<void> => {
    try {
      this.vault.setManualSecret('BASE_URL', this.originals[0], 'Service address');
      this.vault.setManualSecret('DISABLED', this.originals[3]).maskInAi = false;
      this.vault.setAutoSecret('AUTO_URL', this.originals[2]);
      this.vault.setAutoSecret('AUTO_DISABLED', 'synthetic-auto-disabled').maskInAi = false;
      this.endpoint.register();
      const url = new URL('/mcp', await this.app.listen({ port: 0, host: '127.0.0.1' }));
      await Promise.all(this.clients.map(client => client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: 'Bearer ' + this.mcpToken } } }))));
      await this.projection();
      await this.updates();
      assert.equal(this.endpoint.getActiveRequestCount(), 0);
      console.log('MCP real Vault two-client catalog, stable value update, rename and metadata-only tests passed');
    } finally {
      await Promise.all(this.clients.map(client => client.close()));
      await this.app.close();
      this.db.close();
      rmSync(this.directory, { recursive: true, force: true });
    }
  };
}

await new McpVaultTests().run();
