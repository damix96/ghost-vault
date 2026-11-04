import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { setTimeout as delay } from 'node:timers/promises';
import { spawnSync } from 'node:child_process';
import { RuntimeSettings } from '../runtime/settings.js';
import { AutostartInstaller } from './autostart.js';
import { WindowsShortcut } from './windows-shortcut.js';

class AutostartTests {
  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP actual Windows shortcut execution on this platform'); return; }
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-startup-'));
    const marker = path.join(root, 'arguments.json');
    const entry = path.join(root, "helper space & (x) ' %.cjs");
    const target = path.join(root, 'synthetic startup.lnk');
    const settings = new RuntimeSettings({ dataDir: path.join(root, "data space & (x) ' %TEMP% $literal"), port: 43234 });
    const shortcuts = new WindowsShortcut();
    try {
      writeFileSync(entry, "require('node:fs').writeFileSync(" + JSON.stringify(marker) + ', JSON.stringify(process.argv.slice(2)));');
      const installed = new AutostartInstaller(settings, entry).install({ target, apply: true });
      const definition = shortcuts.inspect(target)!;
      assert.equal(definition.arguments.length, JSON.parse(installed.content).shortcut.arguments.length, 'Shortcut must retain the complete command');
      assert.match(definition.arguments, /-WindowStyle Hidden/);
      assert.equal(definition.windowStyle, 7);
      const command = Buffer.from(definition.arguments.split(' ').at(-1)!, 'base64').toString('utf16le');
      const direct = spawnSync(shortcuts.powershell, ['-NoProfile', '-NonInteractive', '-WindowStyle', 'Hidden', '-EncodedCommand', shortcuts.encode(command + '; if($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }')], { windowsHide: true, encoding: 'utf8', timeout: 10000, cwd: definition.workingDirectory || undefined });
      assert.equal(direct.status, 0, direct.stderr);
      assert.equal(existsSync(marker), true, 'Direct encoded startup command must run');
      rmSync(marker);
      shortcuts.execute('Start-Process -FilePath ' + shortcuts.quote(target) + ' -WindowStyle Hidden');
      const deadline = Date.now() + 10000;
      while (!existsSync(marker) && Date.now() < deadline) await delay(50);
      assert.equal(existsSync(marker), true);
      assert.deepEqual(JSON.parse(readFileSync(marker, 'utf8')), ['ensure-start', ...settings.arguments()]);
      const original = readFileSync(target);
      shortcuts.write = () => { throw new Error('Synthetic policy denial'); };
      assert.throws(() => new AutostartInstaller(settings, entry + '.changed', process.execPath, shortcuts).install({ target, apply: true }), /Synthetic policy denial/);
      assert.deepEqual(readFileSync(target), original);
      assert.equal(existsSync(settings.databasePath), false);
      console.log('PASS Windows startup: real temporary shortcut launch, hidden flags, exact spaces/special-character args, failure preserves previous entry');
    } finally { rmSync(root, { recursive: true, force: true }); }
  };
}

await new AutostartTests().run();
