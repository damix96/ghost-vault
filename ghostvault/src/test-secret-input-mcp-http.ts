import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { SecretInputManager } from './secret-input/manager.js';
import { SecretInputBrowser } from './secret-input/browser-launcher.js';
import { SecretInputView } from './secret-input/schema.js';
import { SecretInputEndpoint } from './secret-input/endpoint.js';

const app = Fastify({ logger: false });
const mcpToken = randomUUID();
const launches: URL[] = [];
const saved = new Map<string, string>();
const secret = 'synthetic-http-input-private-value';
const input = new SecretInputManager({
  inspect: (_operation, names) => names.map(name => ({ name, expectedRevision: null })),
  commit: async (_operation, values) => {
    values.forEach(entry => saved.set(entry.name, entry.value));
    return { variables: values.map(entry => ({ name: entry.name, token: '$${<' + entry.name + '>}' })) };
  },
}, new SecretInputBrowser('win32', async command => { launches.push(new URL(command.env.GHOSTVAULT_INPUT_URL!)); return true; }));
new SecretInputEndpoint(app, input).register();
const endpoint = new VaultMcpEndpoint(app, { listVariables: () => ({ revision: String(saved.size), variables: [...saved.keys()].map(name => ({ name, token: '$${<' + name + '>}' , source: 'fixed' as const })) }) }, { version: '0.2.0-test', mcpToken });
endpoint.register();
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const clients: Client[] = [];
const client = async () => {
  const result = new Client({ name: 'http-input-' + clients.length, version: 'test' });
  clients.push(result);
  await result.connect(new StreamableHTTPClientTransport(new URL('/mcp', address), { requestInit: { headers: { authorization: 'Bearer ' + mcpToken } } }));
  return result;
};
try {
  const [first, second] = await Promise.all([client(), client()]);
  assert.equal((await first.listTools()).tools.length, 4);
  const args = { operation: 'new', names: ['HTTP_ONE', 'HTTP_TWO'], idempotencyKey: randomUUID() };
  const response = await first.callTool({ name: 'ghostvault_request_secret_input', arguments: args });
  const view = response.structuredContent as SecretInputView;
  assert.equal(view.state, 'awaiting_input');
  assert.equal(launches.length, 1);
  assert.equal(launches[0].origin, address);
  assert.equal(launches[0].pathname, '/vault-secret/new');
  assert.equal(launches[0].searchParams.get('request'), view.requestId);
  assert.equal(launches[0].href.includes(mcpToken), false);
  assert.equal(endpoint.getActiveRequestCount(), 0);
  await first.close();
  assert.deepEqual((await second.callTool({ name: 'ghostvault_request_secret_input', arguments: args })).structuredContent, view);
  assert.equal(launches.length, 1);
  const browserHeaders = { origin: address, 'content-type': 'application/json', 'x-ghostvault-input': '1' };
  const sessionResponse = await fetch(address + '/api/secret-input/session', { method: 'POST', headers: browserHeaders, body: JSON.stringify({ requestId: view.requestId }) });
  assert.equal(sessionResponse.status, 200);
  const session = await sessionResponse.json() as { formToken: string };
  const submitResponse = await fetch(address + '/api/secret-input/requests/' + view.requestId + '/submit', { method: 'POST', headers: { ...browserHeaders, authorization: 'Intake ' + session.formToken }, body: JSON.stringify({ submissionId: randomUUID(), values: args.names.map(name => ({ name, value: secret })) }) });
  assert.equal(submitResponse.status, 200);
  const submitted = await submitResponse.json();
  const status = await second.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: view.requestId } });
  assert.equal((status.structuredContent as SecretInputView).state, 'completed');
  const catalog = await second.callTool({ name: 'ghostvault_list_variables', arguments: {} });
  assert.equal((catalog.structuredContent as { variables: unknown[] }).variables.length, 2);
  assert.equal(JSON.stringify([response, submitted, status, catalog]).includes(secret), false);
  assert.equal(JSON.stringify([response, status, catalog]).includes(session.formToken), false);
  const reconnected = await client();
  assert.deepEqual((await reconnected.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: view.requestId } })).structuredContent, status.structuredContent);
  assert.equal(saved.get('HTTP_ONE'), secret);
  console.log('Secret input actual stateless HTTP/shared SDK clients/reconnect PASS');
} finally {
  await Promise.all(clients.map(connection => connection.close()));
  await endpoint.close();
  await input.close();
  await app.close();
}
