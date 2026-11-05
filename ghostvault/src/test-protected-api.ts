import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

class ProtectedApiTests {
  private directory = path.resolve('.cache/secret-storage-dist/api', randomUUID());
  private file = path.join(this.directory, 'vault.db');
  private values = ['synthetic-source-' + randomUUID() + '-\u5bc6\u78bc\r\nline', 'synthetic-replacement-' + randomUUID()];
  private assertHidden = (body: string): void => {
    for (const value of this.values.flatMap(value => Object.values(VaultStore.computeVariants(value)))) if (value) assert.equal(body.includes(value), false, 'Protected representation leaked');
  };

  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP real Windows protected API test'); return; }
    mkdirSync(this.directory, { recursive: true });
    let db = new VaultDatabase(this.file);
    db.upsertSecret({ key: 'PROTECTED', real_value: this.values[0], alias: '$${<PROTECTED>}', mask_in_ai: 0, description: 'Synthetic description', created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z' });
    db.archiveSecret('PROTECTED');
    let vault = new VaultStore(db);
    vault.setManualSecret('ORDINARY', 'ordinary-visible');
    let server = new GhostProxyServer(vault, { port: 0 });
    let app = server.getApp();
    app.get('/api/protected-fixture', async () => ({ body: { [this.values[0]]: this.values[0] }, value: this.values[0], encoded: Buffer.from(this.values[0]).toString('base64') }));
    app.get('/passthrough-fixture', async () => ({ value: this.values[0] }));
    const marked = await app.inject({ method: 'PATCH', url: '/api/vault/secret/PROTECTED', payload: { isSecret: true } });
    assert.equal(marked.statusCode, 200);
    const entry = marked.json().secret;
    assert.equal(entry.isSecret, true);
    assert.equal(entry.maskInAi, false);
    assert.equal(entry.alias, '$${<PROTECTED>}');
    assert.equal(entry.createdAt, '2026-01-01T00:00:00Z');
    assert.equal(entry.description, 'Synthetic description');
    for (const field of ['realValue', 'variants', 'representations', 'protected_value']) assert.equal(Object.hasOwn(entry, field), false);
    this.assertHidden(marked.body);
    for (const url of ['/api/vault', '/api/protected-fixture', '/api/export', '/api/export?group=secrets', '/api/export?groups=settings,secrets', '/api/export?group=secrets&id=PROTECTED']) {
      const response = await app.inject({ url });
      assert.equal(response.statusCode, 200);
      this.assertHidden(response.body);
      assert.equal(response.body.includes('protected_value'), false);
    }
    assert.equal((await app.inject({ url: '/passthrough-fixture' })).json().value, this.values[0]);
    const exported = (await app.inject({ url: '/api/export?group=secrets&id=PROTECTED' })).json().data.secrets[0];
    assert.equal(exported.valueOmitted, true);
    assert.equal(exported.versions[0].valueOmitted, true);
    for (const url of ['/api/export', '/api/export?group=secrets', '/api/export?groups=settings,secrets']) {
      const data = (await app.inject({ url })).json().data;
      const protectedRow = data.secrets.find((row: { key: string }) => row.key === 'PROTECTED');
      const ordinaryRow = data.secrets.find((row: { key: string }) => row.key === 'ORDINARY');
      assert.equal(protectedRow.valueOmitted, true);
      assert.equal(protectedRow.isSecret, true);
      assert.equal(protectedRow.alias, entry.alias);
      assert.equal(protectedRow.versions[0].valueOmitted, true);
      for (const row of [protectedRow, ...protectedRow.versions]) for (const field of ['real_value', 'representations', 'protected_value']) assert.equal(Object.hasOwn(row, field), false);
      assert.equal(ordinaryRow.real_value, 'ordinary-visible');
      assert.equal(Object.hasOwn(ordinaryRow, 'valueOmitted'), false);
      assert.equal(data.secrets.length, 2);
    }
    const newSecret = { key: 'CREATED_PROTECTED', realValue: 'synthetic-created-protected', isSecret: true, operation: 'create' };
    assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: newSecret })).statusCode, 200);
    assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: newSecret })).json().code, 'SECRET_ALREADY_EXISTS');
    assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { ...newSecret, key: 'ABSENT', operation: 'update' } })).statusCode, 404);
    const protectedUpdate = await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { ...newSecret, realValue: 'synthetic-created-replacement', operation: 'update' } });
    assert.equal(protectedUpdate.statusCode, 200);
    assert.equal(protectedUpdate.json().secret.isSecret, true);
    assert.equal(Object.hasOwn(protectedUpdate.json().secret, 'realValue'), false);
    assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key: newSecret.key, realValue: 'demotion-attempt', isSecret: false } })).json().code, 'SECRET_DEMOTION_UNSUPPORTED');
    assert.equal((await app.inject({ method: 'PATCH', url: '/api/vault/secret/PROTECTED', payload: { name: 'MIXED', isSecret: true } })).statusCode, 400);
    assert.equal((await app.inject({ url: '/api/vault' })).json().manual.find((item: { key: string }) => item.key === 'ORDINARY').realValue, 'ordinary-visible');
    const snapshot = vault.snapshot();
    const updated = await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key: 'PROTECTED', realValue: this.values[1], description: 'Replacement' } });
    assert.equal(updated.statusCode, 200);
    assert.equal(updated.json().secret.isSecret, true);
    this.assertHidden(updated.body);
    assert.equal(vault.unmaskInboundText(entry.alias), this.values[1]);
    assert.equal(snapshot.unmaskInboundText(entry.alias), this.values[0]);
    assert.equal(db.getVersions().length, 1);
    this.assertHidden((await app.inject({ url: '/api/protected-fixture' })).body);
    const renamed = await app.inject({ method: 'PATCH', url: '/api/vault/secret/PROTECTED', payload: { name: 'RENAMED_PROTECTED' } });
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.json().secret.isSecret, true);
    assert.equal(vault.unmaskInboundText('$${<RENAMED_PROTECTED>}'), this.values[1]);
    assert.equal(vault.unmaskInboundText(entry.alias), entry.alias);
    await server.close();
    db.close();
    db = new VaultDatabase(this.file);
    vault = new VaultStore(db);
    assert.equal(vault.unmaskInboundText('$${<RENAMED_PROTECTED>}'), this.values[1]);
    server = new GhostProxyServer(vault, { port: 0 });
    app = server.getApp();
    assert.equal((await app.inject({ method: 'DELETE', url: '/api/vault/secret/RENAMED_PROTECTED' })).statusCode, 200);
    for (const url of ['/api/vault', '/api/export', '/api/export?group=secrets', '/api/export?groups=secrets']) this.assertHidden((await app.inject({ url })).body);
    const orphan = (await app.inject({ url: '/api/export' })).json().data.orphanedSecretVersions[0];
    assert.equal(orphan.valueOmitted, true);
    assert.equal(orphan.key, 'RENAMED_PROTECTED');
    for (const url of ['/api/export?group=secrets', '/api/export?groups=secrets']) {
      const version = (await app.inject({ url })).json().data.orphanedSecretVersions[0];
      assert.deepEqual(version, orphan);
      for (const field of ['real_value', 'representations', 'protected_value']) assert.equal(Object.hasOwn(version, field), false);
    }
    assert.equal((await app.inject({ url: '/api/export?group=secrets&id=RENAMED_PROTECTED' })).statusCode, 404);
    assert.equal(db.getVersions().length, 1);
    assert.equal(db.protectedStorage.clean(true), true);
    for (const file of [this.file, this.file + '-wal']) if (existsSync(file)) this.assertHidden(readFileSync(file).toString('utf8'));
    await server.close();
    db.close();
    console.log(JSON.stringify({ protectedApi: 'PASS', markDisabled: true, safeDtos: true, ordinaryPreserved: true, scopedExport: true, retiredValueRedaction: true, proxyUntouched: true, renameUpdateRestartDelete: true, archives: true, fixture: this.directory }));
  };
}

await new ProtectedApiTests().run();
