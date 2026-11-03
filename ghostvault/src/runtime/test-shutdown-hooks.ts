import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GhostVaultRuntime, RuntimeEndpointFactory } from './service.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeClient } from './client.js';
import { RuntimeDrainTimeout } from './deadline.js';

class ShutdownHookTests {
  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-hook-drain-'));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: root, port });
    const endpoint: RuntimeEndpointFactory = () => ({ register: () => {}, close: async () => {} });
    const runtime = new GhostVaultRuntime(settings, endpoint);
    let release = (): void => {};
    let entered = (): void => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    let hookFinished = false;
    let databaseCloses = 0;
    const controller = new AbortController();
    let request: Promise<unknown> | undefined;
    try {
      await runtime.start();
      const database = runtime.getVault().getDatabase();
      const closeDatabase = database.close;
      database.close = () => { assert.equal(hookFinished, true); closeDatabase(); databaseCloses++; };
      runtime.getServer().getHookManager().registerHook({ beforeOutboundRequest: async () => {
        entered();
        await held;
        assert.ok(Array.isArray(database.getAllRoutes()));
        hookFinished = true;
      } });
      request = fetch(settings.url + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}', signal: controller.signal }).then(response => response.text()).catch(() => {});
      await started;
      const start = Date.now();
      await assert.rejects(runtime.close(), RuntimeDrainTimeout);
      assert.ok(Date.now() - start >= 6500 && Date.now() - start < 9500);
      assert.equal(databaseCloses, 0);
      assert.equal(hookFinished, false);
      const client = new RuntimeClient(settings);
      const verified = (await client.inspect())!;
      assert.equal(verified.identity.state, 'stopping');
      assert.equal((await fetch(settings.url)).status, 503);
      const contender = new GhostVaultRuntime(settings, endpoint);
      await assert.rejects(contender.start(), { code: 'EADDRINUSE' });
      release();
      await client.shutdown(verified);
      await runtime.close();
      assert.equal(databaseCloses, 1);
      await runtime.close();
      assert.equal(databaseCloses, 1);
      const replacement = new GhostVaultRuntime(settings, endpoint);
      await replacement.start();
      await replacement.close();
      console.log('PASS hook drain: bounded failure retains DB/port, late hook DB access safe, authenticated retry closes exactly once');
    } finally {
      release();
      controller.abort();
      await request;
      await runtime.close();
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

await new ShutdownHookTests().run();
