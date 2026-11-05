import assert from 'node:assert/strict';
import { SecretPreview } from './vault/secret-preview.js';
import { SecretRedactor } from './vault/secret-redactor.js';
import { SecretProvider } from './security/secret-provider.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

class PreviewFixtureProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  encrypt = (value: Buffer): Buffer => Buffer.from(value);
  decrypt = (value: Buffer): Buffer => Buffer.from(value);
}

class ProtectedPreviewTests {
  private prefixOracle = (): void => {
    const forms = ['ababaX', 'abbaY', 'aaaaZ', 'babbQ'];
    const preview = new SecretPreview(forms);
    let inputs = [''];
    for (let depth = 0; depth < 6; depth++) inputs = [...inputs, ...inputs.filter(value => value.length === depth).flatMap(value => ['a', 'b', '|'].map(character => value + character))];
    for (const input of inputs) {
      let hidden = 0;
      for (const form of forms) for (let length = 1; length < form.length; length++) if (input.endsWith(form.slice(0, length))) hidden = Math.max(hidden, length);
      assert.equal(preview.trim(input), input.slice(0, input.length - hidden));
    }
    const tail = 'a'.repeat(65535);
    const long = new SecretPreview([tail + 'Z']);
    assert.equal(long.trim('safe|' + tail), 'safe|');
    assert.equal(long.trim('safe|' + tail + '!'), 'safe|' + tail + '!');
  };

  private projection = (): void => {
    const redactor = new SecretRedactor();
    const secret = 'ababac';
    const token = '$${<PREVIEW>}';
    redactor.remember([{ value: secret, alias: token }]);
    for (let length = 1; length < secret.length; length++) assert.equal(redactor.redactPreview('safe|' + secret.slice(0, length)), 'safe|');
    assert.equal(redactor.redactPreview('safe|' + secret), 'safe|' + token);
    assert.equal(redactor.redactPreview('safe|ababa!'), 'safe|ababa!');
    assert.equal(redactor.redactPreview('ordinary text!'), 'ordinary text!');
    assert.equal(redactor.redactPreview('ababa'), '');
    assert.equal(redactor.redactPreview('unrelated!'), 'unrelated!');
    assert.equal(redactor.redactPreview('ababa'), '');
    assert.equal(redactor.redact('safe|ababa'), 'safe|ababa');
    assert.equal(redactor.redactPreview(token + 'ababa'), token);
    redactor.remember([{ value: '>}tail', alias: '$${<TOKENISH>}' }, { value: 'ab', alias: '$${<SHORT>}' }]);
    assert.equal(redactor.redactPreview(token), token);
    assert.equal(redactor.redactPreview('ab'), '');
    assert.equal(redactor.redactPreview('>}ta'), '');
    const overlap = new SecretRedactor();
    overlap.remember([{ value: 'abc', alias: '$${<SHORT>}' }, { value: 'abcXYZ', alias: '$${<LONG>}' }]);
    assert.equal(overlap.redactPreview('safe|abcX'), 'safe|');
    assert.equal(overlap.redactPreview('safe|abcXYZ'), 'safe|$${<LONG>}');
    assert.equal(overlap.redactPreview('safe|abcQ!'), 'safe|$${<SHORT>}Q!');
    overlap.remember([{ value: 'cRST', alias: '$${<CROSS>}' }]);
    assert.equal(overlap.redactPreview('safe|abcR'), 'safe|$${<SHORT>}');
    assert.equal(overlap.redactPreview('safe|abc'), 'safe|');
    const composite = new SecretRedactor();
    const literal = 'qa-secret-prefix$${<PUBLIC>}qa-secret-suffix';
    composite.remember([{ value: literal, alias: '$${<COMPOSITE>}' }]);
    for (let length = 1; length < literal.length; length++) assert.equal(composite.redactPreview('safe|' + literal.slice(0, length)), 'safe|');
    assert.equal(composite.redactPreview(literal), '$${<COMPOSITE>}');
    assert.equal(composite.redact(literal), '$${<COMPOSITE>}');
    assert.equal(composite.redactPreview('$${<PUBLIC>}'), '$${<PUBLIC>}');
    composite.remember([{ value: literal, alias: '$${<RAW>}' }, { value: literal, alias: '$${<ENCODED_DUPLICATE>}' }]);
    assert.equal(composite.redact(literal), '$${<RAW>}');
  };

  private partials = (vault: VaultStore, values: string[]): void => {
    for (const value of values) for (const form of new Set(Object.values(VaultStore.computeVariants(value)))) {
      for (let length = 1; length < form.length; length++) assert.equal(vault.redactProtectedPreview('safe|' + form.slice(0, length)), 'safe|');
      assert.equal(vault.redactProtectedPreview('safe|' + form), vault.redactProtected('safe|' + form));
    }
  };

  private lifetime = (): void => {
    const archived = 'HX-old/"\\\n\0\u5bc6\u78bc\ud83d\ude00!';
    const current = 'PX-current/"\\\n\0\u5bc6\u78bc\ud83d\ude00!';
    const updated = 'NX-next/"\\\n\0\u5bc6\u78bc\ud83d\ude00!';
    const db = new VaultDatabase(':memory:', new PreviewFixtureProvider());
    try {
      const row = { key: 'PREVIEW', alias: '$${<PREVIEW>}', real_value: archived, mask_in_ai: 1, description: '', created_at: '2026-01-01', updated_at: '2026-01-01' };
      db.upsertSecret(row);
      db.archiveSecret(row.key);
      db.upsertSecret({ ...row, real_value: current });
      const vault = new VaultStore(db);
      assert.equal(vault.redactProtectedPreview('safe|' + current.slice(0, 4)), 'safe|' + current.slice(0, 4));
      vault.protectManualSecret(row.key);
      this.partials(vault, [archived, current]);
      assert.equal(vault.unmaskInboundText(row.alias), current);
      vault.setManualSecret(row.key, updated);
      this.partials(vault, [archived, current, updated]);
      assert.equal(vault.unmaskInboundText(row.alias), updated);
      const original = { text: current.slice(0, 4), full: updated };
      const projected = vault.redactProtected(original);
      assert.equal(projected.text, original.text);
      assert.equal(original.full, updated);
      vault.deleteSecret(row.key);
      this.partials(vault, [archived, current, updated]);
      assert.equal(vault.redactProtectedPreview('ordinary complete text!'), 'ordinary complete text!');
    } finally { db.close(); }
  };

  public run = (): void => {
    this.prefixOracle();
    this.projection();
    this.lifetime();
    console.log('Protected preview prefix oracle/64KiB repeated-prefix/raw+encoded all splits/mark-update-delete lifetime/token preservation/stateless divergence PASS; in-memory injected provider');
  };
}

new ProtectedPreviewTests().run();
