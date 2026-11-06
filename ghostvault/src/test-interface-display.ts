import assert from 'node:assert/strict';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

class InterfaceDisplayTests {
  private events = async (): Promise<void> => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const secret = vault.setManualSecret('LIVE', 'synthetic-private-event', undefined, true);
    const server = new GhostProxyServer(vault, { port: 0 });
    const base = await server.listen();
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(5000)]);
    try {
      assert.equal((await fetch(base + '/api/interface/events')).status, 403);
      assert.equal((await fetch(base + '/api/interface/events', { headers: { 'sec-fetch-site': 'cross-site' } })).status, 403);
      const safe = await fetch(base + '/api/events', { signal });
      const original = await fetch(base + '/api/interface/events', { headers: { 'sec-fetch-site': 'same-origin' }, signal });
      assert.equal(original.status, 200);
      const read = async (response: Response): Promise<any> => {
        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let value = '';
        try {
          while (!value.includes('data: ')) { const part = await reader.read(); if (part.done) throw new Error('No SSE event'); value += decoder.decode(part.value); }
          return JSON.parse(value.split('data: ')[1].split('\n')[0]);
        } finally { await reader.cancel(); }
      };
      const expected = { id: 'live', type: 'stream_progress' as const, timestamp: new Date().toISOString(), client: 'fixture', details: { text: 'ordinary text ' + secret.realValue } };
      server.getEventBroadcaster().broadcast({ ...expected, details: { text: 'ordinary text ' + secret.alias } }, expected);
      assert.equal((await read(safe)).details.text, 'ordinary text ' + secret.alias);
      assert.equal((await read(original)).details.text, 'ordinary text ' + secret.realValue);
    } finally { abort.abort(); await server.close(); db.close(); }
  };
  private runCase = async (stream: boolean): Promise<void> => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const secret = vault.setManualSecret('ENCRYPTED', 'synthetic-private-original', undefined, true);
    const ordinary = vault.setManualSecret('PLAIN', 'synthetic-ordinary-visible');
    const originalFetch = globalThis.fetch;
    let sent = '';
    globalThis.fetch = async (_url, options) => {
      sent = JSON.parse(String(options?.body)).messages[0].content;
      const text = 'normal text ' + secret.alias + ' / ' + ordinary.alias;
      return stream ? new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: text } }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } }) : new Response(JSON.stringify({ choices: [{ message: { content: text } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const server = new GhostProxyServer(vault, { port: 0, targetApiBase: 'http://127.0.0.1:1' });
    globalThis.fetch = originalFetch;
    const app = server.getApp();
    const headers = { host: '127.0.0.1', origin: 'http://127.0.0.1', 'x-ghostvault-display': 'original' };
    const display = async (url: string) => (await app.inject({ method: 'POST', url: '/api/interface/' + url, headers, payload: {} })).json();
    try {
      for (const invalid of [{ host: '127.0.0.1' }, { ...headers, origin: 'https://foreign.invalid' }, { ...headers, 'sec-fetch-site': 'cross-site' }, { ...headers, 'x-ghostvault-display': '' }]) {
        assert.equal((await app.inject({ method: 'POST', url: '/api/interface/vault', headers: invalid, payload: {} })).statusCode, 403);
      }
      const shown = await display('vault');
      assert.equal(shown.manual.find((row: any) => row.key === secret.key).realValue, secret.realValue);
      const hidden = (await app.inject('/api/vault')).json();
      assert.equal(hidden.manual.find((row: any) => row.key === secret.key).realValue, undefined);
      assert.equal(hidden.manual.find((row: any) => row.key === ordinary.key).realValue, ordinary.realValue);
      const result = await app.inject({ method: 'POST', url: '/v1/chat/completions', headers: { 'x-session-id': 'display' }, payload: { stream, messages: [{ role: 'user', content: secret.realValue + ' / ' + ordinary.realValue }] } });
      assert.equal(result.statusCode, 200);
      assert.equal(sent, secret.alias + ' / ' + ordinary.alias);
      assert.ok(result.body.includes(secret.realValue));
      const safe = (await app.inject('/api/sessions/display')).json();
      assert.ok(!JSON.stringify(safe).includes(secret.realValue));
      assert.ok(JSON.stringify(safe).includes(ordinary.realValue));
      assert.ok(safe[0].responseChanges.items.find((row: any) => row.key === secret.key).valueHidden);
      const visible = (await display('sessions/display'))[0];
      assert.ok(JSON.stringify(visible).includes(secret.realValue));
      const change = visible.responseChanges.items.find((row: any) => row.key === secret.key);
      assert.equal(change.value, secret.realValue);
      assert.equal(change.before.text.slice(change.before.start, change.before.end), secret.alias);
      assert.equal(change.after.text.slice(change.after.start, change.after.end), secret.realValue);
      assert.ok(!change.valueHidden);
      vault.setManualSecret(secret.key, 'synthetic-private-next');
      const old = (await display('sessions/display'))[0];
      assert.equal(old.responseChanges.items.find((row: any) => row.key === secret.key).value, secret.realValue);
      assert.ok(!JSON.stringify(old).includes('synthetic-private-next'));
      assert.ok(!JSON.stringify((await app.inject('/api/sessions/display')).json()).includes(secret.realValue));
      server.clearTransactionHistory();
      assert.deepEqual(await display('sessions/display'), []);
      assert.equal(server.getRuntimeSessions().stats().bytes, 0);
    } finally { globalThis.fetch = originalFetch; await server.close(); db.close(); }
  };

  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP native Windows display fixture'); return; }
    await this.runCase(false);
    await this.runCase(true);
    await this.events();
    console.log('PASS interface display: explicit original access, encrypted-only hiding, ordinary visibility, exact request snapshots, JSON/SSE, guards and retention clear');
  };
}

new InterfaceDisplayTests().run().catch(error => { console.error(error); process.exitCode = 1; });
