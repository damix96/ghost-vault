import assert from 'node:assert/strict';
import { SecretProvider } from './security/secret-provider.js';
import { ProtectedDiagnostics, ProtectedTextProjection, SecretRedactor } from './vault/secret-redactor.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

class SnapshotFixtureProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  calls = 0;
  encrypt = (value: Buffer): Buffer => { this.calls++; return Buffer.from(value); };
  decrypt = (value: Buffer): Buffer => { this.calls++; return Buffer.from(value); };
}

class ProtectedSnapshotDiagnosticsTests {
  private consistent = (input: string, projection: ProtectedTextProjection): void => {
    let cursor = 0;
    let output = '';
    for (const { start, end, replacement } of projection.ranges) {
      assert.ok(Number.isInteger(start) && Number.isInteger(end));
      assert.ok(start >= cursor && end > start && end <= input.length);
      output += input.slice(cursor, start) + replacement;
      cursor = end;
    }
    assert.equal(output + input.slice(cursor), projection.text);
  };

  private forms = (diagnostics: ProtectedDiagnostics, original: string, alias: string): void => {
    for (const form of new Set(Object.values(VaultStore.computeVariants(original)))) {
      const input = 'lead🧪\0|' + form + '|tail';
      const projected = diagnostics.project(input);
      this.consistent(input, projected);
      assert.equal(projected.text, diagnostics.redact(input));
      assert.equal(projected.ranges.length, 1);
      assert.equal(projected.ranges[0].start, 'lead🧪\0|'.length);
      assert.equal(projected.ranges[0].end, 'lead🧪\0|'.length + form.length);
      assert.match(projected.ranges[0].replacement, /^\$\$\{<[A-Z0-9_]+>\}$/);
      assert.ok(!projected.text.includes(form));
      for (let cut = 1; cut < form.length; cut++) assert.equal(diagnostics.preview('|' + form.slice(0, cut)), '|');
    }
    assert.equal(diagnostics.project(original).text, alias);
    const object = { response: { body: { text: original, encoded: JSON.stringify({ content: original }) } }, key: 'PRIVATE' };
    const before = JSON.stringify(object);
    const safe = diagnostics.redact(object);
    assert.equal(JSON.stringify(object), before);
    assert.equal(safe.response.body.text, alias);
    assert.ok(!safe.response.body.encoded.includes(original));
    assert.notEqual(safe, object);
  };

  private lifetime = (): void => {
    const provider = new SnapshotFixtureProvider();
    const db = new VaultDatabase(':memory:', provider);
    try {
      const publicAlias = '$${<PUBLIC>}';
      const archived = 'archive-private<' + publicAlias + '>tail/\0雪🧪';
      const current = 'current-private<' + publicAlias + '>tail/\0雪🧪';
      const updated = 'updated-private<' + publicAlias + '>tail/\0雪🧪';
      const row = { key: 'PRIVATE', alias: '$${<PRIVATE>}', real_value: archived, mask_in_ai: 1, description: '', created_at: '2026-01-01', updated_at: '2026-01-01' };
      db.upsertSecret(row);
      db.archiveSecret(row.key);
      db.upsertSecret({ ...row, real_value: current });
      const vault = new VaultStore(db);
      const ordinary = vault.setManualSecret('PUBLIC', 'ordinary/"\\\0\r\n雪🧪$${<SECOND>}');
      vault.setManualSecret('SECOND', 'second-must-not-expand');
      const old = vault.snapshot();
      const beforeMarkBytes = old.diagnostics.estimatedBytes();
      assert.ok(Number.isSafeInteger(beforeMarkBytes) && beforeMarkBytes > 2 * ordinary.realValue.length);
      const derived = old.unmaskInboundText(current);
      assert.notEqual(derived, current);
      assert.ok(derived.includes('$${<SECOND>}'));
      assert.equal(old.diagnostics.redact(derived), derived);
      assert.equal(old.diagnostics.preview(derived.slice(0, -1)), derived.slice(0, -1));
      vault.protectManualSecret('PRIVATE');
      const state = () => JSON.stringify([db.getSecrets(), db.getVersions(), db.getAllSettings()]);
      const before = state();
      const calls = provider.calls;
      const protectedBytes = old.diagnostics.estimatedBytes();
      assert.ok(protectedBytes > beforeMarkBytes);
      this.forms(old.diagnostics, current, row.alias);
      this.forms(old.diagnostics, derived, row.alias);
      this.forms(old.diagnostics, old.unmaskInboundText(archived), row.alias);
      assert.equal(old.unmaskInboundText(row.alias), current);
      assert.equal(vault.redactProtected(derived), derived);
      assert.equal(old.diagnostics.redact(ordinary.realValue), ordinary.realValue);
      assert.equal(old.diagnostics.redact(publicAlias), publicAlias);
      assert.equal(old.diagnostics.preview(publicAlias), publicAlias);
      assert.equal(old.diagnostics.redact(derived.replace('$${<SECOND>}', 'second-must-not-expand')), derived.replace('$${<SECOND>}', 'second-must-not-expand'));
      assert.equal(provider.calls, calls);
      assert.equal(state(), before);
      assert.equal(old.diagnostics.estimatedBytes(), protectedBytes);
      vault.setManualSecret('PUBLIC', 'new-ordinary/"\\\0\r\nother雪');
      assert.equal(old.diagnostics.estimatedBytes(), protectedBytes);
      const fresh = vault.snapshot();
      const newDerived = fresh.unmaskInboundText(current);
      assert.notEqual(derived, newDerived);
      assert.equal(old.unmaskInboundText(current), derived);
      assert.equal(old.diagnostics.redact(newDerived), newDerived);
      assert.equal(fresh.diagnostics.redact(derived), derived);
      this.forms(fresh.diagnostics, newDerived, row.alias);
      vault.setManualSecret('PRIVATE', updated);
      const updatedBytes = old.diagnostics.estimatedBytes();
      assert.ok(updatedBytes >= protectedBytes);
      this.forms(old.diagnostics, old.unmaskInboundText(updated), row.alias);
      this.forms(old.diagnostics, derived, row.alias);
      const renamed = vault.renameManualSecret('PRIVATE', 'RENAMED')!;
      const renamedBytes = old.diagnostics.estimatedBytes();
      assert.ok(renamedBytes >= updatedBytes);
      this.forms(old.diagnostics, old.unmaskInboundText(updated), renamed.alias);
      assert.equal(old.unmaskInboundText(row.alias), current);
      assert.equal(fresh.unmaskInboundText(row.alias), current);
      vault.deleteSecret('RENAMED');
      assert.equal(old.diagnostics.estimatedBytes(), renamedBytes);
      this.forms(old.diagnostics, old.unmaskInboundText(updated), renamed.alias);
      this.forms(old.diagnostics, derived, row.alias);
      assert.equal(vault.redactProtected(derived), derived);
      const stable = old.diagnostics.project(derived);
      stable.ranges[0].replacement = 'caller-mutation';
      assert.equal(old.diagnostics.project(derived).text, row.alias);
    } finally { db.close(); }
  };

  private precedenceAndFailure = (): void => {
    const source = new SecretRedactor();
    const publicAlias = '$${<PUBLIC>}';
    let restores = 0;
    const diagnostics = source.snapshot(value => { restores++; return value.replace(publicAlias, 'ordinary'); });
    source.remember([{ value: publicAlias, alias: '$${<TOKEN_VALUE>}' }, { value: 'PUBLIC', alias: '$${<TOKEN_FRAGMENT>}' }]);
    assert.equal(diagnostics.redact('ordinary'), 'ordinary');
    assert.equal(diagnostics.redact(publicAlias), publicAlias);
    source.remember([{ value: 'left' + publicAlias + 'right', alias: '$${<DERIVED>}' }, { value: 'leftordinaryright', alias: '$${<EXACT>}' }]);
    assert.equal(diagnostics.redact('leftordinaryright'), '$${<EXACT>}');
    const count = restores;
    diagnostics.project('leftordinaryright');
    diagnostics.preview('leftordinaryrigh');
    source.remember([]);
    source.remember([{ value: 'leftordinaryright', alias: '$${<EXACT>}' }]);
    diagnostics.redact('leftordinaryright');
    assert.equal(restores, count);
    source.remember([{ value: 'leftordinaryright', alias: '$${<RENAMED>}' }]);
    assert.equal(diagnostics.redact('leftordinaryright'), '$${<RENAMED>}');
    assert.ok(restores > count);
    const failure = new Error('synthetic derivation failed');
    const broken = source.snapshot(() => { throw failure; });
    assert.throws(() => broken.redact('ordinary'), error => error === failure);
    assert.throws(() => broken.project('ordinary'), error => error === failure);
    assert.throws(() => broken.preview('ordinary'), error => error === failure);
    assert.throws(() => broken.estimatedBytes(), error => error === failure);
  };

  private retentionCost = (): void => {
    const source = new SecretRedactor();
    let calls = 0;
    const publicAlias = '$${<PUBLIC>}';
    const replacement = 'derived/"\\\0雪🧪'.repeat(32);
    const restore = (value: string): string => { calls++; return value.replace(publicAlias, replacement); };
    const diagnostics = source.snapshot(restore, 4096);
    const emptyBytes = diagnostics.estimatedBytes();
    assert.ok(Number.isSafeInteger(emptyBytes) && emptyBytes >= 4096);
    assert.equal(calls, 0);
    const value = 'private<' + publicAlias + '>suffix';
    const alias = '$${<' + 'LONG_ALIAS_'.repeat(10) + '>}';
    source.remember([{ value, alias }]);
    const retainedBytes = diagnostics.estimatedBytes();
    assert.ok(Number.isSafeInteger(retainedBytes) && retainedBytes > emptyBytes + 2 * replacement.length);
    const restores = calls;
    diagnostics.project(value);
    diagnostics.redact({ body: value });
    diagnostics.preview('private<' + replacement.slice(0, -1));
    assert.equal(diagnostics.estimatedBytes(), retainedBytes);
    assert.equal(calls, restores);
    source.remember([{ value, alias }, { value, alias: '$${<DUPLICATE>}' }]);
    assert.equal(diagnostics.estimatedBytes(), retainedBytes);
    assert.equal(calls, restores);
    source.remember([{ value, alias: '$${<S>}' }]);
    assert.equal(diagnostics.estimatedBytes(), retainedBytes);
    assert.ok(calls > restores);
    assert.ok(source.snapshot(restore, 4096).estimatedBytes() < retainedBytes);
    source.remember([{ value: 'additional-long-protected-value'.repeat(128), alias: '$${<ADDITIONAL>}' }]);
    assert.ok(diagnostics.estimatedBytes() > retainedBytes);
    assert.equal(typeof diagnostics.estimatedBytes(), 'number');
    assert.equal(source.snapshot(restore, Number.MAX_SAFE_INTEGER).estimatedBytes(), Number.MAX_SAFE_INTEGER);
    for (const invalid of [-1, 0.5, NaN, Infinity]) assert.throws(() => source.snapshot(restore, invalid), RangeError);
  };

  public run = (): void => {
    this.lifetime();
    this.precedenceAndFailure();
    this.retentionCost();
    console.log('Protected snapshot diagnostics exact one-pass/encodings/UTF16/current-archive-retired/late-mark/overlap/refresh/purity/fail-closed/retention-estimate-cache-high-water PASS; injected provider');
  };
}

new ProtectedSnapshotDiagnosticsTests().run();
