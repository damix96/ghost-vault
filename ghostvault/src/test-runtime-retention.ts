import assert from 'node:assert/strict';
import { RuntimeSessions } from './proxy/runtime-sessions.js';
import { TransactionRecord } from './telemetry/types.js';

export class RuntimeRetentionTests {
  private make = (sessionId: string, id: string, content = 'synthetic'): TransactionRecord => ({ id, sessionId, timestamp: new Date().toISOString(), request: { method: 'POST', url: '/openai/v1/chat/completions', headers: {}, client: 'synthetic', body: { messages: [{ role: 'user', content }, { role: 'user', content }] } }, interceptedSecrets: [] });

  private concurrency = (): void => {
    const runtime = new RuntimeSessions();
    const first = runtime.begin(this.make('same', 'first'));
    const second = runtime.begin(this.make('same', 'second', 'complete context'));
    assert.equal(runtime.list()[0].activeCalls, 2);
    assert.equal(runtime.records().length, 1);
    assert.equal(runtime.find('first'), undefined);
    assert.equal(first.update(this.make('same', 'first', 'late result')), false);
    second.end();
    assert.equal(runtime.list()[0].state, 'complete');
    assert.equal(runtime.list()[0].activeCalls, 1);
    first.end(); first.end();
    assert.equal(runtime.list()[0].activeCalls, 0);
    assert.equal(runtime.bySession('same')[0].id, 'second');
    assert.equal(runtime.bySession('same')[0].request.body.messages.length, 2);
    const pending = runtime.begin(this.make('same', 'deleted'));
    runtime.clear('same');
    const renewed = runtime.begin(this.make('same', 'renewed'));
    assert.equal(pending.update(this.make('same', 'deleted')), false);
    pending.end();
    assert.equal(runtime.list()[0].activeCalls, 1);
    renewed.end();
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
    assert.equal(runtime.records().length, 0);
  };

  private budget = (): void => {
    assert.equal(RuntimeSessions.budgetBytes, 200_000_000);
    const events: string[] = [];
    const runtime = new RuntimeSessions(1100, (id, reason) => events.push(id + ':' + reason), () => '2026-11-01T00:00:00.000Z');
    const active = runtime.begin(this.make('pinned', 'pinned'));
    runtime.record(this.make('old', 'old'));
    runtime.record(this.make('new', 'new'));
    assert.ok(runtime.stats().bytes <= 1100);
    assert.ok(events.includes('old:budget'));
    assert.equal(active.current(), true);
    assert.equal(runtime.list().some(session => session.id === 'pinned'), true);
    const large = runtime.begin(this.make('oversized', 'oversized', 'x'.repeat(10000)));
    assert.equal(active.current(), true);
    assert.equal(large.current(), true);
    assert.ok(runtime.stats().bytes > 1100);
    assert.equal(runtime.records().length, 2);
    active.end();
    assert.equal(runtime.records().length, 1);
    large.end();
    assert.equal(runtime.records().length, 1);
    assert.equal(runtime.bySession('oversized')[0].request.body.messages[0].content.length, 10000);
    const before = runtime.stats().bytes;
    const grew = runtime.begin(this.make('oversized', 'grew', 'x'.repeat(15000)));
    assert.ok(runtime.stats().bytes > before);
    grew.end();
    const measured = Buffer.byteLength(JSON.stringify({ id: 'oversized', firstSeen: '2026-11-01T00:00:00.000Z', lastSeen: '2026-11-01T00:00:00.000Z', activeCalls: 0, record: runtime.records()[0] }), 'utf8');
    assert.equal(runtime.stats().bytes, measured);
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
    runtime.record(this.make('unicode', 'unicode', 'Юникод😀'));
    assert.ok(runtime.stats().bytes > JSON.stringify(runtime.records()[0]).length);
    assert.throws(() => { runtime.records()[0].request.body.messages.length = 0; }, TypeError);
    const isolated = new RuntimeSessions();
    assert.equal(isolated.records().length, 0);
  };

  private preview = (): void => {
    const runtime = new RuntimeSessions();
    const request = this.make('preview', 'a');
    const call = runtime.begin(request);
    const snapshot = new Date(Date.now() + 1000).toISOString();
    const first = runtime.preview(0, snapshot);
    call.update({ ...request, response: { status: 200, headers: {}, body: 'progress', isStream: true, client: 'synthetic' } });
    assert.equal(runtime.preview(0, snapshot, first.revision).revision, first.revision);
    call.end();
    runtime.record(this.make('preview', 'b'));
    assert.throws(() => runtime.preview(1, snapshot, first.revision), /заново/);
    const next = runtime.preview(0, snapshot);
    assert.equal(next.rows[0].id, 'b');
    assert.equal(next.rows.length, 1);
    runtime.clear();
    assert.throws(() => runtime.preview(0, snapshot, next.revision), /заново/);
  };

  private actualLimit = (): void => {
    const runtime = new RuntimeSessions();
    const record = this.make('large', 'large', '');
    record.request.body = 'x'.repeat(200_000_001);
    const call = runtime.begin(record);
    assert.ok(runtime.stats().bytes > 200_000_000);
    assert.equal(runtime.records()[0].request.body.length, 200_000_001);
    call.end();
    assert.equal(runtime.records().length, 1);
    assert.ok(runtime.stats().bytes > 200_000_000);
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
  };

  public run = (): void => {
    this.concurrency(); this.budget(); this.preview(); this.actualLimit();
    console.log('PASS runtime retention: latest-started, overlapping calls, delete generation, UTF-8 accounting, eviction, active/single oversized, actual 200 MB, preview revision and isolation');
  };
}

new RuntimeRetentionTests().run();
