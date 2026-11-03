import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { parse } from 'smol-toml';
import { RuntimeSettings } from '../runtime/settings.js';
import { ClientConfigInstaller } from './config.js';
import { AutostartInstaller } from './autostart.js';

class SetupTests {
  public run = (): void => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-setup-'));
    const settings = new RuntimeSettings({ dataDir: path.join(root, 'data'), port: 43123 });
    const entry = path.join(root, 'release with spaces', 'dist/runtime/cli.js');
    const installer = new ClientConfigInstaller(settings, entry);
    try {
      for (const client of ['claude', 'cursor', 'codex'] as const) {
        const target = path.join(root, client + (client === 'codex' ? '.toml' : '.json'));
        const original = client === 'codex' ? 'model = "synthetic-model"\n[mcp_servers.other]\ncommand = "other-tool"\n' : JSON.stringify({ theme: 'dark', mcpServers: { other: { command: 'other-tool' } } });
        writeFileSync(target, original);
        const preview = installer.install(client, target, true);
        assert.equal(preview.changed, true);
        assert.equal(readFileSync(target, 'utf8'), original);
        assert.equal(readdirSync(root).filter(name => name.includes('backup')).length, client === 'claude' ? 0 : client === 'cursor' ? 1 : 2);
        const result = installer.install(client, target);
        assert.equal(result.changed, true);
        assert.equal(readFileSync(result.backup!, 'utf8'), original);
        const configuration = client === 'codex' ? parse(readFileSync(target, 'utf8')) : JSON.parse(readFileSync(target, 'utf8'));
        const servers = configuration[client === 'codex' ? 'mcp_servers' : 'mcpServers'];
        assert.equal(servers.other.command, 'other-tool');
        assert.equal(servers.ghostvault.command, process.execPath);
        assert.deepEqual(servers.ghostvault.args, [entry, 'mcp-bridge', ...settings.arguments()]);
        const repeat = installer.install(client, target);
        assert.equal(repeat.changed, false);
        assert.equal(repeat.backup, undefined);
      }
      const invalid = path.join(root, 'invalid.json');
      writeFileSync(invalid, '{broken');
      assert.throws(() => installer.install('claude', invalid));
      assert.equal(readFileSync(invalid, 'utf8'), '{broken');
      const target = path.join(root, 'startup.lnk');
      const autostart = new AutostartInstaller(settings, entry);
      const preview = autostart.install({ target, platform: 'win32' });
      assert.equal(existsSync(target), false);
      assert.match(preview.content, /WindowStyle Hidden/);
      assert.equal(autostart.install({ target, platform: 'win32', apply: true }).changed, true);
      assert.equal(autostart.install({ target, platform: 'win32', apply: true }).changed, false);
      assert.throws(() => autostart.install({ target, platform: 'linux', apply: true }), /currently supported on Windows only/);
      assert.equal(existsSync(settings.databasePath), false);
      console.log('PASS setup: JSON/TOML merges, backups, repeated execution, dry-run, hidden Windows login artifact, explicit platform boundaries');
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

new SetupTests().run();
