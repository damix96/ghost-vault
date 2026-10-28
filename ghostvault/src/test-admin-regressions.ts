import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import { GhostProxyServer } from './proxy/server.js';
import { RouteRegistry } from './proxy/route-registry.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { TransactionRecord } from './telemetry/types.js';

class AdminRegressionTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private upstream = Fastify();
  private proxy = new GhostProxyServer(this.vault, { port: 0 });
  private releaseLate?: () => void;
  private lateStarted?: () => void;
  private observedHostOrigin: { host?: string; origin?: string } = {};

  private transaction = (id: string, sessionId: string, text: string): TransactionRecord => ({
    id,
    sessionId,
    targetProvider: 'OpenCode',
    targetUrl: 'http://127.0.0.1/mock/v1/chat/completions',
    request: { method: 'POST', url: '/mock/v1/chat/completions', headers: {}, body: { messages: [{ role: 'user', content: text }] }, client: 'OpenCode' },
    response: { status: 200, headers: { 'content-type': 'application/json' }, body: { choices: [{ message: { role: 'assistant', content: 'ok' } }] }, isStream: false, client: 'OpenCode' },
    interceptedSecrets: [],
    timestamp: new Date().toISOString(),
    maskedPrompt: text,
  });

  private requestWithHost = (base: string, origin?: string): Promise<number> => new Promise((resolve, reject) => {
    const address = new URL(base);
    const request = httpRequest({ hostname: address.hostname, port: Number(address.port), path: '/api/vault', headers: { host: 'audit.invalid', ...(origin ? { origin } : {}) } }, response => {
      response.resume();
      resolve(response.statusCode || 0);
    });
    request.on('error', reject);
    request.end();
  });

  private foreignOriginGuard = async (base: string): Promise<void> => {
    const foreign = { origin: 'https://audit.invalid' };
    const sameOrigin = new URL(base).origin;
    assert.equal((await fetch(base + '/api/vault', { headers: { origin: sameOrigin } })).status, 200);
    assert.equal((await fetch(base + '/api/vault')).status, 200);
    assert.equal((await fetch(base + '/api/vault', { headers: { origin: 'null' } })).status, 403);
    assert.equal((await fetch(base + '/api/vault', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/history', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/sessions', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/hooks/context', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/export', { headers: foreign })).status, 403);
    assert.equal((await fetch(base + '/api/workspace', { headers: foreign })).status, 403);
    const spoofedHost = await this.requestWithHost(base, sameOrigin);
    const injectedSpoof = await (this.proxy as any).app.inject({ url: '/api/vault', headers: { origin: sameOrigin, host: 'audit.invalid' } });
    assert.equal(spoofedHost, 403, JSON.stringify({ observed: this.observedHostOrigin, injectStatus: injectedSpoof.statusCode }));
    assert.equal(injectedSpoof.statusCode, 403);
    assert.equal(await this.requestWithHost(base), 403);
    const before = this.vault.getManualSecrets().length;
    const mutation = await fetch(base + '/api/vault/secret', { method: 'POST', headers: { ...foreign, 'content-type': 'application/json' }, body: JSON.stringify({ key: 'FOREIGN_ORIGIN', realValue: 'synthetic-blocked-value' }) });
    assert.equal(mutation.status, 403);
    assert.equal(this.vault.getManualSecrets().length, before);
    const options = await fetch(base + '/api/vault/secret', { method: 'OPTIONS', headers: { ...foreign, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type' } });
    assert.equal(options.status, 403);
    const eventsOptions = await fetch(base + '/api/events', { method: 'OPTIONS', headers: { ...foreign, 'access-control-request-method': 'GET' } });
    assert.equal(eventsOptions.status, 403);
    const eventsAbort = new AbortController();
    const events = await fetch(base + '/api/events', { headers: foreign, signal: eventsAbort.signal });
    const eventsStatus = events.status;
    eventsAbort.abort();
    assert.equal(eventsStatus, 403);
    (globalThis as any).__ghostvaultForeignHookRan = 0;
    try {
      const hook = await fetch(base + '/api/hooks/test-run', { method: 'POST', headers: { ...foreign, 'content-type': 'application/json' }, body: JSON.stringify({ stage: 'beforeOutboundRequest', hookCode: '() => { globalThis.__ghostvaultForeignHookRan = 1; return { safe: true }; }' }) });
      assert.equal(hook.status, 403);
      assert.equal((globalThis as any).__ghostvaultForeignHookRan, 0);
    } finally { delete (globalThis as any).__ghostvaultForeignHookRan; }
  };

  private cliHeadersAndSessionDeletion = async (base: string): Promise<void> => {
    const modelResponse = await fetch(base + '/admin-local/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer synthetic-cli-auth', 'x-preserved-header': 'preserved-cli-header', 'x-session-id': 'session-cli' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'no Origin CLI request' }] }) });
    assert.equal(modelResponse.status, 200);
    assert.equal((await modelResponse.json() as any).choices[0].message.content, 'model-ok');
    assert.equal(this.upstreamReceived.authorization, 'Bearer synthetic-cli-auth');
    assert.equal(this.upstreamReceived['x-preserved-header'], 'preserved-cli-header');

    this.vault.setManualSecret('ADMIN_RULE_KEEP', 'synthetic-rule-value');
    this.vault.setManualSecret('ADMIN_DELETE_CLIENT', 'synthetic-delete-client-value');
    const { ApiClient } = await import(new URL('../frontend/api.js', import.meta.url).href) as { ApiClient: new (baseUrl: string) => { deleteSecret: (key: string) => Promise<{ success: boolean }>; getVault: () => Promise<{ manual: Array<{ key: string }> }> } };
    const apiClient = new ApiClient(base);
    assert.deepEqual(await apiClient.deleteSecret('ADMIN_DELETE_CLIENT'), { success: true });
    assert.equal((await apiClient.getVault()).manual.some(secret => secret.key === 'ADMIN_DELETE_CLIENT'), false);
    this.proxy.recordTransaction(this.transaction('tx-session-a', 'session-a', 'a'));
    this.proxy.recordTransaction(this.transaction('tx-session-b', 'session-b', 'b'));
    const deleted = await fetch(base + '/api/sessions/session-b', { method: 'DELETE' });
    assert.equal(deleted.status, 200);
    const history = await (await fetch(base + '/api/history')).json() as any[];
    assert.equal(history.some(transaction => transaction.id === 'tx-session-b'), false);
    assert.equal(history.some(transaction => transaction.id === 'tx-session-a'), true);
    assert.equal((await (await fetch(base + '/api/sessions/session-b')).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/sessions/session-b/full')).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/sessions/session-a')).json() as any[]).length, 1);
    assert.equal((await (await fetch(base + '/api/hooks/context?id=tx-session-b')).json() as any).empty, true);
    assert.equal((await (await fetch(base + '/api/hooks/context')).json() as any).id, 'tx-session-a');
    const sessions = await (await fetch(base + '/api/sessions')).json() as any[];
    assert.deepEqual(sessions.map(session => session.id).sort(), ['session-a', 'session-cli']);
    assert.equal(this.vault.getManualSecrets().some(secret => secret.key === 'ADMIN_RULE_KEEP'), true);
    await this.verifyLateTransactionDeletion(base);
    const clear = await fetch(base + '/api/sessions', { method: 'DELETE' });
    assert.deepEqual(await clear.json(), { success: true, count: 0 });
    assert.equal((await (await fetch(base + '/api/sessions')).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/history')).json() as any[]).length, 0);
    assert.equal((await (await fetch(base + '/api/hooks/context')).json() as any).empty, true);
    assert.equal(this.vault.getManualSecrets().some(secret => secret.key === 'ADMIN_RULE_KEEP'), true);
  };

  private upstreamReceived: Record<string, string> = {};

  private verifyLateTransactionDeletion = async (base: string): Promise<void> => {
    const started = new Promise<void>(resolve => { this.lateStarted = resolve; });
    const responsePromise = fetch(base + '/admin-local/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': 'session-late' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'inflight local request' }] }) });
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([started, new Promise<void>((_, reject) => { timer = setTimeout(() => reject(new Error('Late transaction request did not reach upstream')), 5000); })]);
    if (timer) clearTimeout(timer);
    assert.equal((await fetch(base + '/api/sessions/session-late', { method: 'DELETE' })).status, 200);
    this.releaseLate?.();
    const response = await responsePromise;
    assert.equal(response.status, 200);
    assert.equal((await (await fetch(base + '/api/sessions')).json() as any[]).some(session => session.id === 'session-late'), false);
    assert.equal((await (await fetch(base + '/api/history')).json() as any[]).some(transaction => transaction.session_id === 'session-late'), false);
    assert.equal(this.proxy.getTransactionHistory().some(transaction => transaction.sessionId === 'session-late'), false);
  };

  public run = async (): Promise<void> => {
    this.upstream.post('/v1/chat/completions', async (request, reply) => {
      this.upstreamReceived = { authorization: String(request.headers.authorization || ''), 'x-preserved-header': String(request.headers['x-preserved-header'] || '') };
      if (request.headers['x-session-id'] === 'session-late') {
        await new Promise<void>(resolve => { this.releaseLate = resolve; this.lateStarted?.(); });
      }
      return reply.send({ choices: [{ message: { role: 'assistant', content: 'model-ok' } }] });
    });
    (this.proxy as any).app.server.on('request', (request: { url?: string; headers: Record<string, string | string[] | undefined> }) => {
      if (request.url === '/api/vault') this.observedHostOrigin = { host: String(request.headers.host || ''), origin: String(request.headers.origin || '') };
    });
    const upstreamUrl = await this.upstream.listen({ port: 0, host: '127.0.0.1' });
    new RouteRegistry(this.db).createCustomRoute({ name: 'Admin regression mock', prefix: 'admin-local', upstreamUrl });
    const base = await this.proxy.listen();
    try {
      this.vault.setManualSecret('ADMIN_RULE_KEEP', 'synthetic-rule-value');
      await this.foreignOriginGuard(base);
      await this.cliHeadersAndSessionDeletion(base);
      console.log('Admin regressions passed: origin/host guard, CLI route headers, history/session cleanup, late transaction tombstone, and rule preservation.');
    } finally {
      await this.proxy.close();
      await this.upstream.close();
      this.db.close();
    }
  };
}

new AdminRegressionTests().run().catch(error => { console.error(error); process.exitCode = 1; });
