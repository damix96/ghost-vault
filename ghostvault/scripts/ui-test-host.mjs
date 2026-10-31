import { cp, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { basename, join, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

export class UiTestHost {
  root = fileURLToPath(new URL('../', import.meta.url));
  temporary = '';

  isolateClipboard = context => context.addInitScript(() => {
    let text = '';
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { text = String(value); }, readText: async () => text } });
  });

  init = async (seed = () => {}) => {
    try {
      if (process.env.UI_BUILD_DIR) {
        const source = this.root;
        this.temporary = await mkdtemp(join(tmpdir(), 'ghostvault-ui-check-'));
        this.root = this.temporary;
        await Promise.all([
          cp(join(source, 'dist'), join(this.root, 'dist'), { recursive: true }),
          cp(resolve(process.env.UI_BUILD_DIR), join(this.root, 'public'), { recursive: true }),
          symlink(join(source, 'node_modules'), join(this.root, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir'),
          writeFile(join(this.root, 'package.json'), JSON.stringify({ type: 'module' })),
        ]);
      }
      const [{ GhostProxyServer }, { VaultDatabase }, { VaultStore }] = await Promise.all([
        import(pathToFileURL(join(this.root, 'dist/proxy/server.js')).href),
        import(pathToFileURL(join(this.root, 'dist/vault/sqlite-db.js')).href),
        import(pathToFileURL(join(this.root, 'dist/vault/store.js')).href),
      ]);
      this.database = new VaultDatabase(':memory:');
      seed(this.database);
      this.server = new GhostProxyServer(new VaultStore(this.database), { port: 0 });
      this.app = this.server.getApp();
      this.publicRoot = join(this.root, 'public');
    } catch (error) {
      await this.close();
      throw error;
    }
  };

  seedTransaction = row => this.server.recordTransaction({
    id: row.id, sessionId: row.session_id, timestamp: row.timestamp, latencyMs: row.latency_ms,
    request: { method: row.method, url: row.url, headers: {}, client: row.client, body: UiTestHost.parse(row.prompt_text) },
    response: { status: row.status, headers: {}, body: UiTestHost.parse(row.model_response), isStream: false },
    maskedPrompt: row.masked_prompt || undefined, interceptedSecrets: JSON.parse(row.intercepted_secrets || '[]'),
    targetUrl: row.target_url, targetProvider: row.target_provider,
  });

  static parse = text => {
    let value = text;
    try { value = JSON.parse(text); } catch {}
    return value;
  };

  close = async () => {
    if (this.server) await this.server.close();
    else await this.app?.close();
    this.database?.close();
    if (this.temporary) {
      const target = await realpath(this.temporary);
      const parent = await realpath(tmpdir());
      if (!target.startsWith(parent + sep) || !basename(target).startsWith('ghostvault-ui-check-')) throw new Error('Unsafe temporary fixture path');
      await rm(target, { recursive: true, force: true });
      this.temporary = '';
    }
  };
}
