import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { GhostVaultRuntime, RuntimeEndpointFactory } from './service.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeClient } from './client.js';

class DrainTests {
  private endpoint: RuntimeEndpointFactory = () => ({ register: () => {}, close: async () => {} });

  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-drain-'));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: root, port });
    const client = new RuntimeClient(settings);
    const cancelled = new GhostVaultRuntime(settings, this.endpoint);
    const cancelledStart = cancelled.start();
    const cancelledClose = cancelled.close();
    await assert.rejects(cancelledStart, /cancelled/);
    await cancelledClose;
    assert.equal(await client.inspect(), undefined);
    const failed = new GhostVaultRuntime(settings, () => ({ register: () => { throw new Error('Synthetic startup error'); }, close: async () => {} }));
    await assert.rejects(failed.start(), /Synthetic startup error/);
    assert.equal(await client.inspect(), undefined);
    const runtime = new GhostVaultRuntime(settings, this.endpoint);
    let release: () => void = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let accepted: () => void = () => {};
    const requestStarted = new Promise<void>(resolve => { accepted = resolve; });
    const upstream = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      assert.ok(body.includes('$${<DRAIN_SECRET>}'));
      assert.equal(body.includes('synthetic-drain-value'), false);
      accepted();
      await held;
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '$${<DRAIN_SECRET>}' } }] }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    try {
      await runtime.start();
      runtime.getVault().setManualSecret('DRAIN_SECRET', 'synthetic-drain-value');
      const upstreamUrl = 'http://127.0.0.1:' + (upstream.address() as { port: number }).port;
      runtime.getServer().setUpstreamSettings({ chatBase: upstreamUrl, anthropicBase: upstreamUrl });
      const request = fetch(settings.url + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: 'synthetic-drain-value' }] }) });
      await requestStarted;
      const closing = runtime.close();
      assert.equal((await client.inspect())?.identity.state, 'stopping');
      const blocked = await fetch(settings.url + '/v1/chat/completions', { method: 'POST' });
      assert.equal(blocked.status, 503);
      const competitor = new GhostVaultRuntime(settings, this.endpoint);
      await assert.rejects(competitor.start(), { code: 'EADDRINUSE' });
      release();
      const response = await request;
      assert.ok((await response.text()).includes('synthetic-drain-value'));
      await closing;
      const replacement = new GhostVaultRuntime(settings, this.endpoint);
      await replacement.start();
      assert.equal(replacement.getVault().getManualSecrets()[0].key, 'DRAIN_SECRET');
      await replacement.close();
      console.log('PASS drain: failed-start cleanup, active proxy completion, held port until DB close, new-work rejection, persisted value');
    } finally {
      release();
      await runtime.close();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  };
}

await new DrainTests().run();
