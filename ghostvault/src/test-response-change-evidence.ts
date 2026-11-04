import assert from 'node:assert/strict';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { ResponseChangeEvidence, ResponseChange } from './telemetry/response-change-evidence.js';
import { SseTransformer } from './proxy/sse-transformer.js';
import { PayloadCodec } from './protocols/payload-codec.js';
import { StreamContent } from './protocols/stream-content.js';
import { GhostProxyServer } from './proxy/server.js';
import { HookManager } from './hooks/manager.js';

class ResponseEvidenceTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private secret = this.vault.setManualSecret('EVIDENCE', 'synthetic:/old');
  private latest = this.vault.setManualSecret('EVIDENCE', 'synthetic:/"quoted"\\path😀');
  private snapshot = this.vault.snapshot();
  private evidence = () => new ResponseChangeEvidence(this.snapshot.getInboundReplacements());
  private frame = (body: unknown): string => 'data: ' + JSON.stringify(body) + '\n\n';

  private assertFragments = (items: ResponseChange[]): void => {
    for (const item of items) {
      assert.equal(item.before.text.slice(item.before.start, item.before.end), item.alias);
      assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
      assert.equal(item.key, 'EVIDENCE');
      assert.ok(item.before.contextStart >= 0 && item.after.contextStart >= 0);
      assert.ok(item.before.contextStart + item.before.text.length <= item.before.totalLength);
      assert.ok(item.after.contextStart + item.after.text.length <= item.after.totalLength);
      assert.ok(item.before.text.length <= item.alias.length + 194);
      assert.ok(item.after.text.length <= item.value.length + 194);
    }
  };

  private ordinary = (): void => {
    const evidence = this.evidence();
    const original = this.latest.realValue;
    const text = '😀'.repeat(200) + original + ' literal; ' + this.latest.alias + ' adjacent ' + this.latest.alias + ' end';
    const restored = evidence.restore(text);
    const items = evidence.snapshot().items;
    assert.equal(items.length, 2);
    assert.equal(items[0].fieldId, items[1].fieldId);
    this.assertFragments(items);
    for (const item of items) assert.equal(restored.slice(item.after.contextStart, item.after.contextStart + item.after.text.length), item.after.text);
    assert.equal(evidence.restore(original), original);
    assert.equal(evidence.restore('$${<UNKNOWN>}'), '$${<UNKNOWN>}');
    assert.equal(evidence.snapshot().items.length, 2);
    const forms = this.vault.getSecretRepresentations(this.latest);
    for (const form of forms) {
      const measured = this.evidence();
      assert.equal(measured.restore(form.alias), form.value);
      this.assertFragments(measured.snapshot().items);
    }
    const tools = this.evidence();
    const response = new PayloadCodec().response({ choices: [{ message: { content: original, tool_calls: [{ function: { name: 'synthetic', arguments: JSON.stringify({ value: this.latest.alias, untouched: original }) } }] } }] }, (value, source) => tools.restore(value, source || 'response-field')) as any;
    assert.equal(JSON.parse(response.choices[0].message.tool_calls[0].function.arguments).value, original);
    assert.equal(tools.snapshot().items.length, 1);
    assert.equal(tools.snapshot().items[0].source, 'tool-arguments');
    this.assertFragments(tools.snapshot().items);
  };

  private streaming = (): void => {
    const encoded = this.vault.getSecretRepresentations(this.latest).find(form => form.value === encodeURIComponent(this.latest.realValue))!;
    const text = 'prefix ' + this.latest.realValue + ' literal ' + encoded.alias + ' then ' + this.secret.alias + ' tail';
    for (let split = 0; split <= text.length; split++) {
      const evidence = this.evidence();
      const stream = new SseTransformer(this.snapshot, 32, () => {}, undefined, evidence);
      let output = stream.push(this.frame({ choices: [{ index: 0, delta: { content: text.slice(0, split) } }] }));
      output += stream.push(this.frame({ choices: [{ index: 0, delta: { content: text.slice(split) } }] }));
      assert.equal(evidence.snapshot().items.length, 0);
      output += stream.push(this.frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }));
      const read = new StreamContent().read(output).map(item => item.text || '').join('');
      assert.equal(read, text.replace(encoded.alias, encoded.value).replace(this.secret.alias, this.secret.realValue));
      assert.equal(evidence.snapshot().items.length, 2);
      this.assertFragments(evidence.snapshot().items);
      for (const item of evidence.snapshot().items) assert.equal(read.slice(item.after.contextStart, item.after.contextStart + item.after.text.length), item.after.text);
    }
    const evidence = this.evidence();
    const stream = new SseTransformer(this.snapshot, 32, () => {}, undefined, evidence);
    const args = JSON.stringify({ nested: { value: this.latest.alias }, plain: this.latest.realValue });
    let output = '';
    for (const character of args) output += stream.push(this.frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: character } }] } }] }));
    output += stream.push(this.frame({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }));
    assert.equal(new StreamContent().read(output).find(item => item.type === 'tool_use')!.input.nested.value, this.latest.realValue);
    assert.equal(evidence.snapshot().items.length, 1);
    assert.equal(evidence.snapshot().items[0].source, 'tool-arguments');
    this.assertFragments(evidence.snapshot().items);
    const repeated = this.evidence();
    const responses = new SseTransformer(this.snapshot, 32, () => {}, undefined, repeated);
    responses.push(this.frame({ type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: this.latest.alias }));
    responses.push(this.frame({ type: 'response.output_text.done', output_index: 0, content_index: 0, text: this.latest.alias }));
    assert.deepEqual(repeated.snapshot().items.map(item => item.source), ['stream-text', 'protocol-snapshot']);
    assert.equal(new Set(repeated.snapshot().items.map(item => item.fieldId)).size, 2);
    const interrupted = this.evidence();
    const partial = new SseTransformer(this.snapshot, 32, () => {}, undefined, interrupted);
    partial.push(this.frame({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: args } }] } }] }));
    partial.push(this.frame({ type: 'error', error: { message: 'synthetic interruption' } }));
    partial.flush(false);
    interrupted.finish('complete');
    assert.equal(interrupted.snapshot().status, 'interrupted');
    assert.equal(interrupted.snapshot().items.length, 0);
  };

  private gateway = async (): Promise<void> => {
    const oldFetch = globalThis.fetch;
    let current = 'json';
    let received = '';
    const prefix = 'synthetic context '.repeat(120);
    const text = prefix + this.latest.realValue + ' literal ' + this.latest.alias + ' restored ' + this.secret.alias + ' tail '.repeat(120);
    globalThis.fetch = async (_url, init) => {
      received = String(init?.body);
      if (current === 'failure') return new Response('synthetic upstream error', { status: 400 });
      if (current === 'text') return new Response(this.latest.realValue, { headers: { 'content-type': 'text/plain' } });
      if (current === 'plain') return new Response(JSON.stringify({ choices: [{ message: { content: this.latest.realValue } }] }), { headers: { 'content-type': 'application/json' } });
      if (current === 'stream') {
        const wire = this.frame({ choices: [{ index: 0, delta: { content: text.slice(0, prefix.length + 40) } }] }) + this.frame({ choices: [{ index: 0, delta: { content: text.slice(prefix.length + 40) } }] }) + this.frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n';
        return new Response(new ReadableStream({ start: controller => { const bytes = new TextEncoder().encode(wire); for (let index = 0; index < bytes.length; index += 7) controller.enqueue(bytes.slice(index, index + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
      }
      if (current === 'deleted') this.vault.deleteSecret('EVIDENCE');
      return new Response(JSON.stringify({ id: this.latest.alias, choices: [{ message: { content: text } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const hooks = new HookManager([{ afterInboundUnmask: body => current === 'hook' ? body.replace('tail', 'changed-by-hook') : body }]);
    const server = new GhostProxyServer(this.vault, { targetApiBase: 'http://127.0.0.1:1' }, hooks);
    globalThis.fetch = oldFetch;
    try {
      for (const mode of ['json', 'stream', 'plain', 'text', 'hook', 'failure', 'deleted']) {
        current = mode;
        const result = await server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', headers: { 'x-session-id': 'response-evidence' }, payload: { messages: [{ role: 'user', content: prefix + this.latest.realValue }] } });
        assert.equal(result.statusCode, mode === 'failure' ? 400 : 200);
        assert.ok(received.includes(this.latest.alias));
        const record = server.getLastTransactionContext()!;
        const changes = record.responseChanges!;
        assert.equal(changes.status, mode === 'failure' ? 'not-processed' : 'complete');
        assert.equal(changes.items.length, ['plain', 'text', 'failure'].includes(mode) ? 0 : 2);
        assert.equal(changes.postHookModified, mode === 'hook');
        this.assertFragments(changes.items);
        if (mode === 'json') assert.equal(result.json().id, this.latest.alias);
        assert.equal(server.getRuntimeSessions().records().length, 1);
        assert.equal(this.db.getTransactions().length, 0);
        const api = await server.getApp().inject('/api/sessions/response-evidence');
        assert.deepEqual(api.json()[0].responseChanges, changes);
        assert.ok(server.getRuntimeSessions().stats().bytes >= Buffer.byteLength(JSON.stringify(changes)));
      }
      await server.getApp().inject({ method: 'DELETE', url: '/api/sessions/response-evidence' });
      assert.equal(server.getRuntimeSessions().stats().bytes, 0);
    } finally { globalThis.fetch = oldFetch; await server.close(); }
  };

  public run = async (): Promise<void> => {
    try { this.ordinary(); this.streaming(); await this.gateway(); console.log('PASS response evidence: actual replacement fragments, literals/unknowns excluded, UTF-16/context merge, encoded/versioned aliases, all chunk splits, decoded tool JSON, protocol duplicates, interruption, hooks, request snapshot deletion, RAM/latest budget and API'); }
    finally { this.db.close(); }
  };
}

new ResponseEvidenceTests().run().catch(error => { console.error(error); process.exitCode = 1; });
