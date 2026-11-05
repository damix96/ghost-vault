import assert from 'node:assert/strict';
import { SecretRedactor, ProtectedTextProjection } from './vault/secret-redactor.js';
import { SecretProvider } from './security/secret-provider.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

class ProjectionFixtureProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  calls = 0;
  encrypt = (value: Buffer): Buffer => { this.calls++; return Buffer.from(value); };
  decrypt = (value: Buffer): Buffer => { this.calls++; return Buffer.from(value); };
}

class ProtectedTextProjectionTests {
  private consistent = (input: string, projection: ProtectedTextProjection): void => {
    assert.deepEqual(Object.keys(projection).sort(), ['ranges', 'text']);
    let cursor = 0;
    let result = '';
    for (const range of projection.ranges) {
      assert.deepEqual(Object.keys(range).sort(), ['end', 'replacement', 'start']);
      assert.ok(Number.isInteger(range.start) && Number.isInteger(range.end));
      assert.ok(range.start >= cursor && range.end > range.start && range.end <= input.length);
      result += input.slice(cursor, range.start) + range.replacement;
      cursor = range.end;
    }
    assert.equal(result + input.slice(cursor), projection.text);
  };

  private offsets = (): void => {
    const redactor = new SecretRedactor();
    const ordinary = 'ordinary \uFEFF🧪\0 content';
    assert.deepEqual(redactor.project(ordinary), { text: ordinary, ranges: [] });
    const value = 'private.[*]/🧪\0end';
    const alias = '$${<UTF16>}';
    redactor.remember([{ value, alias }]);
    const prefix = '\uFEFFlead🧪\0|';
    const input = prefix + value + '|' + value + '|tail';
    const second = prefix.length + value.length + 1;
    const projection = redactor.project(input);
    assert.deepEqual(projection, { text: prefix + alias + '|' + alias + '|tail', ranges: [
      { start: prefix.length, end: prefix.length + value.length, replacement: alias },
      { start: second, end: second + value.length, replacement: alias },
    ] });
    this.consistent(input, projection);
    assert.equal(projection.text, redactor.redact(input));
    projection.ranges[0].replacement = 'caller mutation';
    assert.equal(redactor.project(input).ranges[0].replacement, alias);
    const partial = value.slice(0, -2);
    assert.deepEqual(redactor.project(partial), { text: partial, ranges: [] });
    assert.equal(redactor.redactPreview(partial), '');
  };

  private precedence = (): void => {
    const redactor = new SecretRedactor();
    const composite = 'left$${<PUBLIC>}right';
    redactor.remember([
      { value: 'abc', alias: '$${<SHORT>}' },
      { value: 'abcdef', alias: '$${<LONG>}' },
      { value: composite, alias: '$${<COMPOSITE>}' },
      { value: 'PUBLIC', alias: '$${<PRIVATE_FRAGMENT>}' },
    ]);
    const input = 'abcdef|abc|$${<PUBLIC>}|' + composite;
    const projection = redactor.project(input);
    assert.equal(projection.text, '$${<LONG>}|$${<SHORT>}|$${<PUBLIC>}|$${<COMPOSITE>}');
    assert.equal(projection.ranges.length, 3);
    this.consistent(input, projection);
    assert.equal(projection.text, redactor.redact(input));
    assert.deepEqual(redactor.project('$${<PUBLIC>}'), { text: '$${<PUBLIC>}', ranges: [] });
    redactor.remember([{ value: composite, alias: '$${<RAW>}' }, { value: composite, alias: '$${<DUPLICATE>}' }]);
    assert.equal(redactor.project(composite).ranges[0].replacement, '$${<RAW>}');
  };

  private lifetime = (): void => {
    const provider = new ProjectionFixtureProvider();
    const db = new VaultDatabase(':memory:', provider);
    const archived = 'ARCHIVE/\\\"\0\r\n雪🧪';
    const current = 'CURRENT/$${<PUBLIC>}/\\\"\0\r\n雪🧪';
    const updated = 'UPDATED/\\\"\0\r\n雪🧪';
    try {
      const row = { key: 'PROJECT', alias: '$${<PROJECT>}', real_value: archived, mask_in_ai: 1, description: '', created_at: '2026-01-01', updated_at: '2026-01-01' };
      db.upsertSecret(row);
      db.archiveSecret(row.key);
      db.upsertSecret({ ...row, real_value: current });
      const vault = new VaultStore(db);
      vault.setManualSecret('PUBLIC', 'ordinary-public-control');
      assert.deepEqual(vault.projectProtectedText(current), { text: current, ranges: [] });
      vault.protectManualSecret(row.key);
      this.retained(vault, db, provider, [archived, current]);
      vault.setManualSecret(row.key, updated);
      this.retained(vault, db, provider, [archived, current, updated]);
      assert.equal(vault.unmaskInboundText(row.alias), updated);
      vault.deleteSecret(row.key);
      this.retained(vault, db, provider, [archived, current, updated]);
    } finally { db.close(); }
  };

  private retained = (vault: VaultStore, db: VaultDatabase, provider: ProjectionFixtureProvider, values: string[]): void => {
    const state = () => JSON.stringify([db.getSecrets(), db.getVersions(), db.getAllSettings()]);
    const before = state();
    const calls = provider.calls;
    assert.deepEqual(vault.projectProtectedText('$${<PUBLIC>}'), { text: '$${<PUBLIC>}', ranges: [] });
    for (const value of values) for (const form of new Set(Object.values(VaultStore.computeVariants(value)))) {
      const prefix = 'safe🧪|';
      const input = prefix + form + '|tail';
      const projection = vault.projectProtectedText(input);
      this.consistent(input, projection);
      assert.equal(projection.text, vault.redactProtected(input));
      assert.equal(projection.ranges.length, 1);
      assert.equal(projection.ranges[0].start, prefix.length);
      assert.equal(projection.ranges[0].end, prefix.length + form.length);
      assert.match(projection.ranges[0].replacement, /^\$\$\{<[A-Z0-9_]+>\}$/);
      assert.ok(!JSON.stringify(projection).includes(form));
    }
    assert.equal(provider.calls, calls);
    assert.equal(state(), before);
  };

  public run = (): void => {
    this.offsets();
    this.precedence();
    this.lifetime();
    console.log('Protected full-text projection UTF16 ranges/overlap/composite/encoded/current-archive-retired/read-purity PASS; injected provider');
  };
}

new ProtectedTextProjectionTests().run();
