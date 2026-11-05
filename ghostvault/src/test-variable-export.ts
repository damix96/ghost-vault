import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import Fastify, { FastifyInstance } from 'fastify';
import { VaultDatabase, SecretRow } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { SecretEntry } from './types/index.js';
import { WorkspaceApi } from './proxy/workspace-api.js';
import { VariableApi } from './proxy/variable-api.js';
import { AdminAccess } from './proxy/admin-access.js';
import { HookManager } from './hooks/manager.js';

class VariableExportTests {
  private directory = mkdtempSync(join(tmpdir(), 'ghostvault-variable-export-'));
  private databases = new Set<VaultDatabase>();
  private open = (name: string): VaultDatabase => {
    const db = new VaultDatabase(join(this.directory, name));
    this.databases.add(db);
    return db;
  };
  private entry = (key: string, value: string, alias = '$${<' + key + '>}'): SecretEntry => ({ key, realValue: value, alias, description: 'Historical endpoint', maskInAi: true, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-02T00:00:00Z', variants: VaultStore.computeVariants(value) });
  private row = (entry: SecretEntry): SecretRow => ({ key: entry.key, real_value: entry.realValue, alias: entry.alias, description: entry.description || '', mask_in_ai: Number(entry.maskInAi), created_at: entry.createdAt, updated_at: entry.updatedAt });
  private exportedRow = ({ is_secret, protected_value, write_revision, ...row }: SecretRow) => row;
  private legacySet = (db: VaultDatabase, entry: SecretEntry, archive = false) => db.aliases.allocate(entry, true, () => { if (archive) db.archiveSecret(entry.key); db.upsertSecret(this.row(entry)); });

  private scopes = async (app: FastifyInstance, orphans: unknown[], activeId?: string): Promise<void> => {
    for (const query of ['', '?group=all', '?group=secrets', '?groups=secrets', '?groups=settings,secrets']) {
      const response = await app.inject({ url: '/api/export' + query });
      assert.equal(response.statusCode, 200);
      const exported = response.json();
      assert.equal(exported.format, 'ghostvault-settings');
      assert.equal(exported.version, 1);
      assert.deepEqual(exported.data.orphanedSecretVersions, orphans);
      if (query.includes('groups=')) assert.deepEqual(exported.included, query.slice('?groups='.length).split(','));
    }
    for (const query of ['?group=patterns', '?group=settings', '?groups=settings,patterns']) {
      const response = await app.inject({ url: '/api/export' + query });
      assert.equal(response.statusCode, 200);
      assert.ok(!Object.hasOwn(response.json().data, 'orphanedSecretVersions'));
    }
    if (activeId) {
      const response = await app.inject({ url: '/api/export?group=secrets&id=' + activeId });
      assert.equal(response.statusCode, 200);
      assert.ok(!Object.hasOwn(response.json().data, 'orphanedSecretVersions'));
    }
    assert.equal((await app.inject({ url: '/api/export?group=secrets&id=MISSING' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/export?group=orphanedSecretVersions' })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/export?groups=orphanedSecretVersions' })).statusCode, 400);
  };

  private recorded = async (): Promise<void> => {
    const db = this.open('recorded.db');
    this.legacySet(db, this.entry('ARCHIVE__GV_URL', 'synthetic-occupied'));
    const old = this.entry('ARCHIVE', 'synthetic:/old\\"');
    const forms = this.legacySet(db, old);
    const latest = this.entry('ARCHIVE', 'synthetic:/new-value', '$${<ARCHIVE_V_111111111111>}');
    this.legacySet(db, latest, true);
    const archive = db.getVersions();
    const vault = new VaultStore(db);
    const app = Fastify();
    new AdminAccess('127.0.0.1').install(app);
    new WorkspaceApi(app, db, new HookManager(), {}, vault).register();
    new VariableApi(app, vault).register();
    const raw = new DatabaseSync(join(this.directory, 'recorded.db'));
    const state = () => JSON.stringify(['secrets', 'secret_versions', 'alias_registry', 'manual_alias_forms', 'manual_alias_names', 'reconstructed_alias_owners', 'archived_alias_snapshots', 'archived_alias_forms'].map(table => raw.prepare('SELECT * FROM ' + table).all()));
    try {
      const before = state();
      const inbound = vault.getInboundReplacements();
      const reserve = db.aliases.reserve;
      const allocate = db.aliases.allocate;
      db.aliases.reserve = () => { throw new Error('Export must not reserve'); };
      db.aliases.allocate = () => { throw new Error('Export must not allocate'); };
      let exported;
      try { exported = await app.inject({ url: '/api/export?group=secrets&id=ARCHIVE' }); }
      finally { db.aliases.reserve = reserve; db.aliases.allocate = allocate; }
      assert.equal(exported.statusCode, 200);
      const entry = exported.json().data.secrets[0];
      assert.equal(entry.real_value, latest.realValue);
      assert.equal(entry.representations[0].value, latest.realValue);
      assert.equal(entry.representations[0].alias, old.alias);
      assert.equal(entry.versions[0].real_value, old.realValue);
      assert.equal(entry.versions[0].created_at, old.createdAt);
      assert.equal(entry.versions[0].updated_at, old.updatedAt);
      assert.deepEqual(entry.versions[0].representations, forms);
      assert.equal(entry.versions[0].representationMetadata, 'recorded');
      const encoded = forms.find(form => form.value === encodeURIComponent(old.realValue))!;
      assert.equal(encoded.alias, '$${<ARCHIVE__GV_URL_1>}');
      assert.equal(vault.unmaskInboundText(encoded.alias), encodeURIComponent(latest.realValue));
      assert.equal(vault.unmaskInboundText(latest.alias), latest.alias);
      assert.deepEqual(vault.getInboundReplacements(), inbound);
      await this.scopes(app, [], 'ARCHIVE');
      assert.equal(state(), before);
      assert.equal((await app.inject({ url: '/api/export', headers: { origin: 'https://foreign.invalid' } })).statusCode, 403);
      vault.setManualSecret('ARCHIVE', 'synthetic:/edited');
      assert.deepEqual(db.getVersions(), archive);
      const renameState = state();
      const renameVersions = db.renameVersions;
      db.renameVersions = (key, name) => { renameVersions(key, name); throw new Error('synthetic rename archive failure'); };
      const failed = await app.inject({ method: 'PATCH', url: '/api/vault/secret/ARCHIVE', payload: { name: 'RENAMED_ARCHIVE' } });
      db.renameVersions = renameVersions;
      assert.equal(failed.statusCode, 500);
      assert.equal(state(), renameState);
      assert.equal(vault.unmaskInboundText(old.alias), 'synthetic:/edited');
      assert.equal(vault.unmaskInboundText('$${<RENAMED_ARCHIVE>}'), '$${<RENAMED_ARCHIVE>}');
      const renamed = await app.inject({ method: 'PATCH', url: '/api/vault/secret/ARCHIVE', payload: { name: 'RENAMED_ARCHIVE' } });
      assert.equal(renamed.statusCode, 200);
      assert.deepEqual(db.getVersions().map(row => ({ ...row })), archive.map(row => ({ ...row, key: 'RENAMED_ARCHIVE' })));
      const afterRename = (await app.inject({ url: '/api/export?group=secrets&id=RENAMED_ARCHIVE' })).json().data.secrets[0];
      assert.deepEqual(afterRename.versions[0].representations, forms);
      assert.equal(afterRename.real_value, 'synthetic:/edited');
      vault.setManualSecret('ARCHIVE', 'synthetic:/separate-new-owner');
      assert.equal(vault.unmaskInboundText(old.alias), 'synthetic:/separate-new-owner');
      assert.deepEqual(vault.getArchivedRepresentations(db.getVersions()[0]), forms);
      assert.equal((await app.inject({ method: 'PATCH', url: '/api/vault/secret/RENAMED_ARCHIVE', payload: { name: 'ARCHIVE' } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'DELETE', url: '/api/vault/secret/RENAMED_ARCHIVE' })).statusCode, 200);
      assert.equal(db.getVersions().length, 1);
      assert.deepEqual(vault.getArchivedRepresentations(db.getVersions()[0]), forms);
      const all = (await app.inject({ url: '/api/export' })).json();
      assert.ok(!all.data.secrets.some((secret: { key: string }) => secret.key === 'RENAMED_ARCHIVE'));
      const orphan = { ...this.exportedRow(db.getVersions()[0]), representations: forms, representationMetadata: 'recorded' };
      const orphanState = state();
      const orphanInbound = vault.getInboundReplacements();
      await this.scopes(app, [orphan], 'ARCHIVE');
      assert.equal(state(), orphanState);
      assert.deepEqual(vault.getInboundReplacements(), orphanInbound);
      assert.equal((await app.inject({ url: '/api/export?group=secrets&id=RENAMED_ARCHIVE' })).statusCode, 404);
      assert.equal(vault.unmaskInboundText(old.alias), 'synthetic:/separate-new-owner');
      assert.equal(vault.unmaskInboundText('$${<RENAMED_ARCHIVE>}'), '$${<RENAMED_ARCHIVE>}');
      vault.setManualSecret('RENAMED_ARCHIVE', 'synthetic:/recreated-owner');
      await this.scopes(app, [], 'RENAMED_ARCHIVE');
      const recreated = (await app.inject({ url: '/api/export?group=secrets&id=RENAMED_ARCHIVE' })).json().data.secrets[0];
      assert.deepEqual(recreated.versions, [orphan]);
      assert.equal(vault.getManualSecrets().find(entry => entry.key === 'RENAMED_ARCHIVE')!.retainedVersions, 1);
      vault.deleteSecret('RENAMED_ARCHIVE');
    } finally { raw.close(); await app.close(); db.close(); }
    const reopened = this.open('recorded.db');
    const restarted = new VaultStore(reopened);
    assert.equal(restarted.unmaskInboundText(old.alias), 'synthetic:/separate-new-owner');
    assert.deepEqual(restarted.getArchivedRepresentations(reopened.getVersions()[0]), forms);
    const restartedApp = Fastify();
    new WorkspaceApi(restartedApp, reopened, new HookManager(), {}, restarted).register();
    try { await this.scopes(restartedApp, [{ ...this.exportedRow(reopened.getVersions()[0]), representations: forms, representationMetadata: 'recorded' }], 'ARCHIVE'); }
    finally { await restartedApp.close(); reopened.close(); }
  };

  private unrecorded = async (): Promise<void> => {
    let db = this.open('unrecorded.db');
    const old = this.entry('UNRECORDED', 'synthetic:/historical');
    db.upsertSecret(this.row(old));
    db.archiveSecret(old.key);
    db.upsertSecret(this.row(this.entry(old.key, 'synthetic:/current', '$${<UNRECORDED_V_111111111111>}')));
    const archive = db.getVersions()[0];
    const vault = new VaultStore(db);
    assert.deepEqual(vault.getArchivedRepresentations(archive), [{ value: old.realValue, alias: old.alias }]);
    assert.equal(vault.unmaskInboundText(old.alias), 'synthetic:/current');
    db.close();
    db = this.open('unrecorded.db');
    const restarted = new VaultStore(db);
    const app = Fastify();
    new WorkspaceApi(app, db, new HookManager(), {}, restarted).register();
    try {
      const archived = (await app.inject({ url: '/api/export?group=secrets&id=UNRECORDED' })).json().data.secrets[0].versions[0];
      assert.deepEqual(archived.representations, [{ value: old.realValue, alias: old.alias }]);
      assert.equal(archived.real_value, old.realValue);
      assert.equal(archived.representationMetadata, 'partial');
      assert.equal(restarted.unmaskInboundText(old.alias), 'synthetic:/current');
      restarted.deleteSecret(old.key);
      await this.scopes(app, [archived]);
    } finally { await app.close(); db.close(); }
  };

  private automaticParent = async (): Promise<void> => {
    const db = this.open('automatic-parent.db');
    const old = this.entry('AUTO_PARENT', 'synthetic:/old-auto-parent', '$${<AUTO_PARENT_V_111111111111>}');
    const forms = this.legacySet(db, old);
    db.archiveSecret(old.key); db.deleteSecret(old.key);
    db.upsertAutoSecret({ key: old.key, real_value: 'synthetic:/automatic-current', alias: '$${<AUTO_PARENT>}', first_seen_at: '', last_seen_at: '', hit_count: 1 });
    const vault = new VaultStore(db);
    const app = Fastify();
    new WorkspaceApi(app, db, new HookManager(), {}, vault).register();
    const orphan = { ...this.exportedRow(db.getVersions()[0]), representations: forms, representationMetadata: 'recorded' };
    try {
      assert.deepEqual(vault.listVariables().variables, []);
      await this.scopes(app, [orphan], old.key);
      assert.equal(vault.promote(old.key)!.retainedVersions, 1);
      await this.scopes(app, [], old.key);
      const raw = new DatabaseSync(join(this.directory, 'automatic-parent.db'));
      try { raw.prepare('DELETE FROM archived_alias_forms WHERE form = 1').run(); }
      finally { raw.close(); }
      const incomplete = (await app.inject({ url: '/api/export?group=secrets&id=' + old.key })).json().data.secrets[0].versions[0];
      assert.equal(incomplete.representationMetadata, 'partial');
      assert.equal(incomplete.representations.length, forms.length - 1);
      assert.ok(!incomplete.representations.some((form: { alias: string }) => form.alias === forms[1].alias));
    } finally { await app.close(); db.close(); }
  };

  public run = async (): Promise<void> => {
    try {
      await this.recorded(); await this.unrecorded(); await this.automaticParent();
      console.log('PASS archive export: exact historical forms, current owner independence, scope-safe orphans, conservative provenance, read purity, guards, rollback, rename/delete/reuse/restart');
    } finally {
      for (const db of this.databases) { try { db.close(); } catch {} }
      rmSync(this.directory, { recursive: true, force: true });
    }
  };
}

new VariableExportTests().run().catch(error => { console.error(error); process.exitCode = 1; });
