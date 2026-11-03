import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, existsSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RuntimeSettings } from './settings.js';
import { RuntimeCredentials } from './credentials.js';
import { RuntimeIdentitySchema, RuntimeProof } from './identity.js';
import { RuntimeListener } from './listener.js';
import { RuntimeClient } from './client.js';

class ListenerTests {
  private directory = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-listener-'));

  public run = async (): Promise<void> => {
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: this.directory, port });
    const credentials = new RuntimeCredentials(settings);
    const identity = RuntimeIdentitySchema.parse({ product: 'ghostvault', runtimeProtocol: 1, version: settings.version, instanceId: randomUUID(), startedAt: Date.now(), pid: process.pid, port, state: 'starting' });
    const token = RuntimeProof.token();
    let shutdowns = 0;
    const listener = new RuntimeListener(settings, identity, token, async () => { shutdowns++; });
    const competitor = new RuntimeListener(settings, identity, token, async () => {});
    try {
      await listener.claim();
      await assert.rejects(competitor.claim(), { code: 'EADDRINUSE' });
      assert.equal(existsSync(settings.databasePath), false);
      await credentials.publish({ instanceId: identity.instanceId, controlToken: token, port, databasePath: settings.databasePath });
      const client = new RuntimeClient(settings);
      assert.equal((await client.inspect())?.identity.state, 'starting');
      const anonymous = await fetch(settings.url + '/.ghostvault/shutdown', { method: 'POST' });
      assert.equal(anonymous.status, 403);
      const wrongInstance = await fetch(settings.url + '/.ghostvault/shutdown', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-ghostvault-instance': randomUUID() } });
      assert.equal(wrongInstance.status, 403);
      const origin = await fetch(settings.url + '/.ghostvault/shutdown', { method: 'POST', headers: { authorization: 'Bearer ' + token, 'x-ghostvault-instance': identity.instanceId, origin: 'https://foreign.invalid' } });
      assert.equal(origin.status, 403);
      assert.equal(shutdowns, 0);
      listener.route((_request, response) => { response.end('ready'); });
      identity.state = 'ready';
      assert.equal(await (await fetch(settings.url)).text(), 'ready');
      await client.shutdown((await client.inspect())!);
      assert.equal(shutdowns, 1);
      assert.equal((await fetch(settings.url)).status, 503);
      assert.equal(RuntimeProof.equal('é'.repeat(64), token), false);
      await listener.close();
      assert.equal(await client.inspect(), undefined);
      console.log('PASS listener: atomic bind, private identity, shutdown authorization, stopping gate');
    } finally { await listener.close(); rmSync(this.directory, { recursive: true, force: true }); }
  };
}

await new ListenerTests().run();
