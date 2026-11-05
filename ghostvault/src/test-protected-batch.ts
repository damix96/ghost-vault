import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { WindowsDpapi } from './security/windows-dpapi.js';
import { SecretProvider, SecretStorageError } from './security/secret-provider.js';

class BatchProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  calls = 0;
  failAt = -1;
  private native = new WindowsDpapi();
  encrypt = (value: Buffer, context: Buffer): Buffer => {
    this.calls++;
    if (this.calls === this.failAt) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
    return this.native.encrypt(value, context);
  };
  decrypt = (value: Buffer, context: Buffer): Buffer => this.native.decrypt(value, context);
}

class BatchTests {
  private directory = path.resolve('.cache/secret-storage-dist/batch', randomUUID());
  private isConflict = (error: unknown): boolean => (error as { code?: string }).code === 'SECRET_WRITE_CONFLICT';

  public run = (): void => {
    if (process.platform !== 'win32') { console.log('SKIP real Windows batch test'); return; }
    mkdirSync(this.directory, { recursive: true });
    const file = path.join(this.directory, 'vault.db');
    const provider = new BatchProvider();
    const db = new VaultDatabase(file, provider);
    const store = new VaultStore(db);
    const raw = new DatabaseSync(file);
    const make = (names: string[]) => ({ requestId: randomUUID(), entries: store.captureSecretTargets(names).map(target => ({ ...target, value: 'synthetic:' + target.name + ':value' })) });
    const create = make(['ONE', 'TWO']);
    provider.failAt = 2;
    const before = JSON.stringify(db.getSecrets());
    assert.throws(() => store.commitProtectedManualBatch(create), error => error instanceof SecretStorageError);
    assert.equal(JSON.stringify(db.getSecrets()), before);
    assert.deepEqual(store.getManualSecrets(), []);
    assert.deepEqual(store.getInboundReplacements(), []);
    provider.failAt = -1;
    raw.exec("CREATE TRIGGER synthetic_failure BEFORE INSERT ON secrets WHEN NEW.key = 'TWO' BEGIN SELECT RAISE(ABORT, 'synthetic SQL failure'); END;");
    assert.throws(() => store.commitProtectedManualBatch(create), /synthetic SQL failure/);
    assert.equal(JSON.stringify(db.getSecrets()), before);
    assert.deepEqual(store.getInboundReplacements(), []);
    raw.exec('DROP TRIGGER synthetic_failure');
    assert.deepEqual(store.commitProtectedManualBatch(create), { requestId: create.requestId, variables: [{ name: 'ONE', token: '$${<ONE>}' }, { name: 'TWO', token: '$${<TWO>}' }] });
    assert(store.getManualSecrets().every(entry => entry.isSecret));
    assert.throws(() => store.commitProtectedManualBatch(create), this.isConflict);
    const stale = make(['ONE', 'THREE']);
    const oldCatalog = store.listVariables().revision;
    store.setManualSecret('ONE', 'synthetic:new-value');
    assert.equal(store.listVariables().revision, oldCatalog);
    assert.throws(() => store.commitProtectedManualBatch(stale), this.isConflict);
    assert.equal(store.getManualSecrets().some(entry => entry.key === 'THREE'), false);
    const renamed = make(['TWO']);
    store.renameManualSecret('TWO', 'RENAMED');
    assert.throws(() => store.commitProtectedManualBatch(renamed), this.isConflict);
    store.setManualSecret('TWO', 'synthetic:separate-owner');
    assert.throws(() => store.commitProtectedManualBatch(renamed), this.isConflict);
    const removed = make(['ONE']);
    store.deleteSecret('ONE');
    store.setManualSecret('ONE', 'synthetic:recreated-owner');
    assert.throws(() => store.commitProtectedManualBatch(removed), this.isConflict);
    const metadata = make(['ONE']);
    store.setManualSecret('ONE', 'synthetic:recreated-owner', 'changed metadata');
    assert.throws(() => store.commitProtectedManualBatch(metadata), this.isConflict);
    const automatic = make(['AUTOMATIC', 'UNCOMMITTED']);
    store.setAutoSecret('AUTOMATIC', 'synthetic:auto-owned');
    const aliasConflict = (error: unknown): boolean => (error as { code?: string }).code === 'ALIAS_CONFLICT';
    assert.throws(() => store.commitProtectedManualBatch(automatic), aliasConflict);
    assert.equal(store.getManualSecrets().some(entry => ['AUTOMATIC', 'UNCOMMITTED'].includes(entry.key)), false);
    assert.equal(store.unmaskInboundText('$${<AUTOMATIC>}'), 'synthetic:auto-owned');
    const invalid = make(['NEW']);
    invalid.entries[0].value = '\u5bc6'.repeat(22000);
    assert.throws(() => store.commitProtectedManualBatch(invalid), error => (error as { code?: string }).code === 'INVALID_SECRET_INPUT');
    const duplicate = make(['NEW']);
    duplicate.entries.push({ ...duplicate.entries[0] });
    assert.throws(() => store.commitProtectedManualBatch(duplicate), error => (error as { code?: string }).code === 'INVALID_SECRET_INPUT');
    assert.equal(store.getManualSecrets().some(entry => entry.key === 'NEW'), false);
    store.setManualSecret('SHORT', 'a', undefined, true);
    const dto = store.publicEntry(store.getManualSecrets().find(entry => entry.key === 'SHORT')!);
    assert.equal(dto.key, 'SHORT');
    assert.equal(dto.alias, '$${<SHORT>}');
    assert.equal(Object.hasOwn(dto, 'realValue'), false);
    const projected = store.redactProtected({ id: 'a-public-id', alias: '$${<RENAMED>}', body: { a: 'a' } });
    assert.equal(projected.id, 'a-public-id');
    assert.equal(projected.alias, '$${<RENAMED>}');
    assert.equal(Object.hasOwn(projected.body, 'a'), false);
    raw.close();
    db.close();
    const restartedDb = new VaultDatabase(file);
    const restarted = new VaultStore(restartedDb);
    assert.equal(restarted.unmaskInboundText('$${<RENAMED>}'), 'synthetic:TWO:value');
    assert.equal(restarted.captureSecretTargets(['MISSING'])[0].expectedRevision, null);
    const expected = restarted.captureProtectedTargets(['CANONICAL']);
    const canonical = restarted.commitProtectedSecrets({ values: [{ key: 'CANONICAL', realValue: 'synthetic-canonical-secret' }], expected });
    assert.equal(canonical[0].isSecret, true);
    assert.equal(Object.hasOwn(canonical[0], 'realValue'), false);
    assert.throws(() => restarted.commitProtectedSecrets({ values: [{ key: 'MISMATCHED', realValue: 'synthetic-invalid' }], expected }), error => (error as { code?: string }).code === 'INVALID_SECRET_INPUT');
    restartedDb.close();
    console.log(JSON.stringify({ protectedBatch: 'PASS', atomicProviderAndSqlFailure: true, casEditRenameDeleteRecreate: true, noPartialPublication: true, limits: true, metadataShapeWithShortSecrets: true, restart: true, fixture: this.directory }));
  };
}

new BatchTests().run();
