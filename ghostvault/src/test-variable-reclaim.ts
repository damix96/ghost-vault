import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

class VariableReclaimTests {
  private directory = mkdtempSync(join(tmpdir(), 'ghostvault-variable-reclaim-'));
  private path = join(this.directory, 'vault.db');
  private db = new VaultDatabase(this.path);
  private vault = new VaultStore(this.db);
  private raw = new DatabaseSync(this.path);
  private state = () => JSON.stringify(['secrets', 'secret_versions', 'alias_registry', 'manual_alias_names', 'manual_alias_forms'].map(table => this.raw.prepare('SELECT * FROM ' + table).all()));

  private restart = (): void => {
    this.raw.close(); this.db.close();
    this.db = new VaultDatabase(this.path);
    this.vault = new VaultStore(this.db);
    this.raw = new DatabaseSync(this.path);
  };

  private reuse = (): void => {
    const first = this.vault.setManualSecret('A', 'synthetic:/first');
    const snapshot = this.vault.snapshot();
    const owner = this.db.aliases.owner(first.alias);
    this.vault.renameManualSecret('A', 'B');
    const second = this.vault.setManualSecret('A', 'synthetic:/second');
    assert.notEqual(this.db.aliases.owner(second.alias), owner);
    assert.equal(this.db.aliases.owner('$${<B>}'), owner);
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), second.realValue);
    assert.equal(this.vault.unmaskInboundText('$${<B>}'), first.realValue);
    assert.equal(snapshot.unmaskInboundText('$${<A>}'), first.realValue);
    assert.equal(this.vault.unmaskInboundText('$${<A__GV_URL>}'), encodeURIComponent(second.realValue));
    assert.equal(this.vault.unmaskInboundText('$${<B__GV_URL>}'), encodeURIComponent(first.realValue));
    assert.throws(() => this.vault.renameManualSecret('B', 'A'), /занято/);
    this.restart();
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), second.realValue);
    assert.equal(this.vault.unmaskInboundText('$${<B>}'), first.realValue);
    this.vault.deleteSecret('A');
    this.restart();
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), '$${<A>}');
    this.vault.setManualSecret('A', 'synthetic:/third');
    assert.equal(this.vault.unmaskInboundText('$${<A__GV_URL>}'), encodeURIComponent('synthetic:/third'));
    this.vault.deleteSecret('A');
    const renamed = this.vault.renameManualSecret('B', 'A')!;
    assert.equal(this.db.aliases.owner(renamed.alias), owner);
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), first.realValue);
    assert.equal(this.vault.unmaskInboundText('$${<B>}'), '$${<B>}');
    this.restart();
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), first.realValue);
  };

  private conflicts = (): void => {
    assert.throws(() => this.vault.setManualSecret('B__GV_URL', 'synthetic-encoded-base'));
    assert.throws(() => this.vault.renameManualSecret('A', 'A__GV_URL'));
    const auto = this.vault.setAutoSecret('AUTOMATIC', 'synthetic-auto');
    assert.throws(() => this.vault.setManualSecret(auto.key, 'synthetic-steal'));
    this.vault.deleteSecret(auto.key);
    assert.throws(() => this.vault.setManualSecret(auto.key, 'synthetic-steal-expired'));
    const entry = { key: 'UNCLASSIFIED', alias: '$${<UNCLASSIFIED>}', realValue: 'synthetic-unclassified', maskInAi: true, createdAt: '', updatedAt: '', variants: VaultStore.computeVariants('synthetic-unclassified') };
    this.db.aliases.allocate(entry, true, () => {});
    assert.throws(() => this.vault.setManualSecret(entry.key, 'synthetic-steal-unknown'));
  };

  private rollback = (): void => {
    this.vault.renameManualSecret('A', 'B');
    const state = this.state();
    const inbound = this.vault.getInboundReplacements();
    const persist = this.db.upsertSecret;
    this.db.upsertSecret = row => { persist(row); throw new Error('synthetic reclaim write failure'); };
    try { assert.throws(() => this.vault.setManualSecret('A', 'synthetic-failed-reclaim'), /write failure/); }
    finally { this.db.upsertSecret = persist; }
    assert.equal(this.state(), state);
    assert.deepEqual(this.vault.getInboundReplacements(), inbound);
    this.vault.setManualSecret('A', 'synthetic-successful-reclaim');
    this.vault.deleteSecret('A');
    const beforeRename = this.state();
    const renameVersions = this.db.renameVersions;
    this.db.renameVersions = (key, name) => { renameVersions(key, name); throw new Error('synthetic reclaim rename failure'); };
    try { assert.throws(() => this.vault.renameManualSecret('B', 'A'), /rename failure/); }
    finally { this.db.renameVersions = renameVersions; }
    assert.equal(this.state(), beforeRename);
    assert.equal(this.vault.unmaskInboundText('$${<B>}'), 'synthetic:/first');
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), '$${<A>}');
    this.vault.renameManualSecret('B', 'A');
    assert.equal(this.vault.unmaskInboundText('$${<A>}'), 'synthetic:/first');
  };

  public run = (): void => {
    try {
      this.reuse(); this.conflicts(); this.rollback();
      console.log('PASS manual reclaim: delete/recreate, A to B plus new A, restart, live/form/automatic/unknown conflicts, exact ownership transfer and rollback');
    } finally { this.raw.close(); this.db.close(); rmSync(this.directory, { recursive: true, force: true }); }
  };
}

new VariableReclaimTests().run();
