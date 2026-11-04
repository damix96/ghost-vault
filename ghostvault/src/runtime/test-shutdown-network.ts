import assert from 'node:assert/strict';
import { createServer, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { RuntimeSettings } from './settings.js';
import { RuntimeLauncher } from './launcher.js';

type NetworkMode = 'headers' | 'body' | 'sse' | 'fragment' | 'normal';
type StopMode = 'stop' | 'force' | 'concurrent' | 'disconnect';

class ShutdownNetworkTests {
  private scenario = async (mode: NetworkMode, action: StopMode): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-shutdown-'));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: root, port, startupTimeoutMs: 10000 });
    const launcher = new RuntimeLauncher(settings);
    const controller = new AbortController();
    let accepted: () => void = () => {};
    const started = new Promise<void>(resolve => { accepted = resolve; });
    let upstreamClosed = false;
    let activeResponse: ServerResponse | undefined;
    let respondNormally = mode === 'normal';
    let upstreamBody = '';
    const upstream = createServer(async (request, response) => {
      upstreamBody = '';
      for await (const chunk of request) upstreamBody += chunk;
      activeResponse = response;
      response.once('close', () => { upstreamClosed = true; });
      if (respondNormally) {
        accepted();
        await delay(250);
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ choices: [{ message: { content: '$${<SHUTDOWN_VALUE>}' } }] }));
        return;
      }
      if (mode === 'body') {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.write('{"choices":[{"message":{"content":"unfinished');
      }
      if (mode === 'sse' || mode === 'fragment') {
        response.writeHead(200, { 'content-type': 'text/event-stream' });
        response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: mode === 'fragment' ? '$${<SHUTDOWN_' : 'synthetic stream' } }] }) + '\n\n');
        const heartbeat = setInterval(() => response.write(': synthetic heartbeat\n\n'), 100);
        response.once('close', () => clearInterval(heartbeat));
      }
      accepted();
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    let transfer: Promise<{ complete: boolean; status: number; body: string }> | undefined;
    const emergency = setTimeout(() => controller.abort(), 25000);
    try {
      const first = await launcher.ensure();
      const route = await fetch(settings.url + '/api/routes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'Stalled synthetic upstream', prefix: 'stalled', upstreamUrl: 'http://127.0.0.1:' + (upstream.address() as { port: number }).port }) });
      assert.equal(route.status, 201);
      const secret = await fetch(settings.url + '/api/vault/secret', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ key: 'SHUTDOWN_VALUE', realValue: 'synthetic-shutdown-value' }) });
      assert.ok(secret.ok);
      transfer = fetch(settings.url + '/stalled/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: 'synthetic-shutdown-value' }], stream: mode === 'sse' || mode === 'fragment' }), signal: controller.signal }).then(async response => ({ complete: true, status: response.status, body: await response.text() })).catch(() => ({ complete: false, status: 0, body: '' }));
      await started;
      assert.ok(upstreamBody.includes('$${<SHUTDOWN_VALUE>}'));
      const stoppedAt = Date.now();
      if (action === 'disconnect') { controller.abort(); await transfer; }
      if (action === 'force' || action === 'concurrent') {
        const results = await Promise.all([launcher.ensure(true), ...(action === 'concurrent' ? [launcher.stop(), launcher.stop()] : [])]);
        assert.notEqual((results[0] as { instanceId: string }).instanceId, first.instanceId);
      } else {
        assert.equal(await launcher.stop(), true);
        assert.equal(await launcher.status(), undefined);
        assert.notEqual((await launcher.ensure()).instanceId, first.instanceId);
      }
      const elapsed = Date.now() - stoppedAt;
      assert.ok(elapsed < 10000);
      const result = await transfer;
      assert.equal(upstreamClosed, true);
      assert.equal(controller.signal.aborted, action === 'disconnect');
      if (mode === 'normal') {
        assert.ok(elapsed < 4000);
        assert.equal(result.status, 200);
        assert.ok(result.body.includes('synthetic-shutdown-value'));
      } else {
        assert.equal(result.complete, false);
        assert.ok(action === 'disconnect' ? elapsed < 4000 : elapsed >= 4800);
      }
      respondNormally = true;
      const restored = await fetch(settings.url + '/stalled/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(restored.status, 200);
      assert.ok((await restored.text()).includes('synthetic-shutdown-value'));
      console.log('PASS shutdown ' + mode + '/' + action + ': ' + elapsed + 'ms, response semantics and persisted DB restart');
    } finally {
      clearTimeout(emergency);
      controller.abort();
      activeResponse?.destroy();
      await transfer;
      await launcher.stop().catch(() => {});
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };

  public run = async (): Promise<void> => {
    for (const mode of ['headers', 'body', 'sse', 'fragment'] as const) for (const action of ['stop', 'force'] as const) await this.scenario(mode, action);
    await this.scenario('sse', 'concurrent');
    await this.scenario('sse', 'disconnect');
    await this.scenario('normal', 'stop');
  };
}

await new ShutdownNetworkTests().run();
