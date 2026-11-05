import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { WindowsDpapi } from './security/windows-dpapi.js';
import { SecretProvider, SecretStorageError } from './security/secret-provider.js';

class FaultProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  fail = false;
  private native = new WindowsDpapi();
  encrypt = (value: Buffer, context: Buffer): Buffer => {
    if (this.fail) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
    return this.native.encrypt(value, context);
  };
  decrypt = (value: Buffer, context: Buffer): Buffer => this.native.decrypt(value, context);
}

class ProtectedStorageTests {
  readonly root = path.resolve('.cache/secret-storage-dist/fixtures', randomUUID());
  readonly file = path.join(this.root, 'storage.db');
  readonly original = 'GV_STORAGE_SYNTHETIC_' + randomUUID() + '_\u041f\u0430\u0440\u043e\u043b\u044c\r\nsecond\n\tline';
  readonly provider = new FaultProvider();

  private noPlaintext = (): void => {
    const forms = Object.values(VaultStore.computeVariants(this.original)).filter(Boolean);
    for (const file of [this.file, this.file + '-wal']) {
      if (!existsSync(file)) continue;
      const bytes = readFileSync(file);
      for (const value of forms) assert.equal(bytes.includes(Buffer.from(value)), false, path.basename(file) + ' contains synthetic original representation');
    }
  };

  public run = (): void => {
    if (process.platform !== 'win32') { console.log('SKIP real Windows storage test: Windows required'); return; }
    mkdirSync(this.root, { recursive: true });
    let db = new VaultDatabase(this.file, this.provider);
    const store = new VaultStore(db);
    store.setManualSecret('STORAGE_SOURCE', this.original, 'synthetic description');
    db.archiveSecret('STORAGE_SOURCE');
    db.archiveSecret('STORAGE_SOURCE');
    db.archivedRepresentations.capture(db.getVersions());
    const row = db.getSecrets()[0];
    const before = db.getVersions().map(item => ({ forms: db.archivedRepresentations.get(item), metadata: db.archivedRepresentations.metadata(item) }));
    const initial = JSON.stringify(db.getSecrets());
    assert.throws(() => db.aliases.transaction(() => {
      db.upsertSecret({ ...row, is_secret: 1 });
      db.protectedStorage.protectArchives(row.key, db.archivedRepresentations.relocate);
      throw new Error('synthetic rollback');
    }));
    assert.equal(JSON.stringify(db.getSecrets()), initial);
    assert.deepEqual(db.getVersions().map(item => ({ forms: db.archivedRepresentations.get(item), metadata: db.archivedRepresentations.metadata(item) })), before);
    this.provider.fail = true;
    assert.throws(() => db.aliases.transaction(() => db.upsertSecret({ ...row, is_secret: 1 })), error => error instanceof SecretStorageError);
    assert.equal(JSON.stringify(db.getSecrets()), initial);
    this.provider.fail = false;
    db.aliases.transaction(() => {
      db.upsertSecret({ ...row, is_secret: 1 });
      db.protectedStorage.protectArchives(row.key, db.archivedRepresentations.relocate);
    });
    assert.equal(db.getSecrets()[0].real_value, '');
    assert.equal(db.getVersions().length, 2);
    const versions = db.getVersions().map(db.protectedStorage.decode);
    assert(versions.every(item => item.real_value === this.original && item.is_secret === 1));
    assert.deepEqual(versions.map(item => ({ forms: db.archivedRepresentations.get(item), metadata: db.archivedRepresentations.metadata(item) })), before);
    assert.equal(db.protectedStorage.clean(true), true);
    this.noPlaintext();
    const encrypted = db.getSecrets()[0];
    const inspector = new DatabaseSync(this.file);
    assert.throws(() => inspector.prepare('UPDATE secrets SET real_value = ? WHERE key = ?').run('legacy-writer-plaintext', row.key), /Invalid protected value storage/);
    assert.throws(() => inspector.prepare("UPDATE secrets SET is_secret = 0, protected_value = '', real_value = ? WHERE key = ?").run('legacy-demotion', row.key), /Protected value cannot be demoted/);
    inspector.prepare('UPDATE secrets SET protected_value = ? WHERE key = ?').run('{}', row.key);
    assert.throws(() => db.protectedStorage.decode(db.getSecrets()[0]), error => error instanceof SecretStorageError && error.code === 'SECRET_DECRYPTION_FAILED');
    inspector.prepare('UPDATE secrets SET protected_value = ? WHERE key = ?').run(encrypted.protected_value!, row.key);
    inspector.close();
    db.close();
    db = new VaultDatabase(this.file, this.provider);
    assert.equal(db.protectedStorage.decode(db.getSecrets()[0]).real_value, this.original);
    assert.equal(db.getVersions().length, 2);
    assert.equal(db.protectedStorage.clean(), true);
    this.noPlaintext();
    db.close();
    console.log(JSON.stringify({ storage: 'PASS', realDpapi: true, archiveDuplicates: true, exactHistoricalForms: true, rollback: true, corruption: true, legacySqlBlocked: true, restart: true, dbWalCanaryAbsent: true, fixture: this.root }));
  };
}

new ProtectedStorageTests().run();
