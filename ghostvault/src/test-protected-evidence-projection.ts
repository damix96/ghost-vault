import assert from 'node:assert/strict';
import { ResponseChangeEvidence } from './telemetry/response-change-evidence.js';
import { SecretRedactor } from './vault/secret-redactor.js';
import { ProtectedResponseProjection } from './telemetry/protected-response-projection.js';
import { RuntimeSessions } from './proxy/runtime-sessions.js';
import { TransactionRecord } from './telemetry/types.js';

export class EvidenceProjectionContractTests {
  private realCacheBudget = (): void => {
    const parent = new SecretRedactor();
    const diagnostics = parent.snapshot(text => text.replaceAll('$${<PUBLIC>}', 'private-expanded-value'), 1024);
    const evidence = new ResponseChangeEvidence([]);
    const projection = new ProtectedResponseProjection(diagnostics, evidence);
    const removed: string[] = [];
    const runtime = new RuntimeSessions(500000, id => { removed.push(id); }, () => '');
    const record: TransactionRecord = { id: 'real-cost', timestamp: '', request: { method: 'POST', url: '/', headers: {}, body: 'ordinary unchanged body', client: 'synthetic' }, interceptedSecrets: [] };
    runtime.begin(record, projection).end();
    const initialBytes = runtime.stats().bytes;
    const initialEstimate = diagnostics.estimatedBytes();
    const sourceRevision = runtime.previewRevision();
    parent.remember([{ value: 'known-private-$${<PUBLIC>}-end', alias: '$${<PRIVATE>}' }]);
    const refreshed = runtime.stats();
    assert.ok(diagnostics.estimatedBytes() > initialEstimate);
    assert.equal(refreshed.bytes - initialBytes, diagnostics.estimatedBytes() - initialEstimate);
    assert.equal(runtime.previewRevision(), sourceRevision);
    const warmedBytes = refreshed.bytes;
    diagnostics.preview('known-private-private-expanded-value-en');
    assert.equal(runtime.stats().bytes, warmedBytes);
    runtime.record({ ...record, id: 'fresh-cost' });
    parent.remember([{ value: 'large-private-cache-'.repeat(2000), alias: '$${<LARGE>}' }]);
    assert.equal(runtime.stats().sessions, 1);
    assert.deepEqual(removed, ['real-cost']);
    assert.equal(runtime.records()[0].id, 'fresh-cost');
    assert.equal(JSON.stringify(runtime.records()).includes('estimatedBytes'), false);
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
  };

  private cacheBudget = (): void => {
    const record: TransactionRecord = { id: 'cost', sessionId: 'cost', timestamp: '', request: { method: 'POST', url: '/', headers: {}, client: 'synthetic' }, interceptedSecrets: [] };
    let estimate = 100;
    const removed: string[] = [];
    const diagnostics = { redact: <T>(value: T): T => value, project: (text: string) => ({ text, ranges: [] }), preview: (text: string) => text, estimatedBytes: () => estimate };
    const evidence = new ResponseChangeEvidence([]);
    const projection = new ProtectedResponseProjection(diagnostics, evidence);
    const runtime = new RuntimeSessions(5000, id => { removed.push(id); }, () => '');
    runtime.begin(record, projection).end();
    const before = runtime.stats();
    const revision = runtime.previewRevision();
    estimate = 300;
    assert.equal(runtime.stats().bytes, before.bytes + 200);
    assert.equal(runtime.previewRevision(), revision);
    estimate = 50;
    assert.equal(runtime.stats().bytes, before.bytes - 50);
    runtime.record({ ...record, id: 'fresh', sessionId: 'fresh' });
    estimate = 6000;
    assert.equal(runtime.stats().sessions, 1);
    assert.deepEqual(removed, ['cost']);
    runtime.clear();
    for (const invalid of [-1, Number.NaN, Number.POSITIVE_INFINITY, 0.5]) {
      estimate = invalid;
      runtime.begin(record, projection).end();
      assert.ok(runtime.stats().bytes > 5000);
      runtime.clear();
    }
    diagnostics.estimatedBytes = () => { throw new Error('synthetic estimate failure'); };
    runtime.begin(record, projection).end();
    assert.ok(runtime.stats().bytes > 5000);
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
  };

  private retained = (): void => {
    const secret = 'private-retained-neighbor-'.repeat(12);
    const alias = '$${<ORDINARY>}';
    const redactor = new SecretRedactor();
    const evidence = new ResponseChangeEvidence([{ from: alias, to: 'visible' }], redactor.project);
    const before = secret + ' gap ' + alias;
    const after = evidence.restore(before);
    evidence.finish('complete');
    const projection = new ProtectedResponseProjection(redactor.snapshot(text => text), evidence);
    const record: TransactionRecord = { id: 'retained', sessionId: 'session', timestamp: '', request: { method: 'POST', url: '/v1/chat/completions', headers: {}, body: 'ordinary', client: 'synthetic' }, response: { status: 200, headers: {}, body: { content: after }, isStream: false, client: 'synthetic' }, interceptedSecrets: [], responseChanges: evidence.snapshot() };
    const runtime = new RuntimeSessions(undefined, undefined, () => '');
    runtime.begin(record, projection).end();
    assert.ok(JSON.stringify(runtime.records()).includes(secret));
    assert.ok(runtime.stats().bytes > evidence.retainedBytes());
    redactor.remember([{ value: secret, alias: '$${<PRIVATE>}' }]);
    const protectedRecord = runtime.records()[0];
    assert.equal(JSON.stringify(protectedRecord).includes(secret.slice(-48)), false);
    assert.equal(protectedRecord.responseChanges!.items[0].after.text, '$${<PRIVATE>} gap visible');
    const old = runtime.begin({ ...record, id: 'old' }, projection);
    const latest = runtime.begin({ ...record, id: 'latest' });
    assert.equal(old.update(record), false);
    old.end(); latest.end();
    const baseline = new RuntimeSessions(undefined, undefined, () => '');
    baseline.record({ ...record, id: 'latest' });
    assert.equal(runtime.stats().bytes, baseline.stats().bytes);
    baseline.clear();
    runtime.clear();
    assert.equal(runtime.stats().bytes, 0);
    runtime.begin(record, { project: () => { throw new Error('synthetic'); }, retainedBytes: () => 0 }).end();
    assert.equal(JSON.stringify(runtime.records()).includes(secret), false);
    assert.equal(runtime.records()[0].request.body, '[protected diagnostic unavailable]');
    runtime.clear();
  };

  private response = (): void => {
    const secret = 'synthetic-protected-response-'.repeat(8);
    const redactor = new SecretRedactor();
    redactor.remember([{ value: secret, alias: '$${<PRIVATE>}' }]);
    const evidence = new ResponseChangeEvidence([], redactor.project);
    const projection = new ProtectedResponseProjection(redactor.snapshot(text => text), evidence);
    const wire = (value: string) => value.match(/.{1,17}/g)!.map(text => 'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n').join('');
    const record = (value: string): TransactionRecord => ({ id: 'response', timestamp: '', request: { method: 'POST', url: '/', headers: {}, client: 'synthetic' }, response: { status: 200, headers: {}, body: wire(value), isStream: true, client: 'synthetic' }, interceptedSecrets: [], sampleStreamChunk: wire(value.slice(0, 17)), responseChanges: evidence.snapshot() });
    const ordinary = record('ordinary wire remains unchanged');
    assert.equal(projection.project(ordinary).response!.body, ordinary.response!.body);
    const protectedRecord = projection.project(record(secret));
    assert.equal(protectedRecord.response!.body.raw, ProtectedResponseProjection.omitted);
    assert.equal(protectedRecord.response!.body.content[0].text, '$${<PRIVATE>}');
    assert.equal(protectedRecord.sampleStreamChunk, ProtectedResponseProjection.omitted);
    const partial = projection.project(record(secret.slice(0, -7)));
    assert.equal(partial.response!.body.raw, ProtectedResponseProjection.omitted);
    assert.equal(partial.response!.body.content[0].text, '');
    assert.equal(projection.preview(secret.slice(0, -7)), '');
    const broken = new ProtectedResponseProjection({ ...redactor.snapshot(text => text), redact: () => { throw new Error('synthetic'); }, preview: () => { throw new Error('synthetic'); } }, evidence);
    assert.equal(broken.preview(secret), undefined);
    assert.equal(broken.project(record(secret)).response!.body, ProtectedResponseProjection.unavailable);
  };

  private marker = (): void => {
    const alias = '$${<PUBLIC>}';
    const redactor = new SecretRedactor();
    redactor.remember([{ value: 'abc' + alias + 'def', alias: '$${<LEFT>}' }, { value: 'Xdefghi', alias: '$${<RIGHT>}' }, { value: '[protected]', alias: '$${<PROTECTED_MARKER_COLLISION>}' }]);
    const evidence = new ResponseChangeEvidence([{ from: alias, to: 'X', key: 'PUBLIC' }], redactor.project);
    assert.equal(evidence.restore('abc' + alias + 'defghi ordinary'), 'abcXdefghi ordinary');
    const snapshot = evidence.snapshot();
    assert.equal(snapshot.items.length, 1);
    const projected = redactor.redact(snapshot);
    assert.deepEqual(projected, snapshot);
    const item = projected.items[0];
    assert.equal(item.after.text, '$${<PROTECTED_MARKER_COLLISION>} ordinary');
    assert.equal(item.value, '$${<PROTECTED_MARKER_COLLISION>}');
    assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
    assert.equal(item.after.totalLength, item.after.text.length);
    redactor.remember([{ value: 'tag-$${<PROTECTED_MARKER_COLLISION>}', alias: '$${<FINAL_MARKER>}' }]);
    const chained = new ResponseChangeEvidence([{ from: alias, to: 'X' }], redactor.project);
    assert.equal(chained.restore('tag-abc' + alias + 'defghi ordinary'), 'tag-abcXdefghi ordinary');
    const stable = chained.snapshot();
    assert.deepEqual(redactor.redact(stable), stable);
    assert.equal(stable.items[0].after.text, '$${<FINAL_MARKER>} ordinary');
    assert.equal(stable.items[0].after.text.slice(stable.items[0].after.start, stable.items[0].after.end), stable.items[0].value);
    const unstable = new ResponseChangeEvidence([{ from: alias, to: 'X' }], text => ({ text: text[0] + '!' + text.slice(1), ranges: [{ start: 0, end: 1, replacement: text[0] + '!' }] }));
    assert.equal(unstable.restore(alias), 'X');
    assert.deepEqual(unstable.snapshot().items, []);
  };

  private composition = (): void => {
    const alias = '$${<PUBLIC>}';
    const before = 'a' + alias + 'bcdefghijklmnopqrstuvwxyz';
    const after = 'aXbcdefghijklmnopqrstuvwxyz';
    const render = (text: string, ranges: Array<{ start: number; end: number; replacement: string }>): string => {
      let cursor = 0;
      let output = '';
      for (const range of ranges) { output += text.slice(cursor, range.start) + range.replacement; cursor = range.end; }
      return output + text.slice(cursor);
    };
    const scenarios = [
      { prior: [[0, 6]], direct: [[0, 6]], result: [[0, 6, 'NEW']] },
      { prior: [[0, 8]], direct: [[2, 4]], result: [[0, 8, 'OLD']] },
      { prior: [[2, 4]], direct: [[0, 8]], result: [[0, 8, 'NEW']] },
      { prior: [[0, 6]], direct: [[4, 10]], result: [[0, 10, '[protected]']] },
      { prior: [[0, 6], [9, 14]], direct: [[4, 11]], result: [[0, 14, '[protected]']] },
      { prior: [[0, 4]], direct: [[4, 8]], result: [[0, 4, 'OLD'], [4, 8, 'NEW']] },
      { prior: [[0, 4]], direct: [[8, 12]], result: [[0, 4, 'OLD'], [8, 12, 'NEW']] },
    ];
    const original = (position: number): number => position >= 2 ? position + alias.length - 1 : position;
    for (const scenario of scenarios) {
      const evidence = new ResponseChangeEvidence([{ from: alias, to: 'X', key: 'PUBLIC' }], text => {
        if (text !== before && text !== after) return { text, ranges: [] };
        const ranges = text === before ? scenario.prior.map(([start, end]) => ({ start: original(start), end: original(end), replacement: 'OLD' })) : scenario.direct.map(([start, end]) => ({ start, end, replacement: 'NEW' }));
        return { text: render(text, ranges), ranges };
      });
      assert.equal(evidence.restore(before), after);
      const item = evidence.snapshot().items[0];
      const ranges = scenario.result.map(([start, end, replacement]) => ({ start: Number(start), end: Number(end), replacement: String(replacement) }));
      assert.equal(item.after.text, render(after, ranges));
      assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
      assert.equal(item.key, 'PUBLIC');
      assert.equal(item.alias, alias);
    }
    const invalid = new ResponseChangeEvidence([{ from: alias, to: 'X' }]);
    invalid.capture(before, after, [{ start: 1, end: 1 + alias.length, outputStart: 2, alias, value: 'X' }], 'response-field');
    assert.deepEqual(invalid.snapshot().items, []);
    const invalidProjection = new ResponseChangeEvidence([{ from: alias, to: 'X' }], text => ({ text, ranges: [{ start: 0, end: 2, replacement: 'invalid' }] }));
    assert.equal(invalidProjection.restore(before), after);
    assert.deepEqual(invalidProjection.snapshot().items, []);
  };

  public run = (): void => {
    this.realCacheBudget();
    this.cacheBudget();
    this.retained();
    this.response();
    this.composition();
    this.marker();
    const secret = 'synthetic-private-neighbor'.repeat(12);
    const safe = '$${<PRIVATE>}';
    const alias = '$${<ORDINARY>}';
    let fail = false;
    let calls = 0;
    const project = (text: string) => {
      calls++;
      if (fail) throw new Error('synthetic projector failure');
      const ranges = [];
      let output = '';
      let cursor = 0;
      for (let start = text.indexOf(secret); start >= 0; start = text.indexOf(secret, cursor)) {
        const end = start + secret.length;
        ranges.push({ start, end, replacement: safe });
        output += text.slice(cursor, start) + safe;
        cursor = end;
      }
      return { text: output + text.slice(cursor), ranges };
    };
    const input = secret + '-' + alias + '-' + secret;
    const evidence = new ResponseChangeEvidence([{ from: alias, to: 'ordinary', key: 'ORDINARY' }], project);
    assert.equal(evidence.restore(input), secret + '-ordinary-' + secret);
    const item = evidence.snapshot().items[0];
    assert.equal(item.before.text, safe + '-' + alias + '-' + safe);
    assert.equal(item.after.text, safe + '-ordinary-' + safe);
    assert.equal(item.before.start, safe.length + 1);
    assert.equal(item.after.start, safe.length + 1);
    assert.equal(item.after.text.slice(item.after.start, item.after.end), item.value);
    assert.equal(item.value, 'ordinary');
    const target = new ResponseChangeEvidence([{ from: alias, to: secret, key: 'ORDINARY' }], project);
    assert.equal(target.restore(alias), secret);
    assert.equal(target.snapshot().items[0].value, safe);
    const overlap = new ResponseChangeEvidence([{ from: alias, to: 'inside', key: 'ORDINARY' }], text => text === 'before-inside-after' ? { text: safe, ranges: [{ start: 0, end: text.length, replacement: safe }] } : { text, ranges: [] });
    assert.equal(overlap.restore('before-' + alias + '-after'), 'before-inside-after');
    assert.deepEqual(overlap.snapshot().items[0].after, { text: safe, start: 0, end: safe.length, contextStart: 0, totalLength: safe.length });
    assert.equal(overlap.snapshot().items[0].value, safe);
    fail = true;
    const broken = new ResponseChangeEvidence([{ from: alias, to: secret }], project);
    assert.equal(broken.restore(alias), secret);
    assert.deepEqual(broken.snapshot().items, []);
    const count = calls;
    assert.equal(broken.restore('ordinary no replacement'), 'ordinary no replacement');
    assert.equal(calls, count);
    console.log('PASS evidence projection port: original offsets, safe target boundaries, payload exact, capture failure isolated');
  };
}
