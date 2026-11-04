import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { VaultCatalogServer } from './mcp/catalog-server.js';
import { VAULT_MCP_INSTRUCTIONS } from './mcp/instructions.js';

class CatalogProjectionTests {
  private secret = 'synthetic:/hidden-value/with spaces';
  private client = new Client({ name: 'catalog-test', version: '1.0.0' });
  private failure = false;
  private invalid = false;
  private inputs: Array<{ includeAutomatic?: boolean; names?: string[] } | undefined> = [];
  private provider = {
    listVariables: (input?: { includeAutomatic?: boolean; names?: string[] }) => {
      this.inputs.push(input);
      if (this.failure) throw new Error(this.secret);
      return {
        revision: 'metadata-revision',
        original: this.secret,
        traffic: { secret: this.secret },
        variables: [{
          name: 'BASE_URL', token: this.invalid ? this.secret : '$${<BASE_URL>}', source: 'fixed' as const,
          description: 'Service endpoint', realValue: this.secret, encoded: Buffer.from(this.secret).toString('base64'),
        }],
      };
    },
  };
  private server = new VaultCatalogServer(this.provider, '0.1.0-test');

  private call = (args: Record<string, unknown> = {}) => this.client.callTool({ name: 'ghostvault_list_variables', arguments: args });

  private metadata = async (): Promise<void> => {
    assert.deepEqual(this.client.getServerVersion(), { name: 'ghostvault', version: '0.1.0-test' });
    assert.equal(this.client.getInstructions(), VAULT_MCP_INSTRUCTIONS);
    const { tools } = await this.client.listTools();
    assert.equal(tools.length, 1);
    assert.equal(tools[0].name, 'ghostvault_list_variables');
    for (const text of [this.client.getInstructions()!, tools[0].description!]) {
      for (const phrase of ['$${<NAME>}', 'outside this session', 'unknown', 'stale', 'current value', 'Renaming', 'every reuse', 'includeAutomatic: true']) {
        assert.ok(text.includes(phrase), 'Missing model instruction: ' + phrase);
      }
    }
    assert.deepEqual(tools[0].annotations, { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
    assert.ok(tools[0].outputSchema);
    assert.equal(this.client.getServerCapabilities()?.resources, undefined);
    assert.equal(this.client.getServerCapabilities()?.prompts, undefined);
  };

  private projection = async (): Promise<void> => {
    const result = await this.call();
    const expected = { revision: 'metadata-revision', variables: [{ name: 'BASE_URL', token: '$${<BASE_URL>}', description: 'Service endpoint', source: 'fixed' }] };
    assert.deepEqual(result.structuredContent, expected);
    assert.deepEqual(result.content, [{ type: 'text', text: JSON.stringify(expected) }]);
    assert.deepEqual(this.inputs.pop(), { includeAutomatic: false });
    assert.equal((await this.client.callTool({ name: 'ghostvault_list_variables' })).isError, undefined);
    assert.deepEqual(this.inputs.pop(), { includeAutomatic: false });
    await this.call({ includeAutomatic: true, names: ['BASE_URL'] });
    assert.deepEqual(this.inputs.pop(), { includeAutomatic: true, names: ['BASE_URL'] });
    const serialized = JSON.stringify(result);
    for (const value of [this.secret, encodeURIComponent(this.secret), Buffer.from(this.secret).toString('base64')]) assert.equal(serialized.includes(value), false);
    assert.equal(serialized.includes('traffic'), false);
    assert.equal(serialized.includes('realValue'), false);
  };

  private failures = async (): Promise<void> => {
    this.failure = true;
    const failure = await this.call();
    assert.equal(failure.isError, true);
    assert.equal(JSON.stringify(failure).includes(this.secret), false);
    assert.equal(failure.structuredContent, undefined);
    this.failure = false;
    this.invalid = true;
    const invalid = await this.call();
    assert.equal(invalid.isError, true);
    assert.equal(JSON.stringify(invalid).includes(this.secret), false);
    this.invalid = false;
    assert.equal((await this.call({ includeAutomatic: 'true' })).isError, true);
    assert.equal((await this.call({ names: [5] })).isError, true);
    assert.equal((await this.client.callTool({ name: 'ghostvault_get_last_context', arguments: {} })).isError, true);
    assert.equal((await this.call()).isError, undefined);
  };

  public run = async (): Promise<void> => {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    try {
      await this.server.connect(serverTransport);
      await this.client.connect(clientTransport);
      await this.metadata();
      await this.projection();
      await this.failures();
      console.log('MCP catalog metadata, projection and failure tests passed');
    } finally {
      await this.client.close();
      await this.server.mcp.close();
    }
  };
}

await new CatalogProjectionTests().run();
