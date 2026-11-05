import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RuntimeApplication } from './runtime/application.js';
import { RuntimeSettings } from './runtime/settings.js';

const root = path.resolve('.cache/secret-intake-fixtures');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(path.join(root, 'runtime-'));
const probe = createServer();
await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = (probe.address() as { port: number }).port;
await new Promise<void>(resolve => probe.close(() => resolve()));
const settings = new RuntimeSettings({ dataDir: directory, port });
let runtime = RuntimeApplication.create(settings);
let client: Client | undefined;
const post = async (route: string, body: unknown, token?: string) => {
  const response = await fetch(settings.url + '/api/secret-input' + route, { method: 'POST', headers: { origin: settings.url, 'content-type': 'application/json', 'x-ghostvault-input': '1', ...(token ? { authorization: 'Intake ' + token } : {}) }, body: JSON.stringify(body) });
  const data = await response.json() as any;
  assert.equal(response.status, 200, route + ': ' + (data.error?.code || data.error || 'unexpected status'));
  return data;
};
const connect = async () => {
  const next = new Client({ name: 'runtime-input-test', version: 'test' });
  await next.connect(new StreamableHTTPClientTransport(new URL('/mcp', settings.url), { requestInit: { headers: { authorization: 'Bearer ' + readFileSync(settings.tokenPath, 'utf8').trim() } } }));
  return next;
};
try {
  await runtime.start();
  assert.deepEqual(runtime.getVault().captureSecretTargets(['RUNTIME_VALUE']), [{ name: 'RUNTIME_VALUE', expectedRevision: null }]);
  client = await connect();
  assert.ok((await client.listTools()).tools.some(tool => tool.name === 'ghostvault_request_secret_input'));
  const session = await post('/session', {});
  const request = await post('/requests', { operation: 'new', names: ['RUNTIME_VALUE'], idempotencyKey: randomUUID() }, session.formToken);
  const committed = await post('/requests/' + request.requestId + '/submit', { submissionId: randomUUID(), values: [{ name: 'RUNTIME_VALUE', value: 'synthetic-runtime-persisted' }] }, session.formToken);
  assert.equal(committed.state, 'completed');
  const pendingSession = await post('/session', {});
  const pending = await post('/requests', { operation: 'new', names: ['CANCEL_ON_STOP'], idempotencyKey: randomUUID() }, pendingSession.formToken);
  const manager = runtime.getServer().getSecretInput();
  await client.close();
  await runtime.close();
  assert.equal(manager.status(pending.requestId).state, 'cancelled');
  runtime = RuntimeApplication.create(settings);
  await runtime.start();
  assert.equal(runtime.getVault().unmaskInboundText('$${<RUNTIME_VALUE>}'), 'synthetic-runtime-persisted');
  client = await connect();
  const old = await client.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: request.requestId } });
  assert.equal(old.isError, true);
  assert.equal(JSON.stringify(old).includes('REQUEST_NOT_FOUND'), true);
  const oldGrant = await fetch(settings.url + '/api/secret-input/requests/' + request.requestId, { headers: { authorization: 'Intake ' + session.formToken } });
  assert.equal(oldGrant.status, 403);
  console.log('Production runtime retained listener/input/MCP/stop/restart/no replay PASS');
} finally { await client?.close(); await runtime.close(); }
