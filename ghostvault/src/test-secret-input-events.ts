import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

const db = new VaultDatabase(':memory:');
const vault = new VaultStore(db);
const original = 'synthetic-protected-sse-original';
const updated = 'synthetic-protected-sse-updated';
const ordinary = 'synthetic-ordinary-visible';
vault.setManualSecret('PROTECTED', original, undefined, true);
vault.setManualSecret('ORDINARY', ordinary);
const proxy = new GhostProxyServer(vault, { host: '127.0.0.1', port: 0 });
const upstream = Fastify();
let upstreamBody = '';
upstream.post('/v1/chat/completions', async (request, reply) => {
  upstreamBody = JSON.stringify(request.body);
  return reply.type('text/event-stream').send('data: ' + JSON.stringify({ choices: [{ delta: { content: '$${<PROTECTED>}' } }] }) + '\n\ndata: [DONE]\n\n');
});
const target = await upstream.listen({ host: '127.0.0.1', port: 0 });
const origin = await proxy.listen();
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), 10000);
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
try {
  const route = await fetch(origin + '/api/routes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Synthetic stream', prefix: 'fixture', upstreamUrl: target }) });
  assert.equal(route.status, 201);
  const subscription = await fetch(origin + '/api/events', { signal: controller.signal });
  assert.equal(subscription.status, 200);
  reader = subscription.body!.getReader();
  const events = (async () => {
    let text = '';
    const decoder = new TextDecoder();
    while (true) {
      const chunk = await reader!.read();
      if (chunk.done) throw new Error('Event stream ended before fixture sentinel');
      text += decoder.decode(chunk.value, { stream: true });
      if (text.includes('fixture-end')) return text;
    }
  })();
  const response = await fetch(origin + '/fixture/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: original }] }) });
  assert.equal(response.status, 200);
  assert.equal((await response.text()).includes(original), true);
  assert.equal(upstreamBody.includes(original), false);
  assert.equal(upstreamBody.includes('$${<PROTECTED>}'), true);
  const project = vault.redactProtected;
  let failures = 0;
  vault.redactProtected = <T>(value: T): T => {
    if ((value as { type?: string })?.type === 'stream_progress') { failures++; throw new Error('synthetic projection failure'); }
    return project(value);
  };
  try {
    const isolated = await fetch(origin + '/fixture/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: original }] }) });
    const payload = await isolated.text();
    assert.equal(isolated.status, 200);
    assert.equal(payload.includes(original), true);
    assert.equal(payload.includes('Stream interrupted'), false);
    assert.ok(failures > 0);
  } finally { vault.redactProtected = project; }
  vault.setManualSecret('PROTECTED', updated, undefined, true);
  vault.deleteSecret('PROTECTED');
  const diagnostic = { id: 'retired-fixture', type: 'stream_progress' as const, timestamp: new Date().toISOString(), client: 'fixture', details: { text: original + '|' + updated + '|' + Buffer.from(original).toString('base64') + '|' + ordinary } };
  proxy.getEventBroadcaster().broadcast(diagnostic);
  assert.ok(diagnostic.details.text.includes(original));
  proxy.getEventBroadcaster().broadcast({ id: 'fixture-end', type: 'sessions_cleared', timestamp: new Date().toISOString(), client: 'fixture', details: {} });
  const received = await events;
  assert.ok(received.includes('stream_progress'));
  assert.ok(received.includes('outbound_masked'));
  assert.ok(received.includes('inbound_unmasked'));
  assert.ok(received.includes(ordinary));
  for (const secret of [original, updated]) for (const form of Object.values(VaultStore.computeVariants(secret))) assert.equal(received.includes(form), false);
  assert.ok(received.includes('$${<PROTECTED>}'));
  assert.equal(JSON.stringify(proxy.getRuntimeSessions().records()).includes(original), false);
  console.log('Real SSE interception/preview/retired forms filtered; projection failure isolated; final proxy payload exact PASS');
} finally {
  clearTimeout(timer);
  await reader?.cancel();
  controller.abort();
  await proxy.close();
  await upstream.close();
  db.close();
}
