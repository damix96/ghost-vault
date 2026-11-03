import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase, SecretRow } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { SecretEntry } from './types/index.js';

class VariableMigrationTests {
  private directory = mkdtempSync(join(tmpdir(), 'ghostvault-variable-migration-'));

  private entry = (key: string, realValue: string, alias = '$${<' + key + '>}', description = 'Endpoint'): SecretEntry => ({ key, realValue, alias, maskInAi: true, description, createdAt: '2026-01-01', updatedAt: '2026-01-02', variants: VaultStore.computeVariants(realValue) });
  private row = (entry: SecretEntry): SecretRow => ({ key: entry.key, real_value: entry.realValue, alias: entry.alias, description: entry.description || '', created_at: entry.createdAt, updated_at: entry.updatedAt, mask_in_ai: Number(entry.maskInAi) });
  private legacySet = (db: VaultDatabase, entry: SecretEntry, archive = false) => db.aliases.allocate(entry, true, () => { if (archive) db.archiveSecret(entry.key); db.upsertSecret(this.row(entry)); });

  private versions = (): void => {
    const path = join(this.directory, 'versions.db');
    let db = new VaultDatabase(path);
    const original = this.entry('BASE_URL', 'synthetic:/old\\"');
    const intermediate = this.entry('BASE_URL', 'synthetic-middle', '$${<BASE_URL_V_111111111111>}');
    const latest = this.entry('BASE_URL', 'synthetic:/latest😀', '$${<BASE_URL_V_222222222222>}');
    const originalForms = this.legacySet(db, original);
    this.legacySet(db, intermediate, true);
    this.legacySet(db, latest, true);
    const archive = db.getVersions();
    db.close();
    db = new VaultDatabase(path);
    let vault = new VaultStore(db);
    assert.deepEqual(db.getVersions(), archive);
    assert.equal(db.getSecrets()[0].alias, original.alias);
    assert.equal(db.getSecrets()[0].real_value, latest.realValue);
    assert.equal(vault.getManualSecrets()[0].retainedVersions, 2);
    assert.equal(vault.unmaskInboundText(original.alias), latest.realValue);
    assert.equal(vault.unmaskInboundText(intermediate.alias), intermediate.alias);
    assert.equal(vault.unmaskInboundText(latest.alias), latest.alias);
    assert.deepEqual(vault.getArchivedRepresentations(archive[0]), originalForms);
    for (const form of originalForms) assert.ok(!vault.getInboundReplacements().some(replacement => replacement.from === form.alias && replacement.to === form.value));
    assert.equal(vault.maskOutboundText(original.realValue), original.realValue);
    const revision = vault.listVariables().revision;
    const oldEncoded = originalForms.find(form => form.value === encodeURIComponent(original.realValue))!;
    assert.equal(vault.unmaskInboundText(oldEncoded.alias), encodeURIComponent(latest.realValue));
    vault.setManualSecret('BASE_URL', 'synthetic-current', 'Endpoint');
    assert.equal(vault.listVariables().revision, revision);
    assert.deepEqual(db.getVersions(), archive);
    db.close();
    db = new VaultDatabase(path);
    vault = new VaultStore(db);
    assert.equal(vault.unmaskInboundText(original.alias), 'synthetic-current');
    assert.equal(vault.unmaskInboundText(oldEncoded.alias), 'synthetic-current');
    assert.equal(vault.listVariables().revision, revision);
    assert.deepEqual(vault.getArchivedRepresentations(db.getVersions()[0]), originalForms);
    vault.renameManualSecret('BASE_URL', 'RENAMED');
    assert.ok(db.getVersions().every(row => row.key === 'RENAMED'));
    assert.deepEqual(vault.getArchivedRepresentations(db.getVersions()[0]), originalForms);
    db.close();
    db = new VaultDatabase(path);
    vault = new VaultStore(db);
    assert.equal(vault.unmaskInboundText(original.alias), original.alias);
    assert.equal(vault.unmaskInboundText('$${<RENAMED>}'), 'synthetic-current');
    assert.equal(vault.getManualSecrets()[0].retainedVersions, 2);
    vault.renameManualSecret('RENAMED', 'BASE_URL');
    assert.equal(vault.unmaskInboundText(original.alias), 'synthetic-current');
    assert.equal(vault.unmaskInboundText('$${<RENAMED>}'), '$${<RENAMED>}');
    vault.renameManualSecret('BASE_URL', 'RENAMED');
    vault.deleteSecret('RENAMED');
    assert.equal(db.getVersions().length, 2);
    db.close();
    db = new VaultDatabase(path);
    vault = new VaultStore(db);
    assert.deepEqual(vault.listVariables().variables, []);
    assert.equal(vault.unmaskInboundText(original.alias), original.alias);
    assert.equal(db.getVersions().length, 2);
    assert.equal(vault.setManualSecret('BASE_URL', 'synthetic-reuse').alias, original.alias);
    assert.equal(vault.unmaskInboundText(original.alias), 'synthetic-reuse');
    assert.deepEqual(vault.getArchivedRepresentations(db.getVersions()[0]), originalForms);
    db.close();
  };

  private collision = (): void => {
    const path = join(this.directory, 'collision.db');
    const db = new VaultDatabase(path);
    this.legacySet(db, this.entry('HISTORY', 'synthetic:/history'));
    db.archiveSecret('HISTORY');
    const original = this.entry('COLLISION', 'synthetic-current', '$${<COLLISION_V_111111111111>}');
    this.legacySet(db, original);
    db.upsertAutoSecret({ key: 'FOREIGN', real_value: 'synthetic-auto', alias: '$${<COLLISION>}', first_seen_at: '', last_seen_at: '', hit_count: 1 });
    const rows = db.getSecrets();
    const automatic = db.getAutoSecrets();
    const raw = new DatabaseSync(path);
    const registry = raw.prepare('SELECT * FROM alias_registry ORDER BY alias_hash').all();
    assert.throws(() => new VaultStore(db), /использовалось/);
    assert.deepEqual(db.getSecrets(), rows);
    assert.deepEqual(db.getAutoSecrets(), automatic);
    assert.deepEqual(raw.prepare('SELECT * FROM alias_registry ORDER BY alias_hash').all(), registry);
    assert.deepEqual(raw.prepare('SELECT * FROM archived_alias_snapshots').all(), []);
    assert.deepEqual(raw.prepare('SELECT * FROM archived_alias_forms').all(), []);
    assert.equal(db.manualBindings.has('COLLISION'), false);
    raw.close();
    db.close();
  };

  private interruptedMigration = (): void => {
    const path = join(this.directory, 'rollback.db');
    const db = new VaultDatabase(path);
    for (const key of ['FIRST', 'SECOND']) this.legacySet(db, this.entry(key, 'synthetic-' + key, '$${<' + key + '_V_111111111111>}'));
    const rows = db.getSecrets();
    const persist = db.upsertSecret;
    let writes = 0;
    db.upsertSecret = row => { persist(row); if (++writes === 2) throw new Error('synthetic migration failure'); };
    assert.throws(() => new VaultStore(db), /migration failure/);
    assert.deepEqual(db.getSecrets(), rows);
    for (const key of ['FIRST', 'SECOND']) {
      assert.equal(db.manualBindings.has(key), false);
      assert.equal(db.aliases.owner('$${<' + key + '>}'), undefined);
    }
    db.upsertSecret = persist;
    db.close();
    const reopened = new VaultDatabase(path);
    const vault = new VaultStore(reopened);
    assert.equal(vault.unmaskInboundText('$${<FIRST>}'), 'synthetic-FIRST');
    assert.equal(vault.unmaskInboundText('$${<SECOND>}'), 'synthetic-SECOND');
    reopened.close();
  };

  private reservedNamespaces = (): void => {
    const ephemeral = new VaultDatabase(':memory:');
    try {
      const entry = this.entry('MEMORY_RESERVED', 'synthetic-ephemeral');
      ephemeral.aliases.allocate(entry, false, () => {});
      ephemeral.upsertSecret(this.row(entry));
      assert.throws(() => new VaultStore(ephemeral), /автосекрету/);
      assert.equal(ephemeral.manualBindings.has(entry.key), false);
      assert.equal(ephemeral.getSecrets()[0].real_value, entry.realValue);
    } finally { ephemeral.close(); }
    const encoded = new VaultDatabase(':memory:');
    try {
      this.legacySet(encoded, this.entry('OWNER', 'synthetic:/owner'));
      encoded.upsertSecret(this.row(this.entry('OWNER__GV_URL', 'synthetic-conflict')));
      assert.throws(() => new VaultStore(encoded), /формату/);
      assert.equal(encoded.manualBindings.has('OWNER'), false);
      assert.equal(encoded.getSecrets().length, 2);
    } finally { encoded.close(); }
  };

  private encodedCollision = (): void => {
    const path = join(this.directory, 'encoded.db');
    let db = new VaultDatabase(path);
    this.legacySet(db, this.entry('PREFIX__GV_URL', 'synthetic-occupied'));
    const first = this.entry('PREFIX', 'synthetic:/legacy');
    const forms = this.legacySet(db, first);
    const encoded = forms.find(form => form.value === encodeURIComponent(first.realValue))!;
    assert.equal(encoded.alias, '$${<PREFIX__GV_URL_1>}');
    const vault = new VaultStore(db);
    vault.setManualSecret('PREFIX', 'synthetic:/updated');
    assert.equal(vault.unmaskInboundText(encoded.alias), encodeURIComponent('synthetic:/updated'));
    assert.equal(vault.unmaskInboundText('$${<PREFIX__GV_URL>}'), 'synthetic-occupied');
    const automatic = vault.registerAutoDetectedSecret('synthetic:/promoted', 'promote');
    const alias = automatic.alias;
    vault.promote(automatic.key);
    vault.setManualSecret(automatic.key, 'synthetic:/promoted-new');
    db.close();
    db = new VaultDatabase(path);
    const restarted = new VaultStore(db);
    assert.equal(restarted.unmaskInboundText(encoded.alias), encodeURIComponent('synthetic:/updated'));
    assert.equal(restarted.unmaskInboundText(alias), 'synthetic:/promoted-new');
    assert.ok(restarted.listVariables().variables.some(variable => variable.name === automatic.key));
    restarted.setManualSecret('PARENT__GV_URL', 'synthetic:/nested-name');
    restarted.renameManualSecret('PARENT__GV_URL', 'PARENT');
    assert.equal(restarted.unmaskInboundText('$${<PARENT__GV_URL>}'), '$${<PARENT__GV_URL>}');
    assert.equal(restarted.unmaskInboundText('$${<PARENT__GV_URL_1>}'), encodeURIComponent('synthetic:/nested-name'));
    restarted.renameManualSecret('PARENT', 'PARENT__GV_URL');
    assert.equal(restarted.unmaskInboundText('$${<PARENT>}'), '$${<PARENT>}');
    db.close();
  };

  public run = (): void => {
    try {
      this.versions(); this.collision(); this.interruptedMigration(); this.reservedNamespaces(); this.encodedCollision();
      console.log('PASS variable migration: preserved inert archives, stable restart, atomic collision/failure, encoded reservations and promotion');
    } finally { rmSync(this.directory, { recursive: true, force: true }); }
  };
}

new VariableMigrationTests().run();
