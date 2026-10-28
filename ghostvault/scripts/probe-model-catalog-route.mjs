import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { UiTestHost } from './ui-test-host.mjs';

const originalFetch = globalThis.fetch;
const originalConnect = Socket.prototype.connect;
const calls = [];
Socket.prototype.connect = () => { throw new Error('Network disabled for route contract probe'); };
globalThis.fetch = async (url, options) => {
  calls.push({ url: String(url), method: options?.method || 'GET' });
  return new Response(JSON.stringify({ object: 'list', data: [{ id: 'synthetic-model' }] }), { status: 200, headers: { 'content-type': 'application/json' } });
};
const host = new UiTestHost();
try {
  await host.init();
  const response = await host.app.inject({ method: 'GET', url: '/ollama/v1/models', headers: { host: '127.0.0.1:1' } });
  const report = { method: 'GET', path: '/ollama/v1/models', status: response.statusCode, body: response.json(), upstream_calls: calls, network_allowed: false, isolated_database: ':memory:' };
  await writeFile('../.cache/model-catalog-route-probe.json', JSON.stringify(report, null, 2));
  assert.equal(response.statusCode, 200);
  assert.deepEqual(calls, [{ url: 'http://127.0.0.1:11434/v1/models', method: 'GET' }]);
  assert.deepEqual(response.json(), { object: 'list', data: [{ id: 'synthetic-model' }] });
  console.log(JSON.stringify(report));
} finally {
  await host.close();
  globalThis.fetch = originalFetch;
  Socket.prototype.connect = originalConnect;
}
