import assert from 'node:assert/strict';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

class VariableRequestTests {
  private protectedMode = process.argv.includes('--protected');
  private simultaneous = async (stream: boolean, rename = false): Promise<void> => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const originalFetch = globalThis.fetch;
    let entered!: () => void;
    let release!: () => void;
    const firstEntered = new Promise<void>(resolve => { entered = resolve; });
    const firstResponse = new Promise<void>(resolve => { release = resolve; });
    let requests = 0;
    const sentTokens: string[] = [];
    globalThis.fetch = async (_url, init) => {
      const content = JSON.parse(String(init?.body)).messages[0].content;
      sentTokens.push(content);
      if (++requests === 1) { entered(); await firstResponse; }
      if (!stream) return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
      const events = [content.slice(0, 5), content.slice(5)].map(fragment => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: fragment } }] }) + '\n\n').join('') + 'data: [DONE]\n\n';
      return new Response(events, { headers: { 'content-type': 'text/event-stream' } });
    };
    const server = new GhostProxyServer(vault, { targetApiBase: 'http://127.0.0.1:1' });
    globalThis.fetch = originalFetch;
    try {
      const first = vault.setManualSecret('CONCURRENT', 'synthetic-first', undefined, this.protectedMode);
      const request = (content: string, sessionId = 'fresh') => server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', headers: { 'x-session-id': sessionId }, payload: { stream, messages: [{ role: 'user', content }] } });
      const pending = request(first.realValue, 'old').then(response => response);
      await firstEntered;
      const current = rename ? vault.renameManualSecret('CONCURRENT', 'RENAMED')! : vault.setManualSecret('CONCURRENT', 'synthetic-second');
      assert.equal(Boolean(current.isSecret), this.protectedMode);
      const second = await request(current.realValue, 'new');
      assert.equal(second.statusCode, 200);
      assert.ok(second.body.includes(current.realValue));
      if (!rename) assert.ok(!second.body.includes(first.realValue));
      assert.equal(sentTokens[0], first.alias);
      assert.equal(sentTokens[1], current.alias);
      release();
      const completed = await pending;
      assert.equal(completed.statusCode, 200);
      assert.ok(completed.body.includes(first.realValue));
      if (!rename) assert.ok(!completed.body.includes(current.realValue));
      for (const [sessionId, secret] of [['old', first], ['new', current]] as const) {
        const evidence = server.getTransactionHistory().find(record => record.sessionId === sessionId)!.responseChanges!;
        assert.equal(evidence.status, 'complete');
        assert.equal(evidence.items.length, 1);
        assert.equal(evidence.items[0].key, secret.key);
        assert.equal(evidence.items[0].alias, secret.alias);
        if (this.protectedMode) {
          assert.ok([first.alias, current.alias].includes(evidence.items[0].value));
          assert.ok(!JSON.stringify(evidence).includes(first.realValue));
          assert.ok(!JSON.stringify(evidence).includes(current.realValue));
        } else assert.equal(evidence.items[0].value, secret.realValue);
      }
      const fresh = await request(first.alias);
      assert.ok(fresh.body.includes(rename ? first.alias : current.realValue));
      assert.equal(requests, 3);
      assert.equal(server.getTransactionHistory().find(record => record.sessionId === 'fresh')!.responseChanges!.items.length, rename ? 0 : 1);
      if (rename) {
        const currentName = await request(current.alias);
        assert.ok(currentName.body.includes(current.realValue));
        assert.ok(!currentName.body.includes(current.alias));
      }
    } finally { release(); globalThis.fetch = originalFetch; await server.close(); db.close(); }
  };

  public run = async (): Promise<void> => {
    if (this.protectedMode && process.platform !== 'win32') { console.log('SKIP real Windows protected request test'); return; }
    await this.simultaneous(false);
    await this.simultaneous(true);
    await this.simultaneous(true, true);
    console.log('PASS ' + (this.protectedMode ? 'protected' : 'ordinary') + ' variable requests: overlapping buffered/streamed updates and streamed rename preserve request snapshots; fresh requests use current values/names');
  };
}

new VariableRequestTests().run().catch(error => { console.error(error); process.exitCode = 1; });
