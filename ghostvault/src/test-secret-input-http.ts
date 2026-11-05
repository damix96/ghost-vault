import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';
import { SecretInputManager } from './secret-input/manager.js';
import { SecretInputEndpoint } from './secret-input/endpoint.js';

const app = Fastify({ logger: false });
let now = Date.now();
let fail = false;
let commits = 0;
const secret = 'synthetic-human-http-secret';
const saved = new Map<string, string>();
const manager = new SecretInputManager({
  inspect: (_operation, names) => names.map(name => ({ name, expectedRevision: null })),
  commit: async (_operation, values) => {
    commits++;
    if (fail) throw Object.assign(new Error(secret), { code: 'PROVIDER_UNAVAILABLE' });
    values.forEach(entry => saved.set(entry.name, entry.value));
    return { variables: values.map(entry => ({ name: entry.name, token: '$${<' + entry.name + '>}' })) };
  },
}, undefined, () => now);
const endpoint = new SecretInputEndpoint(app, manager);
endpoint.register();
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const base = address + '/api/secret-input';
const outputs: unknown[] = [];
const post = async (path: string, body: unknown, token?: string) => {
  const response = await fetch(base + path, { method: 'POST', headers: { origin: address, 'content-type': 'application/json', 'x-ghostvault-input': '1', ...(token ? { authorization: 'Intake ' + token } : {}) }, body: JSON.stringify(body) });
  const data = await response.json() as any;
  outputs.push(data);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  return { status: response.status, data };
};
const create = async (name: string) => {
  const session = await post('/session', {});
  assert.equal(session.status, 200);
  const token = session.data.formToken as string;
  const args = { operation: 'new', names: [name], idempotencyKey: randomUUID() };
  const request = await post('/requests', args, token);
  assert.equal(request.status, 200);
  return { token, id: request.data.requestId as string, args, view: request.data };
};
try {
  const first = await create('FIRST');
  const view = await fetch(base + '/requests/' + first.id, { headers: { authorization: 'Intake ' + first.token, 'sec-fetch-site': 'same-origin' } });
  assert.equal(view.status, 200);
  assert.deepEqual(await view.json(), first.view);
  assert.equal((await post('/requests', first.args, first.token)).data.requestId, first.id);
  assert.equal((await post('/requests', { ...first.args, idempotencyKey: randomUUID(), names: ['OTHER'] }, first.token)).status, 403);
  const unauthorized = await fetch(base + '/requests/' + first.id, { headers: { authorization: 'Bearer ' + first.token } });
  assert.equal(unauthorized.status, 403);
  const other = await create('SECOND');
  assert.equal((await fetch(base + '/requests/' + first.id, { headers: { authorization: 'Intake ' + other.token } })).status, 403);
  const partial = await post('/requests/' + first.id + '/submit', { submissionId: randomUUID(), values: [{ name: 'OTHER', value: secret }] }, first.token);
  assert.equal(partial.status, 409);
  assert.equal(commits, 0);
  assert.equal(manager.status(first.id).state, 'awaiting_input');
  const submission = { submissionId: randomUUID(), values: [{ name: 'FIRST', value: secret }] };
  const complete = await post('/requests/' + first.id + '/submit', submission, first.token);
  assert.equal(complete.status, 200);
  assert.equal(complete.data.state, 'completed');
  assert.equal(saved.get('FIRST'), secret);
  assert.deepEqual((await post('/requests/' + first.id + '/submit', submission, first.token)).data, complete.data);
  assert.equal(commits, 1);
  assert.equal((await post('/requests/' + other.id + '/cancel', {}, other.token)).data.state, 'cancelled');
  assert.equal((await post('/requests/' + other.id + '/submit', { ...submission, submissionId: randomUUID(), values: [{ name: 'SECOND', value: secret }] }, other.token)).status, 409);
  const expiring = await create('EXPIRING');
  now += 600_001;
  assert.equal((await post('/requests/' + expiring.id + '/submit', { ...submission, submissionId: randomUUID(), values: [{ name: 'EXPIRING', value: secret }] }, expiring.token)).status, 410);
  const unavailable = await create('UNAVAILABLE');
  fail = true;
  const failure = await post('/requests/' + unavailable.id + '/submit', { ...submission, submissionId: randomUUID(), values: [{ name: 'UNAVAILABLE', value: secret }] }, unavailable.token);
  assert.equal(failure.status, 503);
  assert.equal(failure.data.request.state, 'failed');
  assert.equal(failure.data.error.code, 'PROVIDER_UNAVAILABLE');
  assert.equal((await post('/requests/' + unavailable.id + '/submit', { ...submission, submissionId: randomUUID() }, unavailable.token)).status, 409);
  const linked = await manager.request({ operation: 'new', names: ['LINKED'], idempotencyKey: randomUUID() });
  const linkedSession = await post('/session', { requestId: linked.requestId });
  assert.deepEqual(linkedSession.data.request, linked);
  assert.equal((await post('/requests/' + linked.requestId + '/cancel', {}, linkedSession.data.formToken)).status, 200);
  for (const body of ['{"value":"' + secret, JSON.stringify({ value: secret.repeat(20000) })]) {
    const malformed = await fetch(base + '/session', { method: 'POST', headers: { origin: address, 'content-type': 'application/json', 'x-ghostvault-input': '1' }, body });
    assert.equal(malformed.status, 400);
    outputs.push(await malformed.json());
  }
  assert.equal((await fetch(base + '/session', { method: 'POST', headers: { origin: 'https://foreign.example', 'content-type': 'application/json', 'x-ghostvault-input': '1' }, body: '{}' })).status, 403);
  for (const output of outputs) assert.equal(JSON.stringify(output).includes(secret), false);
  await endpoint.close();
  assert.equal((await post('/session', {})).status, 503);
  console.log('Secret input HTTP auth/atomic submit/replay/cancel/expiry/provider/parse PASS');
} finally { await endpoint.close(); await app.close(); }
