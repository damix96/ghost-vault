import assert from 'node:assert/strict';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { ResponseChangeEvidence } from './telemetry/response-change-evidence.js';
import { StreamContent } from './protocols/stream-content.js';
import { HookManager } from './hooks/manager.js';
import { EvidenceProjectionContractTests } from './test-protected-evidence-projection.js';
import { EventEmitter } from 'node:events';
import { ProtectedResponseProjection } from './telemetry/protected-response-projection.js';

class ProtectedResponseEvidenceTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private ordinary = this.vault.setManualSecret('ORDINARY', 'ordinary-visible-value');
  private current = 'CURRENT-private-'.repeat(24) + '/😀\r\n-ending';
  private retired = 'RETIRED-private-'.repeat(24) + '/😀\r\n-ending';
  private deleted = 'DELETED-private-'.repeat(24) + '/😀\r\n-ending';
  private body = '';
  private stream = false;
  private tools = false;
  private hookBody = '';
  private hookStream = '';
  private serial = 0;
  private originalFetch = globalThis.fetch;
  private server: GhostProxyServer;
  private paused = false;
  private upstreamDone = false;
  private finish = (): void => {};

  constructor() {
    this.vault.setManualSecret('PRIVATE', this.retired, undefined, true);
    this.vault.setManualSecret('PRIVATE', this.current, undefined, true);
    this.vault.setManualSecret('DELETED', this.deleted, undefined, true);
    this.vault.deleteSecret('DELETED');
    globalThis.fetch = this.fetch;
    const hooks = new HookManager([{ afterInboundUnmask: body => { this.hookBody = body; return body; }, afterStream: context => { this.hookStream = context.accumulatedText; } }]);
    this.server = new GhostProxyServer(this.vault, { targetApiBase: 'http://127.0.0.1:1' }, hooks);
    globalThis.fetch = this.originalFetch;
  }

  private frame = (body: unknown): string => 'data: ' + JSON.stringify(body) + '\n\n';
  private fetch = async (): Promise<Response> => {
    if (!this.stream) return new Response(JSON.stringify({ choices: [{ message: this.tools ? { tool_calls: [{ function: { name: 'synthetic', arguments: JSON.stringify({ text: this.body }) } }] } : { content: this.body } }] }), { headers: { 'content-type': 'application/json' } });
    if (this.paused) return new Response(new ReadableStream({ start: controller => {
      controller.enqueue(new TextEncoder().encode(this.frame({ choices: [{ index: 0, delta: { content: this.body } }] })));
      this.finish = () => { this.upstreamDone = true; controller.enqueue(new TextEncoder().encode(this.frame({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }) + 'data: [DONE]\n\n')); controller.close(); };
    } }), { headers: { 'content-type': 'text/event-stream' } });
    const text = this.tools ? JSON.stringify({ text: this.body }) : this.body;
    let wire = '';
    for (let offset = 0; offset < text.length; offset += 17) {
      const chunk = text.slice(offset, offset + 17);
      const delta = this.tools ? { tool_calls: [{ index: 0, function: { name: 'synthetic', arguments: chunk } }] } : { content: chunk };
      wire += this.frame({ choices: [{ index: 0, delta }] });
    }
    wire += this.frame({ choices: [{ index: 0, delta: {}, finish_reason: this.tools ? 'tool_calls' : 'stop' }] }) + 'data: [DONE]\n\n';
    return new Response(new ReadableStream({ start: controller => { const bytes = new TextEncoder().encode(wire); for (let offset = 0; offset < bytes.length; offset += 11) controller.enqueue(bytes.slice(offset, offset + 11)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
  };

  private request = async (text: string, stream = false, tools = false) => {
    this.body = text;
    this.stream = stream;
    this.tools = tools;
    const session = 'protected-context-' + (++this.serial);
    const snapshot = this.vault.snapshot();
    const expected = snapshot.unmaskInboundText(text);
    const response = await this.server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', headers: { 'x-session-id': session }, payload: { messages: [{ role: 'user', content: 'synthetic request' }], stream } });
    assert.equal(response.statusCode, 200);
    const content = stream ? new StreamContent().read(response.body) : [];
    const actual = stream ? tools ? content.find(item => item.type === 'tool_use')?.input.text : content.map(item => item.text || '').join('') : tools ? JSON.parse(response.json().choices[0].message.tool_calls[0].function.arguments).text : response.json().choices[0].message.content;
    assert.equal(actual, expected);
    if (stream) assert.equal(this.hookStream, response.body);
    else assert.deepEqual(JSON.parse(this.hookBody), response.json());
    const history = await this.server.getApp().inject('/api/sessions/' + session);
    assert.equal(history.statusCode, 200);
    const publicRecord = history.json()[0];
    const changes = publicRecord.responseChanges;
    assert.equal(changes.status, 'complete');
    return { changes, expected, snapshot, publicRecord, wire: response.body, session };
  };

  private retained = async (): Promise<void> => {
    const oldValue = 'old-public"\\😀\0-value';
    const publicEntry = this.vault.setManualSecret('LATE_PUBLIC', oldValue);
    const value = 'late-private-prefix-'.repeat(24) + publicEntry.alias + 'late-private-suffix-'.repeat(24);
    const secret = this.vault.setManualSecret('LATE_COMPOSITE', value);
    const sessions: string[] = [];
    for (const mode of ['json', 'stream', 'tool', 'stream-tool']) {
      const result = await this.request(value + ' gap ' + this.ordinary.alias, mode.includes('stream'), mode.includes('tool'));
      assert.ok(result.expected.includes(oldValue));
      assert.ok(JSON.stringify(result.publicRecord.response).includes(value.slice(0, 48)));
      sessions.push(result.session);
    }
    this.vault.setManualSecret('LATE_PUBLIC', 'new-public-value');
    this.vault.setManualSecret('LATE_COMPOSITE', value, undefined, true);
    const check = async (): Promise<void> => {
      for (const session of sessions) {
        const response = await this.server.getApp().inject('/api/sessions/' + session);
        assert.equal(response.statusCode, 200);
        assert.equal(response.body.includes(value.slice(0, 48)), false);
        assert.equal(response.body.includes(value.slice(-48)), false);
        const change = response.json()[0].responseChanges.items.find((item: { alias: string }) => item.alias === publicEntry.alias);
        assert.equal(change.value, secret.alias);
        assert.equal(change.after.text.slice(change.after.start, change.after.end), change.value);
      }
    };
    await check();
    const fresh = await this.request(value + ' gap ' + this.ordinary.alias, true);
    assert.ok(fresh.expected.includes('new-public-value'));
    assert.equal(JSON.stringify(fresh.publicRecord).includes(value.slice(0, 48)), false);
    this.vault.setManualSecret('LATE_COMPOSITE', 'replacement-late-private-value', undefined, true);
    this.vault.deleteSecret('LATE_COMPOSITE');
    await check();
    for (const session of [...sessions, fresh.session]) this.server.clearTransactionHistory(session);
    for (const session of sessions) assert.deepEqual((await this.server.getApp().inject('/api/sessions/' + session)).json(), []);
  };

  private rawControls = async (): Promise<void> => {
    const publicEntry = this.vault.setManualSecret('RAW_PUBLIC', 'expanded-raw-public-value');
    const value = 'raw-private-prefix-'.repeat(24) + publicEntry.alias + 'raw-private-suffix-'.repeat(24);
    const secret = this.vault.setManualSecret('RAW_COMPOSITE', value, undefined, true);
    const protectedResponse = await this.request(secret.alias, true);
    assert.equal(protectedResponse.publicRecord.response.body.raw, ProtectedResponseProjection.omitted);
    assert.equal(protectedResponse.publicRecord.response.body.content[0].text, secret.alias);
    assert.equal(protectedResponse.publicRecord.sampleStreamChunk, ProtectedResponseProjection.omitted);
    assert.equal(JSON.stringify(protectedResponse.publicRecord).includes(value.slice(0, 48)), false);
    assert.equal(JSON.stringify(protectedResponse.publicRecord).includes(value.slice(-48)), false);
    const ordinary = await this.request('ordinary raw control ' + this.ordinary.alias + ' tail', true);
    assert.equal(ordinary.publicRecord.response.body.raw, ordinary.wire);
  };

  private early = async (): Promise<void> => {
    const publicEntry = this.vault.setManualSecret('EARLY_PUBLIC', 'expanded-early-public-value');
    const value = 'early-private-prefix-'.repeat(24) + publicEntry.alias + 'early-private-suffix-'.repeat(24);
    this.vault.setManualSecret('EARLY_COMPOSITE', value, undefined, true);
    let early: string | undefined;
    const raw = new EventEmitter() as EventEmitter & { writeHead: () => void; write: (text: string) => boolean; end: () => void };
    raw.writeHead = () => {};
    raw.end = () => { raw.emit('close'); };
    raw.write = text => {
      if (text.startsWith('data: ')) {
        const event = JSON.parse(text.slice(6));
        if (event.type === 'stream_progress' && !this.upstreamDone) { early = event.details.text; this.finish(); }
      }
      return true;
    };
    this.server.getEventBroadcaster().subscribe({ hijack: () => {}, raw } as never);
    this.paused = true;
    this.upstreamDone = false;
    const deadline = setTimeout(() => { if (!this.upstreamDone) this.finish(); }, 5000);
    try {
      await this.request(value, true);
      assert.equal(typeof early, 'string');
      assert.equal(early!.includes(value.slice(0, 48)), false);
      assert.equal(early!.includes(value.slice(-48)), false);
    } finally { clearTimeout(deadline); raw.end(); this.paused = false; }
  };

  private ordinaryControl = async (): Promise<void> => {
    const text = '😀 ordinary context '.repeat(20) + this.ordinary.alias + ' unchanged tail '.repeat(30);
    const { changes, snapshot } = await this.request(text);
    const baseline = new ResponseChangeEvidence(snapshot.getInboundReplacements());
    baseline.restore(text);
    baseline.finish('complete');
    assert.deepEqual(changes, baseline.snapshot());
  };

  private failedProjector = async (): Promise<void> => {
    const snapshot = this.vault.snapshot;
    this.vault.snapshot = () => {
      const captured = snapshot();
      return { ...captured, diagnostics: { ...captured.diagnostics, project: (): never => { throw new Error('synthetic context projector failure'); } } };
    };
    try { assert.deepEqual((await this.request('$${<PRIVATE>}')).changes.items, []); }
    finally { this.vault.snapshot = snapshot; }
  };

  private failedEstimate = async (): Promise<void> => {
    const snapshot = this.vault.snapshot;
    this.vault.snapshot = () => {
      const captured = snapshot();
      return { ...captured, diagnostics: { ...captured.diagnostics, estimatedBytes: (): never => { throw new Error('synthetic estimate failure'); } } };
    };
    try {
      assert.equal((await this.request('$${<PRIVATE>}')).changes.items.length, 1);
      const stats = this.server.getRuntimeSessions().stats();
      assert.ok(stats.bytes > stats.budgetBytes);
    } finally { this.vault.snapshot = snapshot; this.server.clearTransactionHistory(); }
  };

  private composite = async (): Promise<void> => {
    const exposed: string[] = [];
    const publicEntry = this.vault.setManualSecret('PUBLIC', 'expanded-public-value');
    const value = 'private-prefix-'.repeat(24) + publicEntry.alias + 'private-suffix-'.repeat(24);
    const secret = this.vault.setManualSecret('COMPOSITE', value, undefined, true);
    for (const retired of [false, true]) {
      if (retired) { this.vault.setManualSecret('COMPOSITE', 'different-private-value', undefined, true); this.vault.deleteSecret('COMPOSITE'); }
      for (const mode of ['json', 'stream', 'tool', 'stream-tool']) {
        const input = value + ' gap ' + this.ordinary.alias;
        const { changes, publicRecord } = await this.request(input, mode.includes('stream'), mode.includes('tool'));
        assert.equal(changes.items.length, 2);
        const expectedBefore = secret.alias + ' gap ' + this.ordinary.alias;
        const expectedAfter = secret.alias + ' gap ' + this.ordinary.realValue;
        for (const item of changes.items) {
          assert.equal(item.before.text, expectedBefore);
          assert.equal(item.after.text, expectedAfter);
          assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
          assert.equal(item.after.totalLength, expectedAfter.length);
        }
        assert.equal(changes.items[0].key, 'PUBLIC');
        assert.equal(changes.items[0].alias, publicEntry.alias);
        assert.equal(changes.items[0].value, secret.alias);
        assert.equal(changes.items[1].value, this.ordinary.realValue);
        const publicResponse = JSON.stringify(publicRecord.response);
        if (publicResponse.includes(value.slice(0, 48)) || publicResponse.includes(value.slice(-48))) exposed.push((retired ? 'retired-' : 'current-') + mode);
      }
    }
    assert.deepEqual(exposed, [], 'Transformed composite remained in full public response');
  };

  private projected = async (text: string, stream = false, tools = false): Promise<void> => {
    const { changes, expected } = await this.request(text, stream, tools);
    assert.ok(changes.items.length > 0);
    const before = this.vault.redactProtected(text);
    const after = this.vault.redactProtected(expected);
    for (const item of changes.items) {
      for (const [part, full] of [[item.before, before], [item.after, after]] as const) {
        assert.equal(part.text, full.slice(part.contextStart, part.contextStart + part.text.length));
        assert.ok(part.start >= 0 && part.end >= part.start && part.end <= part.text.length);
        assert.equal(part.totalLength, full.length);
        assert.ok(part.contextStart + part.text.length <= full.length);
        assert.equal(/^[\uDC00-\uDFFF]/.test(part.text), false);
        assert.equal(/[\uD800-\uDBFF]$/.test(part.text), false);
      }
      assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
      assert.equal(item.before.text.slice(item.before.start, item.before.end), item.alias);
      assert.equal(typeof item.key, 'string');
      for (const value of [this.current, this.retired, this.deleted]) for (const form of new Set(Object.values(VaultStore.computeVariants(value)))) {
        for (const part of [item.before.text, item.after.text, item.value]) {
          assert.equal(part.includes(form.slice(0, 48)), false);
          assert.equal(part.includes(form.slice(-48)), false);
        }
      }
    }
  };

  public run = async (): Promise<void> => {
    try {
      await this.ordinaryControl();
      for (const value of [this.current, this.retired, this.deleted]) for (const form of new Set(Object.values(VaultStore.computeVariants(value)))) {
        await this.projected(form + ' gap ' + this.ordinary.alias + ' gap ' + form);
      }
      for (const distance of [0, 95, 96, 97]) {
        const gap = ' '.repeat(distance);
        await this.projected(this.current + gap + this.ordinary.alias + gap + this.retired);
        await this.projected('😀'.repeat(100) + gap + '$${<PRIVATE>}' + gap + this.deleted);
      }
      await this.projected(this.current + ' gap ' + this.ordinary.alias + ' gap ' + this.retired, true);
      await this.projected(this.deleted + ' gap $${<PRIVATE>} gap ' + this.current, true);
      await this.projected(this.current + ' gap ' + this.ordinary.alias + ' gap ' + this.deleted, false, true);
      await this.failedProjector();
      await this.failedEstimate();
      await this.composite();
      await this.rawControls();
      await this.early();
      await this.retained();
      console.log('PASS protected response evidence: safe full history/contexts/raw/pre-DONE preview, late mark/update/delete with old snapshots, JSON/SSE/tools, ordinary wire/client/hooks exact');
    } finally { globalThis.fetch = this.originalFetch; await this.server.close(); this.db.close(); }
  };
}

new EvidenceProjectionContractTests().run();
if (!process.argv.includes('--projection-only')) await new ProtectedResponseEvidenceTests().run();
