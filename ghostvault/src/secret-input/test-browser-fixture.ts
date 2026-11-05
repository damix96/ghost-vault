import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { VaultDatabase } from '../vault/sqlite-db.js';
import { VaultStore } from '../vault/store.js';
import { GhostProxyServer } from '../proxy/server.js';
import { VaultMcpEndpoint } from '../mcp/endpoint.js';
import { SecretInputBrowser } from './browser-launcher.js';
import { SecretStorageError } from '../security/secret-provider.js';

const root = path.resolve('.cache/secret-intake-fixtures');
mkdirSync(root, { recursive: true });
const directory = mkdtempSync(path.join(root, 'browser-'));
const unavailable = process.argv.includes('--provider-unavailable');
const db = new VaultDatabase(path.join(directory, 'vault.db'), unavailable ? { id: 'windows-dpapi', encrypt: () => { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }, decrypt: () => { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); } } : undefined);
const vault = new VaultStore(db);
vault.setManualSecret('SEED_ORDINARY', 'synthetic-ordinary-browser-value');
if (!unavailable) vault.setManualSecret('SEED_PROTECTED', 'synthetic-protected-browser-value', undefined, true);
const reader = process.argv.includes('--cleanup-pending') ? new DatabaseSync(path.join(directory, 'vault.db'), { readOnly: true }) : undefined;
if (reader) { reader.exec('BEGIN'); reader.prepare('SELECT key FROM secrets').all(); }
const browser = new SecretInputBrowser('win32', async command => {
  writeFileSync(path.join(directory, 'launch.json'), JSON.stringify({ url: command.env.GHOSTVAULT_INPUT_URL }), { mode: 0o600 });
  return true;
});
const proxy = new GhostProxyServer(vault, { host: '127.0.0.1', port: 0 }, undefined, browser);
const endpoint = new VaultMcpEndpoint(proxy.getApp(), vault, { version: '0.2.0-browser-fixture', mcpToken: 'synthetic-browser-fixture-token' });
endpoint.register();
let stopping: Promise<void> | undefined;
const close = (): Promise<void> => {
  stopping ??= (async () => { await endpoint.close(); await proxy.close(); if (reader) { reader.exec('ROLLBACK'); reader.close(); db.protectedStorage.clean(); } db.close(); process.stdin.pause(); })();
  return stopping;
};
process.once('SIGINT', () => { void close(); });
process.once('SIGTERM', () => { void close(); });
process.stdin.setEncoding('utf8');
process.stdin.on('data', text => { if (String(text).trim() === 'close') void close(); });
process.stdin.once('end', () => { void close(); });
const origin = await proxy.listen();
const seedNames = vault.getManualSecrets().map(entry => entry.key);
writeFileSync(path.join(directory, 'fixture.json'), JSON.stringify({ origin, seedNames }), { mode: 0o600 });
process.stdout.write(JSON.stringify({ origin, directory, seedNames }) + '\n');
