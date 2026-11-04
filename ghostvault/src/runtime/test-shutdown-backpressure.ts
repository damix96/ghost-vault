import assert from 'node:assert/strict';
import { createServer, ServerResponse } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { GhostVaultRuntime } from './service.js';
import { RuntimeSettings } from './settings.js';

class ShutdownBackpressureTests {
  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-backpressure-'));
    const probe = createServer();
    await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = (probe.address() as { port: number }).port;
    await new Promise<void>(resolve => probe.close(() => resolve()));
    let blocked = (): void => {};
    const waiting = new Promise<void>(resolve => { blocked = resolve; });
    let downstream: ServerResponse | undefined;
    let endpointClosing: Promise<void> | undefined;
    const runtime = new GhostVaultRuntime(new RuntimeSettings({ dataDir: root, port }), app => ({ register: () => {
      app.addHook('onRequest', async (request, reply) => {
        if (!request.url.startsWith('/v1/')) return;
        downstream = reply.raw;
        const write = reply.raw.write.bind(reply.raw);
        reply.raw.write = ((...args: Parameters<typeof write>) => { write(...args); blocked(); return false; }) as typeof write;
      });
    }, close: async () => { endpointClosing ??= delay(5000); await endpointClosing; } }));
    const upstream = createServer(async (request, response) => {
      for await (const _chunk of request) {}
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: {"synthetic":"backpressure"}\n\n');
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const controller = new AbortController();
    let transfer: Promise<unknown> | undefined;
    try {
      await runtime.start();
      const upstreamUrl = 'http://127.0.0.1:' + (upstream.address() as { port: number }).port;
      runtime.getServer().setUpstreamSettings({ chatBase: upstreamUrl });
      transfer = fetch(runtime.settings.url + '/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"stream":true}', signal: controller.signal }).then(response => response.text()).catch(() => {});
      await waiting;
      const start = Date.now();
      await runtime.close();
      assert.ok(Date.now() - start < 8000);
      assert.equal(controller.signal.aborted, false);
      await transfer;
      console.log('PASS backpressure: stalled drain canceled, endpoint/proxy grace shared, handler settled before DB close');
    } finally {
      controller.abort();
      downstream?.emit('drain');
      await transfer;
      await runtime.close();
      upstream.closeAllConnections();
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

await new ShutdownBackpressureTests().run();
