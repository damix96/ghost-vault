import assert from 'node:assert/strict';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RuntimeSettings } from './settings.js';
import { RuntimeLauncher } from './launcher.js';

class TimeoutTests {
  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-timeout-'));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: root, port, startupTimeoutMs: 1800 });
    const blocked = new RuntimeLauncher(settings, fileURLToPath(new URL('./test-stalled.js', import.meta.url)));
    const recovery = new RuntimeLauncher(new RuntimeSettings({ dataDir: root, port, startupTimeoutMs: 8000 }));
    try {
      const started = Date.now();
      await assert.rejects(blocked.ensure(), /startup timed out/);
      assert.ok(Date.now() - started < 5000);
      assert.equal(existsSync(settings.databasePath), true);
      assert.equal((await recovery.ensure()).state, 'ready');
      await recovery.stop();
      console.log('PASS startup deadline: stalled DB-owning child terminated, port/DB lock released, next runtime ready');
    } finally { await recovery.stop().catch(() => {}); rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }); }
  };
}

await new TimeoutTests().run();
