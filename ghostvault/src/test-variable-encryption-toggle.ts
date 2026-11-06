import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { WindowsDpapi } from './security/windows-dpapi.js';
import { SecretProvider, SecretStorageError } from './security/secret-provider.js';
import { FastifyInstance } from 'fastify';

class ToggleProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  decrypts = 0;
  encrypts = 0;
  failDecrypt = Infinity;
  failEncrypt = Infinity;
  private native = new WindowsDpapi();
  encrypt = (value: Buffer, context: Buffer): Buffer => {
    if (++this.encrypts === this.failEncrypt) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
    return this.native.encrypt(value, context);
  };
  decrypt = (value: Buffer, context: Buffer): Buffer => {
    if (++this.decrypts === this.failDecrypt) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
    return this.native.decrypt(value, context);
  };
}

class VariableEncryptionToggleTests {
  private directory = path.resolve('.cache/encryption-toggle-dist', randomUUID());
  private file = path.join(this.directory, 'vault.db');
  private provider = new ToggleProvider();
  private old = 'old-toggle-' + randomUUID() + '\0suffix/雪🧪\r\nline';
  private value = 'active-toggle-' + randomUUID() + '\0suffix/雪🧪\r\nline';
  private replacement = 'replacement-toggle-' + randomUUID() + '\0suffix/雪🧪\r\nline';

  private state = (sql: DatabaseSync): string => JSON.stringify(sql.prepare("SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name").all().map(table => {
    const name = String(table.name).replace(/"/g, '""');
    const columns = sql.prepare('PRAGMA table_info("' + name + '")').all().map(column => 'CAST("' + String(column.name).replace(/"/g, '""') + '" AS BLOB)');
    return [name, sql.prepare('SELECT ' + columns.join(', ') + ' FROM "' + name + '" ORDER BY rowid').all()];
  }));

  private exact = (vault: VaultStore, expected: string): void => {
    const entry = vault.getManualSecrets().find(item => item.key === 'TOGGLE')!;
    assert.equal(entry.realValue, expected);
    assert.equal(entry.alias, '$${<TOGGLE>}');
    assert.equal(entry.maskInAi, false);
    for (const form of vault.getSecretRepresentations(entry)) assert.equal(vault.unmaskInboundText(form.alias), form.value);
    assert.deepEqual(entry.variants, VaultStore.computeVariants(expected));
  };

  private rollback = (vault: VaultStore, sql: DatabaseSync): void => {
    const before = this.state(sql);
    const cached = JSON.stringify(vault.getManualSecrets());
    const history = vault.redactProtected(this.old);
    this.provider.failDecrypt = this.provider.decrypts + 3;
    assert.throws(() => vault.setManualProtection('TOGGLE', { isSecret: false, realValue: this.replacement }), error => error instanceof SecretStorageError && error.code === 'SECRET_STORAGE_UNAVAILABLE');
    this.provider.failDecrypt = Infinity;
    assert.equal(this.state(sql), before);
    assert.equal(JSON.stringify(vault.getManualSecrets()), cached);
    assert.equal(vault.redactProtected(this.old), history);
    sql.exec("CREATE TRIGGER toggle_test_failure BEFORE UPDATE ON secret_versions WHEN NEW.is_secret = 0 BEGIN SELECT RAISE(ABORT, 'synthetic toggle rollback'); END;");
    assert.throws(() => vault.setManualProtection('TOGGLE', { isSecret: false, description: 'not committed' }), /synthetic toggle rollback/);
    sql.exec('DROP TRIGGER toggle_test_failure');
    assert.equal(this.state(sql), before);
    assert.equal(JSON.stringify(vault.getManualSecrets()), cached);
    const encrypted = sql.prepare('SELECT protected_value FROM secret_versions LIMIT 1').get()!.protected_value;
    sql.prepare('UPDATE secret_versions SET protected_value = ? WHERE rowid = (SELECT min(rowid) FROM secret_versions)').run('{}');
    const corrupt = this.state(sql);
    assert.throws(() => vault.setManualProtection('TOGGLE', { isSecret: false }), error => error instanceof SecretStorageError && error.code === 'SECRET_DECRYPTION_FAILED');
    assert.equal(this.state(sql), corrupt);
    sql.prepare('UPDATE secret_versions SET protected_value = ? WHERE rowid = (SELECT min(rowid) FROM secret_versions)').run(encrypted);
  };

  private surfaces = async (app: FastifyInstance, server: GhostProxyServer, vault: VaultStore, db: VaultDatabase): Promise<void> => {
    const protectedValue = 'unrelated-retained';
    db.setSetting('toggle_canary', protectedValue);
    const call = server.getRuntimeSessions().begin({ id: 'toggle-history', sessionId: 'toggle-history', timestamp: new Date().toISOString(), request: { method: 'POST', url: '/synthetic', client: 'fixture', headers: {}, body: { content: protectedValue + this.replacement } }, response: { status: 200, client: 'fixture', isStream: false, headers: {}, body: { content: protectedValue + this.replacement } }, interceptedSecrets: [{ key: 'UNRELATED', alias: '$${<UNRELATED>}', realValue: protectedValue, count: 1, direction: 'inbound' }] });
    call.end();
    for (const url of ['/api/vault', '/api/hooks/context', '/api/sessions/toggle-history', '/api/sessions/toggle-history/full']) {
      const response = await app.inject({ url });
      assert.equal(response.statusCode, 200);
      assert.ok(!response.body.includes(protectedValue));
      if (url === '/api/vault') { assert.equal(response.json().manual.find((row: { key: string }) => row.key === 'TOGGLE').realValue, this.replacement); assert.equal(response.json().lastCall.rawUrl, '$${<UNRELATED>}'); }
      else assert.ok(!response.body.includes(this.replacement));
    }
    const forms = vault.getSecretRepresentations(vault.getManualSecrets().find(entry => entry.key === 'TOGGLE')!);
    for (const url of ['/api/export', '/api/export?group=secrets', '/api/export?groups=settings,secrets', '/api/export?group=secrets&id=TOGGLE']) {
      const response = await app.inject({ url });
      assert.equal(response.statusCode, 200);
      assert.ok(!response.body.includes(protectedValue));
      const data = response.json().data;
      const ordinary = data.secrets.find((row: { key: string }) => row.key === 'TOGGLE');
      assert.equal(ordinary.real_value, this.replacement);
      assert.deepEqual(ordinary.representations, forms);
      assert.equal(ordinary.versions.length, 2);
      for (const version of ordinary.versions) { assert.equal(version.real_value, this.old); assert.ok(version.representations.some((form: { value: string }) => form.value === this.old)); }
      const protectedRow = data.secrets.find((row: { key: string }) => row.key === 'UNRELATED');
      if (protectedRow) { assert.equal(protectedRow.valueOmitted, true); assert.equal(Object.hasOwn(protectedRow, 'real_value'), false); }
      if (data.settings) assert.equal(data.settings.toggle_canary, '$${<UNRELATED>}');
    }
    assert.equal((await app.inject({ url: '/api/export?group=settings' })).json().data.settings.find((row: { key: string }) => row.key === 'toggle_canary').value, '$${<UNRELATED>}');
    assert.equal((await app.inject({ url: '/api/export?group=secrets&id=ABSENT' })).statusCode, 404);
    assert.equal((await app.inject({ url: '/api/export?groups=unknown' })).statusCode, 400);
    assert.equal((await app.inject({ method: 'POST', url: '/api/interface/vault', payload: {} })).statusCode, 403);
  };

  private api = async (vault: VaultStore, db: VaultDatabase, sql: DatabaseSync): Promise<void> => {
    const server = new GhostProxyServer(vault, { port: 0 });
    const app = server.getApp();
    try {
      const patch = (key: string, payload: object) => app.inject({ method: 'PATCH', url: '/api/vault/secret/' + key, payload });
      const post = (payload: object) => app.inject({ method: 'POST', url: '/api/vault/secret', payload });
      const before = this.state(sql);
      const invalid = [{ isSecret: false, realValue: '' }, { isSecret: false, realValue: '\ud800' }, { isSecret: false, realValue: null }, { isSecret: 'false' }, { isSecret: false, description: 1 }, { isSecret: false, name: 'OTHER' }];
      for (const payload of invalid) { const response = await patch('TOGGLE', payload); assert.equal(response.statusCode, 400); assert.equal(response.json().code, 'INVALID_SECRET_INPUT'); }
      assert.equal(this.state(sql), before);
      this.provider.failEncrypt = this.provider.encrypts + 1;
      const unavailable = await patch('TOGGLE', { isSecret: true, realValue: this.replacement });
      this.provider.failEncrypt = Infinity;
      assert.equal(unavailable.statusCode, 503);
      assert.equal(unavailable.json().code, 'SECRET_STORAGE_UNAVAILABLE');
      assert.equal(this.state(sql), before);
      assert.equal((await patch('MISSING', { isSecret: false })).json().code, 'VARIABLE_NOT_FOUND');
      vault.setAutoSecret('AUTOMATIC', 'automatic-ordinary-control');
      assert.equal((await patch('AUTOMATIC', { isSecret: false })).statusCode, 404);
      const snapshot = vault.snapshot();
      const archived = db.getVersions().map(row => ({ ...row }));
      const mixed = await patch('TOGGLE', { isSecret: false, realValue: this.replacement, description: '' });
      assert.equal(mixed.statusCode, 200);
      assert.equal(mixed.json().secret.isSecret, false);
      assert.equal(mixed.json().secret.realValue, this.replacement);
      assert.equal(mixed.json().secret.description, '');
      this.exact(vault, this.replacement);
      assert.equal(snapshot.unmaskInboundText('$${<TOGGLE>}'), this.value);
      assert.equal(vault.redactProtected(this.value), '$${<TOGGLE>}');
      assert.deepEqual(db.getVersions(), archived);
      const saved = await patch('TOGGLE', { isSecret: true, description: 'encrypted again' });
      assert.equal(saved.statusCode, 200);
      assert.equal(saved.json().secret.isSecret, true);
      assert.equal(Object.hasOwn(saved.json().secret, 'realValue'), false);
      this.provider.failDecrypt = this.provider.decrypts + 1;
      const unavailableDecode = await patch('TOGGLE', { isSecret: false });
      this.provider.failDecrypt = Infinity;
      assert.equal(unavailableDecode.statusCode, 503);
      const ciphertext = sql.prepare('SELECT protected_value FROM secrets WHERE key = ?').get('TOGGLE')!.protected_value;
      sql.prepare('UPDATE secrets SET protected_value = ? WHERE key = ?').run('{}', 'TOGGLE');
      const corruptedState = this.state(sql);
      const corrupted = await patch('TOGGLE', { isSecret: false, realValue: this.replacement });
      assert.equal(corrupted.statusCode, 422);
      assert.equal(corrupted.json().code, 'SECRET_DECRYPTION_FAILED');
      assert.equal(this.state(sql), corruptedState);
      sql.prepare('UPDATE secrets SET protected_value = ? WHERE key = ?').run(ciphertext, 'TOGGLE');
      const plain = await patch('TOGGLE', { isSecret: false });
      assert.equal(plain.statusCode, 200);
      assert.equal(plain.json().secret.realValue, this.replacement);
      assert.equal(plain.json().secret.description, 'encrypted again');
      const noOp = this.state(sql);
      assert.equal((await patch('TOGGLE', { isSecret: false })).statusCode, 200);
      assert.equal(this.state(sql), noOp);
      const listed = (await app.inject({ url: '/api/vault' })).json().manual.find((item: { key: string }) => item.key === 'TOGGLE');
      assert.equal(listed.realValue, this.replacement);
      await this.surfaces(app, server, vault, db);
      assert.equal((await post({ key: 'POST_TOGGLE', realValue: 'ordinary-created', isSecret: false, operation: 'create' })).statusCode, 200);
      assert.equal((await post({ key: 'POST_TOGGLE', realValue: 'duplicate', isSecret: false, operation: 'create' })).json().code, 'SECRET_ALREADY_EXISTS');
      assert.equal((await post({ key: 'ABSENT', realValue: 'absent', isSecret: false, operation: 'update' })).json().code, 'VARIABLE_NOT_FOUND');
      assert.equal((await post({ key: 'AUTOMATIC', realValue: 'foreign', isSecret: false, operation: 'create' })).json().code, 'ALIAS_CONFLICT');
      assert.equal((await post({ key: 'POST_TOGGLE', realValue: 'protected-new', isSecret: true, operation: 'update' })).statusCode, 200);
      assert.equal((await post({ key: 'POST_TOGGLE', realValue: 'legacy-replacement' })).json().secret.isSecret, true);
      const disabled = await post({ key: 'POST_TOGGLE', realValue: 'plain-replacement', isSecret: false, operation: 'update' });
      assert.equal(disabled.statusCode, 200);
      assert.equal(disabled.json().secret.realValue, 'plain-replacement');
      assert.equal((await post({ key: 'POST_TOGGLE', realValue: 'plain-upsert', isSecret: false })).statusCode, 200);
      assert.equal((await post({ key: 'NEW_PLAIN', realValue: 'plain-create', isSecret: false })).statusCode, 200);
      assert.equal((await patch('POST_TOGGLE', { name: 'POST_RENAMED' })).json().secret.alias, '$${<POST_RENAMED>}');
      const stale = vault.captureProtectedTargets(['POST_RENAMED'])[0].revision;
      vault.setManualSecret('POST_RENAMED', 'new-current');
      assert.throws(() => vault.setManualSecret('POST_RENAMED', 'stale', undefined, false, stale), error => (error as { code?: string }).code === 'SECRET_WRITE_CONFLICT');
    } finally { await server.close(); }
  };

  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP encryption toggle native test: Windows required'); return; }
    mkdirSync(this.directory, { recursive: true });
    let db = new VaultDatabase(this.file, this.provider);
    const row = { key: 'TOGGLE', alias: '$${<TOGGLE>}', real_value: this.old, mask_in_ai: 0, description: 'keep description', created_at: '2026-01-01', updated_at: '2026-01-01' };
    db.upsertSecret(row);
    db.archiveSecret(row.key);
    db.archiveSecret(row.key);
    db.upsertSecret({ ...row, real_value: this.value });
    let vault = new VaultStore(db);
    vault.setManualSecret('UNRELATED', 'unrelated-retained', undefined, true);
    const sql = new DatabaseSync(this.file);
    try {
      sql.prepare('INSERT INTO transactions(id, prompt_text, model_response) VALUES (?, ?, ?)').run('toggle-persisted-history', 'before\0' + this.value, this.old);
      const archived = db.getVersions().map(version => ({ forms: db.archivedRepresentations.get(version), metadata: db.archivedRepresentations.metadata(version) }));
      const unrelated = db.getSecrets().find(item => item.key === 'UNRELATED');
      vault.protectManualSecret('TOGGLE');
      assert.ok(db.getVersions().every(version => version.is_secret === 1 && version.real_value === ''));
      this.rollback(vault, sql);
      vault.setManualProtection('TOGGLE', { isSecret: false });
      this.exact(vault, this.value);
      assert.equal(db.getSecrets().find(item => item.key === 'TOGGLE')!.protected_value, '');
      assert.ok(db.getVersions().every(version => version.is_secret === 0 && version.real_value === this.old && version.protected_value === ''));
      assert.deepEqual(db.getVersions().map(version => ({ forms: db.archivedRepresentations.get(version), metadata: db.archivedRepresentations.metadata(version) })), archived);
      assert.deepEqual(db.getSecrets().find(item => item.key === 'UNRELATED'), unrelated);
      assert.equal(vault.redactProtected(this.old), '$${<TOGGLE>}');
      const history = sql.prepare('SELECT CAST(prompt_text AS BLOB) AS prompt_text, CAST(model_response AS BLOB) AS model_response FROM transactions WHERE id = ?').get('toggle-persisted-history')!;
      assert.ok(!Buffer.from(history.prompt_text as Uint8Array).toString('utf8').includes(this.value));
      assert.ok(!Buffer.from(history.model_response as Uint8Array).toString('utf8').includes(this.old));
      db.close();
      db = new VaultDatabase(this.file, this.provider);
      vault = new VaultStore(db);
      this.exact(vault, this.value);
      const beforeEnable = this.state(sql);
      this.provider.failEncrypt = this.provider.encrypts + 2;
      assert.throws(() => vault.setManualProtection('TOGGLE', { isSecret: true }), error => error instanceof SecretStorageError);
      this.provider.failEncrypt = Infinity;
      assert.equal(this.state(sql), beforeEnable);
      vault.setManualProtection('TOGGLE', { isSecret: true });
      assert.equal(db.protectedStorage.cleanupPending, false);
      for (const file of [this.file, this.file + '-wal']) if (existsSync(file)) for (const value of [this.old, this.value]) for (const form of new Set(Object.values(VaultStore.computeVariants(value)))) assert.equal(readFileSync(file).includes(Buffer.from(form)), false);
      vault.setManualProtection('TOGGLE', { isSecret: false });
      await this.api(vault, db, sql);
      assert.equal(db.getVersions().length, 2);
      db.close();
      db = new VaultDatabase(this.file, this.provider);
      vault = new VaultStore(db);
      this.exact(vault, this.replacement);
      assert.equal(vault.getManualSecrets().find(item => item.key === 'TOGGLE')!.isSecret, false);
      assert.ok(db.getVersions().every(version => version.real_value === this.old && !version.is_secret));
      assert.deepEqual(db.getVersions().map(version => ({ forms: db.archivedRepresentations.get(version), metadata: db.archivedRepresentations.metadata(version) })), archived);
      vault.deleteSecret('TOGGLE');
      const orphanServer = new GhostProxyServer(vault, { port: 0 });
      try {
        for (const url of ['/api/export', '/api/export?group=secrets', '/api/export?groups=settings,secrets']) {
          const response = await orphanServer.getApp().inject({ url });
          assert.equal(response.statusCode, 200);
          const orphans = response.json().data.orphanedSecretVersions;
          assert.equal(orphans.length, 2);
          for (const version of orphans) { assert.equal(version.real_value, this.old); assert.ok(version.representations.some((form: { value: string }) => form.value === this.old)); }
          assert.ok(!response.body.includes('unrelated-retained'));
        }
        assert.equal((await orphanServer.getApp().inject({ url: '/api/export?group=secrets&id=TOGGLE' })).statusCode, 404);
      } finally { await orphanServer.close(); }
      console.log(JSON.stringify({ encryptionToggle: 'PASS', nativeDpapi: true, exactUnicodeNul: true, archiveAtomic: true, rollback: true, api: true, restart: true, fixture: this.directory }));
    } finally { sql.close(); db.close(); }
  };
}

await new VariableEncryptionToggleTests().run();
