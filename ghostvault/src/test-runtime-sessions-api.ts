import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { HookManager } from './hooks/manager.js';
import { AuditEvent } from './telemetry/types.js';

class RuntimeSessionsApiTests {
  public run = async (): Promise<void> => {
    const directory = mkdtempSync(join(tmpdir(), 'gv-runtime-api-'));
    const path = join(directory, 'vault.db');
    let db = new VaultDatabase(path);
    const seed = new DatabaseSync(path);
    seed.prepare('INSERT INTO sessions (id, client, first_seen, last_seen, tx_count) VALUES (?, ?, ?, ?, ?)').run('legacy', 'legacy', '', '', 1);
    seed.prepare('INSERT INTO transactions (id, session_id, client, method, url, status, latency_ms, prompt_text, masked_prompt, model_response, intercepted_secrets, timestamp) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run('legacy-tx', 'legacy', 'legacy', 'POST', '/openai/v1/chat/completions', 200, 1, 'synthetic-legacy-history', '', '', '[]', new Date().toISOString());
    seed.close();
    const baseline = JSON.stringify([db.getSessions(), db.getTransactions()]);
    const oldFetch = globalThis.fetch;
    const oldCapture = process.env.GHOSTVAULT_CAPTURE_DIR;
    process.env.GHOSTVAULT_CAPTURE_DIR = directory;
    let release = () => {};
    let began = () => {};
    const gate = new Promise<void>(resolve => { release = resolve; });
    const entered = new Promise<void>(resolve => { began = resolve; });
    let abortBegan = () => {};
    let abortEnded = () => {};
    const abortEntered = new Promise<void>(resolve => { abortBegan = resolve; });
    const abortFinished = new Promise<void>(resolve => { abortEnded = resolve; });
    globalThis.fetch = async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      const content = body.messages[0].content;
      if (content === 'slow-traffic-canary') { began(); await gate; }
      if (content === 'error-traffic-canary') throw new Error('synthetic transport error');
      if (content === 'abort-traffic-canary') { abortBegan(); await new Promise((_, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('synthetic abort')), { once: true })); }
      if (content === 'stream-traffic-canary') return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'stream-result-canary' } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
      return new Response(JSON.stringify({ choices: [{ message: { content: 'answer-' + content } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const hooks = new HookManager([{ beforeOutboundRequest: context => { if (context.body?.messages?.[0]?.content === 'hook-error') throw new Error('synthetic hook failure'); } }]);
    let server = new GhostProxyServer(new VaultStore(db), { port: 0, targetApiBase: 'http://127.0.0.1:1' }, hooks);
    globalThis.fetch = oldFetch;
    const events: AuditEvent[] = [];
    server.getEventBroadcaster().broadcast = event => { events.push(event); if (event.type === 'transaction_completed' && event.details.sessionId === 'aborted') abortEnded(); };
    const post = (session: string, content: string) => server.getApp().inject({ method: 'POST', url: '/openai/v1/chat/completions', headers: { 'x-session-id': session }, payload: { messages: [{ role: 'user', content }, { role: 'user', content: 'full-context-retained' }] } });
    try {
      assert.deepEqual((await server.getApp().inject('/api/sessions')).json(), []);
      assert.deepEqual((await server.getApp().inject('/api/history')).json(), []);
      assert.deepEqual((await server.getApp().inject('/api/hooks/context?id=legacy-tx')).json(), { empty: true });
      const slow = post('shared', 'slow-traffic-canary');
      await entered;
      const active = (await server.getApp().inject('/api/sessions')).json()[0];
      assert.equal(active.activeCalls, 1);
      assert.equal(active.state, 'active');
      assert.equal((await post('shared', 'new-traffic-canary')).statusCode, 200);
      release();
      assert.equal((await slow).statusCode, 200);
      const session = (await server.getApp().inject('/api/sessions/shared')).json();
      assert.equal(session.length, 1);
      assert.equal(session[0].request.body.messages[0].content, 'new-traffic-canary');
      assert.equal(session[0].request.body.messages[1].content, 'full-context-retained');
      assert.equal(session[0].response.body.content[0].text, 'answer-new-traffic-canary');
      assert.equal((await server.getApp().inject('/api/sessions')).json()[0].activeCalls, 0);
      assert.ok(events.some(event => event.type === 'transaction_completed' && event.details.latest === false));
      assert.equal((await server.getApp().inject('/api/history')).json().length, 1);
      assert.equal((await server.getApp().inject('/api/sessions/shared/full')).json().length, 3);
      const routes = (await server.getApp().inject('/api/routes')).json();
      assert.equal(routes.find((route: { id: string }) => route.id === 'openai').isUnusedPreset, false);
      assert.ok((await server.getApp().inject('/api/workspace')).json().visible.includes('openai'));
      assert.equal((await post('errors', 'error-traffic-canary')).statusCode, 502);
      assert.equal((await post('errors', 'hook-error')).statusCode, 500);
      assert.equal(server.getRuntimeSessions().list().find(item => item.id === 'errors')!.activeCalls, 0);
      assert.equal(server.getRuntimeSessions().bySession('errors')[0].response!.status, 500);
      const address = await server.listen();
      const controller = new AbortController();
      const aborted = oldFetch(address + '/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'aborted' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'abort-traffic-canary' }] }), signal: controller.signal });
      await abortEntered;
      controller.abort();
      await assert.rejects(aborted);
      await abortFinished;
      assert.equal(server.getRuntimeSessions().list().find(item => item.id === 'aborted')!.activeCalls, 0);
      assert.equal(server.getRuntimeSessions().bySession('aborted')[0].response!.status, 499);
      const streamed = await post('stream', 'stream-traffic-canary');
      assert.ok(streamed.body.includes('stream-result-canary'));
      assert.ok(server.getRuntimeSessions().bySession('stream')[0].response!.body.includes('stream-result-canary'));
      const snapshot = new Date(Date.now() + 1000).toISOString();
      const preview = await server.getApp().inject({ method: 'POST', url: '/api/pattern-preview', payload: { pattern: 'traffic-canary', snapshot } });
      assert.equal(preview.statusCode, 200);
      assert.equal(typeof preview.json().revision, 'number');
      assert.equal(preview.json().total, 4);
      await post('shared', 'changed-traffic-canary');
      const stale = await server.getApp().inject({ method: 'POST', url: '/api/pattern-preview', payload: { pattern: 'traffic-canary', snapshot, offset: 1, revision: preview.json().revision } });
      assert.equal(stale.statusCode, 409);
      await server.getApp().inject({ method: 'DELETE', url: '/api/sessions/shared' });
      assert.deepEqual((await server.getApp().inject('/api/sessions/shared')).json(), []);
      await server.getApp().inject({ method: 'DELETE', url: '/api/sessions' });
      assert.equal(server.getRuntimeSessions().stats().bytes, 0);
      assert.equal(JSON.stringify([db.getSessions(), db.getTransactions()]), baseline);
      assert.ok(!readdirSync(directory).some(file => file.startsWith('ghostvault-')));
      for (const file of readdirSync(directory).filter(file => file.startsWith('vault.db'))) {
        const bytes = readFileSync(join(directory, file));
        assert.equal(bytes.includes(Buffer.from('new-traffic-canary')), false);
        assert.equal(bytes.includes(Buffer.from('stream-result-canary')), false);
      }
      await server.close(); db.close();
      db = new VaultDatabase(path);
      server = new GhostProxyServer(new VaultStore(db), { targetApiBase: 'http://127.0.0.1:1' });
      assert.deepEqual((await server.getApp().inject('/api/sessions')).json(), []);
      assert.deepEqual((await server.getApp().inject('/api/history')).json(), []);
      assert.equal(JSON.stringify([db.getSessions(), db.getTransactions()]), baseline);
      console.log('PASS runtime API: legacy untouched, no SQLite/capture traffic, startup/restart empty, overlap, errors, stream, routes/workspace, latest preview/revision, full context and events');
    } finally {
      release(); globalThis.fetch = oldFetch;
      if (oldCapture === undefined) delete process.env.GHOSTVAULT_CAPTURE_DIR; else process.env.GHOSTVAULT_CAPTURE_DIR = oldCapture;
      await server.close(); db.close(); rmSync(directory, { recursive: true, force: true });
    }
  };
}

new RuntimeSessionsApiTests().run().catch(error => { console.error(error); process.exitCode = 1; });
