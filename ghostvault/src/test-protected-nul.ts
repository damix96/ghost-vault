import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { SqliteText } from './vault/sqlite-text.js';

class ProtectedNulTests {
  private current = 'qa-nul-prefix\0qa-nul-suffix';
  private archived = 'qa-past-prefix\0qa-past-suffix\r\n\u5bc6\u78bc';
  private description = 'synthetic-description\0retained';
  private bytes = (db: DatabaseSync, table: string, column: string): string => Buffer.from(db.prepare('SELECT CAST(' + column + ' AS BLOB) AS bytes FROM ' + table).get()!.bytes as Uint8Array).toString('utf8');

  private encodings = (): void => {
    for (const encoding of ['UTF-8', 'UTF-16le', 'UTF-16be']) {
      const db = new DatabaseSync(':memory:');
      try {
        db.exec("PRAGMA encoding = '" + encoding + "'; CREATE TABLE sample(value TEXT)");
        const value = '\ufeffbefore\0\u5bc6\u78bc\ud83d\ude00after';
        db.prepare('INSERT INTO sample(value) VALUES (?)').run(value);
        const reader = new SqliteText(db);
        const select = 'SELECT ' + SqliteText.columns(['value']) + ' FROM sample';
        assert.equal(reader.all<{ value: string }>(select)[0].value, value);
        if (encoding === 'UTF-8') {
          db.exec("INSERT INTO sample(value) VALUES (CAST(x'FF' AS TEXT))");
          assert.throws(() => reader.all(select), TypeError);
          assert.equal(db.prepare('SELECT hex(value) AS bytes FROM sample WHERE rowid = 2').get()!.bytes, 'FF');
        }
      } finally { db.close(); }
    }
  };

  public run = (): void => {
    if (process.platform !== 'win32') { console.log('SKIP real Windows NUL conversion test'); return; }
    this.encodings();
    const directory = path.resolve('.cache/secret-storage-dist/nul', randomUUID());
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'vault.db');
    let db = new VaultDatabase(file);
    const row = { key: 'NUL_CURRENT', alias: '$${<NUL_CURRENT>}', real_value: this.archived, mask_in_ai: 0, description: this.description, created_at: '2026-01-01', updated_at: '2026-01-02' };
    db.upsertSecret(row);
    db.archiveSecret(row.key);
    db.upsertSecret({ ...row, real_value: this.current });
    db.upsertAutoSecret({ key: 'LEGACY_AUTO', real_value: 'synthetic-auto\0retained', alias: '$${<LEGACY_AUTO>}', hit_count: 1, first_seen_at: row.created_at, last_seen_at: row.updated_at });
    db.close();
    const observer = new DatabaseSync(file);
    const nativeTextExact = (observer.prepare('SELECT real_value FROM secrets').get()!.real_value as string) === this.current;
    assert.equal(this.bytes(observer, 'secrets', 'real_value'), this.current);
    assert.equal(this.bytes(observer, 'secret_versions', 'real_value'), this.archived);
    observer.prepare('INSERT INTO transactions(id,session_id,client,timestamp,prompt_text,masked_prompt,model_response,intercepted_secrets,url,target_url) VALUES (?,?,?,?,?,?,?,?,?,?)').run('nul-transaction', 'public-session', 'public-client', '2026-01-03', 'before\0' + this.current + '\0after', 'unchanged\0suffix', this.archived, '[]', '/unchanged\0route', 'https://synthetic.invalid/\0target');
    db = new VaultDatabase(file);
    try {
      const vault = new VaultStore(db);
      assert.equal(vault.getManualSecrets()[0].realValue, this.current);
      assert.equal(vault.getManualSecrets()[0].description, this.description);
      assert.equal(vault.getAutoSecrets()[0].realValue, 'synthetic-auto\0retained');
      assert.equal(db.getVersions()[0].real_value, this.archived);
      assert.equal(vault.getArchivedRepresentations(db.getVersions()[0])[0].value, this.archived);
      observer.exec("CREATE TRIGGER synthetic_nul_rollback BEFORE UPDATE ON secret_versions WHEN NEW.is_secret = 1 BEGIN SELECT RAISE(ABORT, 'synthetic NUL rollback'); END;");
      assert.throws(() => vault.protectManualSecret(row.key), /synthetic NUL rollback/);
      assert.equal(this.bytes(observer, 'secrets', 'real_value'), this.current);
      assert.equal(this.bytes(observer, 'secret_versions', 'real_value'), this.archived);
      assert.equal(this.bytes(observer, 'transactions', 'prompt_text'), 'before\0' + this.current + '\0after');
      assert.equal(vault.getManualSecrets()[0].isSecret, false);
      assert.equal(vault.getRetention().cleanupPending, false);
      observer.exec('DROP TRIGGER synthetic_nul_rollback');
      const protectedEntry = vault.protectManualSecret(row.key)!;
      assert.equal(protectedEntry.realValue, this.current);
      assert.equal(protectedEntry.alias, row.alias);
      assert.equal(protectedEntry.description, this.description);
      assert.equal(protectedEntry.maskInAi, false);
      assert.equal(protectedEntry.createdAt, row.created_at);
      assert.equal(vault.unmaskInboundText(row.alias), this.current);
      assert.equal(db.protectedStorage.decode(db.getVersions()[0]).real_value, this.archived);
      assert.equal(vault.getArchivedRepresentations(db.getVersions()[0])[0].value, this.archived);
      const prompt = this.bytes(observer, 'transactions', 'prompt_text');
      assert.equal(prompt.startsWith('before\0'), true);
      assert.equal(prompt.endsWith('\0after'), true);
      assert.equal(vault.unmaskInboundText(prompt.slice('before\0'.length, -'\0after'.length)), this.current);
      assert.match(this.bytes(observer, 'transactions', 'model_response'), /^\$\$\{<[A-Z0-9_]+>\}$/);
      assert.equal(this.bytes(observer, 'transactions', 'masked_prompt'), 'unchanged\0suffix');
      assert.equal(this.bytes(observer, 'transactions', 'url'), '/unchanged\0route');
      assert.equal(this.bytes(observer, 'transactions', 'target_url'), 'https://synthetic.invalid/\0target');
      assert.equal(vault.getRetention().cleanupPending, false);
      for (const target of [file, file + '-wal']) if (existsSync(target)) {
        const contents = readFileSync(target);
        for (const value of [this.current, this.archived]) for (const form of Object.values(VaultStore.computeVariants(value))) assert.equal(contents.includes(Buffer.from(form)), false);
      }
    } finally {
      observer.close();
      db.close();
    }
    const reopened = new VaultDatabase(file);
    try {
      const vault = new VaultStore(reopened);
      assert.equal(vault.unmaskInboundText(row.alias), this.current);
      assert.equal(vault.getManualSecrets()[0].description, this.description);
      assert.equal(reopened.protectedStorage.decode(reopened.getVersions()[0]).real_value, this.archived);
    } finally { reopened.close(); }
    console.log(JSON.stringify({ protectedNul: 'PASS', nativeTextExact, sqliteEncodingsAndBomExact: true, invalidBytesFailClosed: true, ordinaryAndArchiveReopenMarkExact: true, rollbackExact: true, diagnosticsAndUnrelatedSuffixPreserved: true, protectedRestartExact: true, dbWalCanaryAbsent: true, fixture: directory }));
  };
}

new ProtectedNulTests().run();
