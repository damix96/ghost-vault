import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { VaultCatalogServer } from './mcp/catalog-server.js';
import { SecretInputManager } from './secret-input/manager.js';
import { SecretInputBrowser } from './secret-input/browser-launcher.js';
import { SecretInputView } from './secret-input/schema.js';

const original = 'synthetic-intake-not-in-protocol-秘密';
const saved = new Map<string, string>();
let launchCount = 0;
const input = new SecretInputManager({
  inspect: (_operation, names) => names.map(name => ({ name, expectedRevision: null })),
  commit: async (_operation, values) => {
    values.forEach(entry => saved.set(entry.name, entry.value));
    return { variables: values.map(entry => ({ name: entry.name, token: '$${<' + entry.name + '>}' })) };
  },
}, new SecretInputBrowser('win32', async () => { launchCount++; return true; }));
const provider = { listVariables: () => ({ revision: String(saved.size), variables: [...saved.keys()].map(name => ({ name, token: '$${<' + name + '>}', source: 'fixed' as const })) }) };
const clients = [new Client({ name: 'input-one', version: 'test' }), new Client({ name: 'input-two', version: 'test' })];
const servers = clients.map(() => new VaultCatalogServer(provider, '0.2.0-test', { manager: input, origin: 'http://127.0.0.1:12345' }));
const transcript: unknown[] = [];
const call = async (client: Client, name: string, args: Record<string, unknown>) => {
  const result = await client.callTool({ name, arguments: args });
  transcript.push(result);
  return result;
};
try {
  for (let index = 0; index < clients.length; index++) {
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await servers[index].connect(serverTransport);
    await clients[index].connect(clientTransport);
  }
  const listed = await clients[0].listTools();
  transcript.push(listed, clients[0].getInstructions());
  assert.equal(listed.tools.length, 4);
  assert.ok(!listed.tools.some(tool => /submit|reveal/.test(tool.name)));
  const args = { operation: 'new', names: ['FIRST', 'SECOND'], idempotencyKey: randomUUID() };
  const requested = await call(clients[0], 'ghostvault_request_secret_input', args);
  const view = requested.structuredContent as SecretInputView;
  assert.equal(view.state, 'awaiting_input');
  assert.equal(view.launch, 'attempted');
  assert.equal(launchCount, 1);
  assert.deepEqual((await call(clients[1], 'ghostvault_request_secret_input', args)).structuredContent, view);
  assert.equal(launchCount, 1);
  assert.deepEqual((await call(clients[1], 'ghostvault_secret_input_status', { requestId: view.requestId })).structuredContent, view);
  assert.equal((await call(clients[0], 'ghostvault_request_secret_input', { ...args, names: ['BAD NAME'] })).isError, true);
  assert.equal((await call(clients[0], 'ghostvault_request_secret_input', { ...args, value: original })).isError, true);
  assert.equal((await call(clients[0], 'ghostvault_secret_input_status', { requestId: 'not-a-uuid' })).isError, true);
  assert.equal(saved.size, 0);
  await input.submit(view.requestId, { submissionId: randomUUID(), values: args.names.map(name => ({ name, value: original })) });
  const completed = await call(clients[1], 'ghostvault_secret_input_status', { requestId: view.requestId });
  assert.equal((completed.structuredContent as SecretInputView).state, 'completed');
  assert.equal(saved.get('FIRST'), original);
  const catalog = await call(clients[0], 'ghostvault_list_variables', {});
  assert.equal((catalog.structuredContent as { variables: unknown[] }).variables.length, 2);
  const pending = await call(clients[0], 'ghostvault_request_secret_input', { operation: 'update', names: ['FIRST'], idempotencyKey: randomUUID() });
  const cancelled = await call(clients[1], 'ghostvault_cancel_secret_input', { requestId: (pending.structuredContent as SecretInputView).requestId });
  assert.equal((cancelled.structuredContent as SecretInputView).state, 'cancelled');
  assert.equal(saved.get('FIRST'), original);
  for (const sensitive of [original, encodeURIComponent(original), Buffer.from(original).toString('base64')]) assert.equal(JSON.stringify(transcript).includes(sensitive), false);
  console.log('Secret input official SDK/two clients/metadata catalog PASS');
} finally {
  await Promise.all(clients.map(client => client.close()));
  await Promise.all(servers.map(server => server.mcp.close()));
  await input.close();
}
