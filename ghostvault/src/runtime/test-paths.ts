import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { RuntimeSettings } from './settings.js';
import { RuntimeLauncher } from './launcher.js';

const stage = process.argv[2];
const Settings = stage ? (await import(pathToFileURL(path.join(stage, 'dist/runtime/settings.js')).href)).RuntimeSettings as typeof RuntimeSettings : RuntimeSettings;
const Launcher = stage ? (await import(pathToFileURL(path.join(stage, 'dist/runtime/launcher.js')).href)).RuntimeLauncher as typeof RuntimeLauncher : RuntimeLauncher;

class RuntimePathTests {
  public run = async (): Promise<void> => {
    if (process.platform !== 'win32') { console.log('SKIP Windows first-start path aliases on this platform'); return; }
    const root = realpathSync.native(mkdtempSync(path.join(os.tmpdir(), 'ghostvault-paths-')));
    const launchers: RuntimeLauncher[] = [];
    try {
      for (const explicitDatabase of [false, true]) {
        const probe = createServer();
        await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
        const port = (probe.address() as { port: number }).port;
        await new Promise<void>(resolve => probe.close(() => resolve()));
        const dataA = path.join(root, explicitDatabase ? 'ExplicitDb' : 'CaseFirstStart');
        const dataB = path.join(root, explicitDatabase ? 'explicitdb' : 'casefirststart');
        const databaseA = explicitDatabase ? path.join(root, 'DatabaseParent', 'CaseVault.db') : undefined;
        const databaseB = explicitDatabase ? path.join(root, 'databaseparent', 'casevault.db') : undefined;
        const settingsA = new Settings({ dataDir: dataA, databasePath: databaseA, port });
        const settingsB = new Settings({ dataDir: dataB, databasePath: databaseB, port });
        assert.equal(existsSync(dataA), false);
        assert.equal(existsSync(dataB), false);
        const first = new Launcher(settingsA);
        const second = new Launcher(settingsB);
        launchers.push(first, second);
        const results = await Promise.allSettled([first.ensure(), second.ensure()]);
        for (const result of results) assert.equal(result.status, 'fulfilled', result.status === 'rejected' ? String(result.reason) : '');
        assert.equal((await first.status())?.instanceId, (await second.status())?.instanceId);
        assert.equal(realpathSync.native(settingsA.databasePath), realpathSync.native(settingsB.databasePath));
        const other = new Settings({ dataDir: settingsA.dataDir, databasePath: path.join(root, 'DifferentVault.db'), port });
        await assert.rejects(new Launcher(other).ensure(), /Port already in use/);
        assert.equal(existsSync(other.databasePath), false);
        await second.stop();
      }
      console.log('PASS Windows paths: concurrently preconstructed missing data-directory and explicit DB case aliases converge without pre-bind side effects');
    } finally {
      await Promise.allSettled(launchers.map(launcher => launcher.stop()));
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

await new RuntimePathTests().run();
