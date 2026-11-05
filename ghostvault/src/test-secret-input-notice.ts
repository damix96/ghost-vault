import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { SecretInputView } from './secret-input/schema.js';

const root = path.resolve('.cache/secret-intake-fixtures');
mkdirSync(root, { recursive: true });
const file = path.join(mkdtempSync(path.join(root, 'notice-')), 'vault.db');
const db = new VaultDatabase(file);
const vault = new VaultStore(db);
vault.setManualSecret('NOTICE_KEY', 'synthetic-before-protection');
const reader = new DatabaseSync(file, { readOnly: true });
reader.exec('BEGIN');
reader.prepare('SELECT key FROM secrets').all();
let readerClosed = false;
let originalClosed = false;
let reopened: VaultDatabase | undefined;
const proxy = new GhostProxyServer(vault, { host: '127.0.0.1', port: 0 });
const endpoint = new VaultMcpEndpoint(proxy.getApp(), vault, { version: '0.2.0-notice', mcpToken: 'synthetic-notice-token' });
endpoint.register();
const origin = await proxy.listen();
const client = new Client({ name: 'notice-client', version: 'test' });
const reconnected = new Client({ name: 'notice-reconnected', version: 'test' });
const post = async (route: string, body: unknown, token?: string) => {
  const response = await fetch(origin + '/api/secret-input' + route, { method: 'POST', headers: { origin, 'content-type': 'application/json', 'x-ghostvault-input': '1', ...(token ? { authorization: 'Intake ' + token } : {}) }, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  return await response.json() as any;
};
try {
  await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { authorization: 'Bearer synthetic-notice-token' } } }));
  const session = await post('/session', {});
  const request = await post('/requests', { operation: 'update', names: ['NOTICE_KEY'], idempotencyKey: randomUUID() }, session.formToken);
  const submit = { submissionId: randomUUID(), values: [{ name: 'NOTICE_KEY', value: 'synthetic-committed-protected-value' }] };
  const result = await post('/requests/' + request.requestId + '/submit', submit, session.formToken);
  assert.equal(result.state, 'completed');
  assert.equal(result.notice.code, 'SECRET_STORAGE_CLEANUP_PENDING');
  assert.equal(result.error, undefined);
  assert.deepEqual(result.result, [{ name: 'NOTICE_KEY', token: '$${<NOTICE_KEY>}' }]);
  assert.equal(vault.unmaskInboundText('$${<NOTICE_KEY>}'), 'synthetic-committed-protected-value');
  assert.equal(vault.getSecretStorageNotice()?.code, 'SECRET_STORAGE_CLEANUP_PENDING');
  const revisions = vault.captureSecretTargets(['NOTICE_KEY']);
  assert.deepEqual(await post('/requests/' + request.requestId + '/submit', submit, session.formToken), result);
  assert.deepEqual(vault.captureSecretTargets(['NOTICE_KEY']), revisions);
  const httpStatus = await fetch(origin + '/api/secret-input/requests/' + request.requestId, { headers: { authorization: 'Intake ' + session.formToken } });
  assert.equal(httpStatus.status, 200);
  assert.deepEqual(await httpStatus.json(), result);
  const status = await client.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: request.requestId } });
  assert.equal(status.isError, undefined);
  assert.equal((status.structuredContent as SecretInputView).state, 'completed');
  assert.equal((status.structuredContent as SecretInputView).notice?.code, 'SECRET_STORAGE_CLEANUP_PENDING');
  assert.equal(JSON.stringify([result, status]).includes('synthetic-committed-protected-value'), false);
  await client.close();
  await reconnected.connect(new StreamableHTTPClientTransport(new URL('/mcp', origin), { requestInit: { headers: { authorization: 'Bearer synthetic-notice-token' } } }));
  const recovered = await reconnected.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: request.requestId } });
  assert.equal(recovered.isError, undefined);
  assert.deepEqual(recovered.structuredContent, result);
  assert.deepEqual(vault.captureSecretTargets(['NOTICE_KEY']), revisions);
  await reconnected.close();
  await endpoint.close();
  await proxy.close();
  db.close();
  originalClosed = true;
  reopened = new VaultDatabase(file);
  const restartedVault = new VaultStore(reopened);
  assert.equal(restartedVault.getSecretStorageNotice()?.code, 'SECRET_STORAGE_CLEANUP_PENDING');
  assert.equal(restartedVault.unmaskInboundText('$${<NOTICE_KEY>}'), 'synthetic-committed-protected-value');
  reader.exec('ROLLBACK');
  reader.close();
  readerClosed = true;
  restartedVault.setManualSecret('NOTICE_KEY', 'synthetic-after-cleanup-write', undefined, true);
  assert.equal(restartedVault.getSecretStorageNotice(), undefined);
  for (const candidate of [file, file + '-wal']) if (existsSync(candidate)) {
    const bytes = readFileSync(candidate);
    for (const value of ['synthetic-before-protection', 'synthetic-committed-protected-value', 'synthetic-after-cleanup-write']) assert.equal(bytes.includes(Buffer.from(value)), false);
  }
  console.log('Actual checkpoint-busy commit/HTTP submit+status/MCP reconnect notice/no replay/restart/next-write cleanup and DB-WAL PASS');
} finally {
  await reconnected.close();
  if (!readerClosed) { reader.exec('ROLLBACK'); reader.close(); }
  if (!originalClosed) { await client.close(); await endpoint.close(); await proxy.close(); db.close(); }
  reopened?.close();
}
