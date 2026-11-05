import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { WindowsDpapi } from './security/windows-dpapi.js';
import { SecretProvider } from './security/secret-provider.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

class CountedUnicodeProvider implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  calls = 0;
  private native = new WindowsDpapi();
  encrypt = (value: Buffer, context: Buffer): Buffer => {
    this.calls++;
    return this.native.encrypt(value, context);
  };
  decrypt = (value: Buffer, context: Buffer): Buffer => this.native.decrypt(value, context);
}

class ProtectedUnicodeTests {
  private invalid = ['\ud800', '\udc00', 'prefix\ud800', '\ud800suffix', '\ud800\ud800', '\udc00\ud800', '\ud83d\ude00\ud800'];
  private valid = [' \ud83d\ude00\0\r\n\u5bc6\u78bc ', 'e\u0301\n\ud800\udc00', '\ufffd'];
  private invalidInput = (error: unknown): boolean => (error as { code?: string; statusCode?: number }).code === 'INVALID_SECRET_INPUT' && (error as { statusCode?: number }).statusCode === 400;

  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP real Windows storage Unicode test'); return; }
    const directory = path.resolve('.cache/secret-storage-dist/unicode', randomUUID());
    mkdirSync(directory, { recursive: true });
    const file = path.join(directory, 'vault.db');
    const provider = new CountedUnicodeProvider();
    const db = new VaultDatabase(file, provider);
    const vault = new VaultStore(db);
    const server = new GhostProxyServer(vault, { port: 0 });
    const app = server.getApp();
    try {
      vault.setManualSecret('EXISTING', 'synthetic-unchanged', undefined, true);
      const snapshot = () => JSON.stringify({ rows: db.getSecrets(), archives: db.getVersions(), settings: db.getAllSettings(), mappings: vault.getInboundReplacements() });
      const before = snapshot();
      const calls = provider.calls;
      for (const value of this.invalid) {
        assert.throws(() => VaultStore.computeVariants(value), this.invalidInput);
        assert.throws(() => vault.setManualSecret('BAD_DIRECT', value, undefined, true), this.invalidInput);
        const entries = vault.captureSecretTargets(['BATCH_NEW', 'EXISTING']).map(target => ({ ...target, value: target.name === 'EXISTING' ? value : 'synthetic-batch-new' }));
        assert.throws(() => vault.commitProtectedManualBatch({ requestId: randomUUID(), entries }), this.invalidInput);
        for (const payload of [
          { key: 'BAD_LEGACY', realValue: value },
          { key: 'BAD_CREATE', realValue: value, isSecret: true, operation: 'create' },
          { key: 'EXISTING', realValue: value, isSecret: true, operation: 'update' },
        ]) {
          const response = await app.inject({ method: 'POST', url: '/api/vault/secret', payload });
          assert.equal(response.statusCode, 400);
          assert.equal(response.json().code, 'INVALID_SECRET_INPUT');
        }
        assert.equal(snapshot(), before);
        assert.equal(provider.calls, calls);
        for (const name of ['BAD_DIRECT', 'BATCH_NEW', 'BAD_LEGACY', 'BAD_CREATE']) assert.equal(db.aliases.owner('$${<' + name + '>}'), undefined);
      }
      for (const [index, value] of this.valid.entries()) {
        const key = 'VALID_' + index;
        const response = await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key, realValue: value, isSecret: true, operation: 'create' } });
        assert.equal(response.statusCode, 200);
        assert.equal(vault.unmaskInboundText(response.json().secret.alias), value);
        assert.equal(VaultStore.computeVariants(value).raw, value);
      }
    } finally {
      await server.close();
      db.close();
    }
    const reopenedDb = new VaultDatabase(file);
    try {
      const reopened = new VaultStore(reopenedDb);
      for (const [index, value] of this.valid.entries()) assert.equal(reopened.unmaskInboundText('$${<VALID_' + index + '>}'), value);
    } finally { reopenedDb.close(); }
    console.log(JSON.stringify({ protectedUnicode: 'PASS', invalidBeforeProviderSqlAliases: true, batchAtomic: true, admin400: true, validPairsNulCrlfExactRestart: true, fixture: directory }));
  };
}

await new ProtectedUnicodeTests().run();
