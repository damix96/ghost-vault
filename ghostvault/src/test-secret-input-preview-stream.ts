import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { createParser } from 'eventsource-parser';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { ResponseNormalizer } from './proxy/response-normalizer.js';

const db = new VaultDatabase(':memory:');
const vault = new VaultStore(db);
const secret = 'synthetic-stream-boundary-$${<PUBLIC>}' + 'x'.repeat(512) + '-ending';
const leading = 'ordinary lead: ';
vault.setManualSecret('PREVIEW', secret, undefined, true);
const proxy = new GhostProxyServer(vault, { host: '127.0.0.1', port: 0, maxBufferWindowChars: 64 });
const upstream = Fastify();
let releaseBoundary!: () => void;
const boundary = new Promise<void>(resolve => { releaseBoundary = resolve; });
let upstreamBody = '';
upstream.post('/v1/chat/completions', async (request, reply) => {
  upstreamBody = JSON.stringify(request.body);
  reply.hijack();
  reply.raw.writeHead(200, { 'content-type': 'text/event-stream' });
  reply.raw.write('data: ' + JSON.stringify({ choices: [{ delta: { content: leading + '$${<PREVIEW>}' } }] }) + '\n\n');
  await boundary;
  reply.raw.end('data: [DONE]\n\n');
});
const target = await upstream.listen({ host: '127.0.0.1', port: 0 });
const origin = await proxy.listen();
const controller = new AbortController();
const timer = setTimeout(() => { releaseBoundary(); controller.abort(); }, 10000);
let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
let eventTask: Promise<string> | undefined;
const progress: string[] = [];
try {
  const route = await fetch(origin + '/api/routes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Preview boundary', prefix: 'fixture', upstreamUrl: target }) });
  assert.equal(route.status, 201);
  const subscription = await fetch(origin + '/api/events', { signal: controller.signal });
  assert.equal(subscription.status, 200);
  reader = subscription.body!.getReader();
  eventTask = (async () => {
    let received = '';
    let ended = false;
    const decoder = new TextDecoder();
    const parser = createParser({ onEvent: event => {
      const value = JSON.parse(event.data);
      if (value.type === 'stream_progress') { progress.push(value.details.text); releaseBoundary(); }
      if (value.id === 'preview-fixture-end') ended = true;
    } });
    while (!ended) {
      const chunk = await reader!.read();
      if (chunk.done) throw new Error('Preview fixture event stream ended early');
      const text = decoder.decode(chunk.value, { stream: true });
      received += text;
      parser.feed(text);
    }
    return received;
  })();
  void eventTask.catch(() => releaseBoundary());
  const response = await fetch(origin + '/fixture/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: secret }] }), signal: controller.signal });
  assert.equal(response.status, 200);
  const payload = await response.text();
  const content = ResponseNormalizer.normalize(payload).content.filter((block: { type: string }) => block.type === 'text').map((block: { text: string }) => block.text).join('');
  assert.equal(content, leading + secret);
  assert.equal(upstreamBody.includes(secret), false);
  assert.ok(upstreamBody.includes('$${<PREVIEW>}'));
  proxy.getEventBroadcaster().broadcast({ id: 'preview-fixture-end', type: 'sessions_cleared', timestamp: new Date().toISOString(), client: 'fixture', details: {} });
  const received = await eventTask;
  assert.ok(progress.length > 0);
  assert.equal(progress[0], leading);
  assert.equal(received.includes(secret.slice(0, 32)), false);
  assert.ok(received.includes('$${<PREVIEW>}'));
  console.log('Actual streamed restored secret crosses preview window: ambiguous prefix hidden, ordinary lead/token/client payload preserved PASS');
} finally {
  clearTimeout(timer);
  releaseBoundary();
  await reader?.cancel();
  controller.abort();
  await eventTask?.catch(() => undefined);
  await proxy.close();
  await upstream.close();
  db.close();
}
