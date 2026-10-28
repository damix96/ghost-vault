import Fastify, { FastifyInstance } from 'fastify';
import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';
import { HookManager } from './hooks/manager.js';

export class TelemetryTestRunner {
  private mockPort = 8793;
  private proxyPort = 8792;
  private mockApp: FastifyInstance = Fastify({ logger: false });
  private vault = new VaultStore();
  private hookManager = new HookManager();
  private proxyServer: GhostProxyServer;

  constructor() {
    this.proxyServer = new GhostProxyServer(
      this.vault,
      { port: this.proxyPort, targetApiBase: 'http://127.0.0.1:' + this.mockPort },
      this.hookManager
    );
  }

  private setupMock = (): void => {
    this.mockApp.post('/v1/chat/completions', async (req, reply) => {
      const body = req.body as any;
      return reply.send({ id: 'cmpl-123', choices: [{ message: { content: 'Echo ' + body.messages[0].content } }] });
    });
  };

  public run = async (): Promise<void> => {
    this.setupMock();
    await this.mockApp.listen({ port: this.mockPort, host: '127.0.0.1' });
    await this.proxyServer.listen();

    const baseUrl = 'http://127.0.0.1:' + this.proxyPort;

    const initialCtxRes = await fetch(baseUrl + '/api/hooks/context');
    const initialCtxJson = (await initialCtxRes.json()) as any;
    if (!initialCtxJson.empty) throw new Error('Expected empty context before requests');

    this.vault.setManualSecret('TELEMETRY_KEY', 'telemetry_secret_val_999');

    const abortCtrl = new AbortController();
    const sseResPromise = fetch(baseUrl + '/api/events', { signal: abortCtrl.signal }).catch(() => null);

    const triggerRes = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Ping telemetry_secret_val_999' }] }),
    });
    if (!triggerRes.ok) throw new Error('Trigger request failed');

    const contextRes = await fetch(baseUrl + '/api/hooks/context');
    const contextJson = (await contextRes.json()) as any;
    if (!contextJson.request || !contextJson.response || contextJson.interceptedSecrets.length === 0) {
      throw new Error('lastTransactionContext verification failed: ' + JSON.stringify(contextJson));
    }
    if (contextJson.interceptedSecrets[0].key !== 'TELEMETRY_KEY') {
      throw new Error('Intercepted secret key mismatch');
    }

    const historyRes = await fetch(baseUrl + '/api/history');
    const historyJson = (await historyRes.json()) as any[];
    if (!Array.isArray(historyJson) || historyJson.length === 0 || !historyJson[0].id) {
      throw new Error('GET /api/history verification failed: ' + JSON.stringify(historyJson));
    }

    const firstTxId = historyJson[0].id;
    const contextByIdRes = await fetch(baseUrl + '/api/hooks/context?id=' + firstTxId);
    const contextByIdJson = (await contextByIdRes.json()) as any;
    if (contextByIdJson.id !== firstTxId) {
      throw new Error('GET /api/hooks/context?id= mismatch: ' + JSON.stringify(contextByIdJson));
    }

    const notFoundRes = await fetch(baseUrl + '/api/hooks/context?id=non_existent_tx');
    const notFoundJson = (await notFoundRes.json()) as any;
    if (!notFoundJson.empty) {
      throw new Error('Expected empty true for unknown tx id: ' + JSON.stringify(notFoundJson));
    }

    const pingRes = await fetch(baseUrl + '/api/test-ping', { method: 'POST' });
    const pingJson = (await pingRes.json()) as any;
    if (!pingJson.success || !pingJson.transaction?.id) {
      throw new Error('POST /api/test-ping failed: ' + JSON.stringify(pingJson));
    }

    const dryRunReq1 = await fetch(baseUrl + '/api/hooks/test-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'beforeOutboundRequest',
        hookCode: "ctx => ({ ...ctx, headers: { ...ctx.headers, 'x-telemetry-test': 'ok' } })",
      }),
    });
    const dryRunJson1 = (await dryRunReq1.json()) as any;
    if (!dryRunJson1.success || dryRunJson1.output?.headers?.['x-telemetry-test'] !== 'ok') {
      throw new Error('Dry run beforeOutboundRequest failed: ' + JSON.stringify(dryRunJson1));
    }

    const dryRunReq2 = await fetch(baseUrl + '/api/hooks/test-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'onStreamChunk',
        hookCode: "(chunk, ctx) => chunk + '<!--tested-->'",
      }),
    });
    const dryRunJson2 = (await dryRunReq2.json()) as any;
    if (!dryRunJson2.success || !dryRunJson2.output?.includes('<!--tested-->')) {
      throw new Error('Dry run onStreamChunk failed: ' + JSON.stringify(dryRunJson2));
    }

    const dryRunReq3 = await fetch(baseUrl + '/api/hooks/test-run', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stage: 'beforeOutboundRequest',
        hookCode: "ctx => { throw new Error('deliberate_hook_error'); }",
      }),
    });
    const dryRunJson3 = (await dryRunReq3.json()) as any;
    if (dryRunJson3.success || !dryRunJson3.error?.includes('deliberate_hook_error')) {
      throw new Error('Dry run error handling failed: ' + JSON.stringify(dryRunJson3));
    }

    abortCtrl.abort();
    await this.proxyServer.close();
    await this.mockApp.close();
    console.log('All telemetry and hook sandbox tests passed successfully!');
  };
}

new TelemetryTestRunner().run();
