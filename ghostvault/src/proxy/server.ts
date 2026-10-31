import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import { VaultStore } from '../vault/store.js';
import { GhostVaultConfig, SecretEntry } from '../types/index.js';
import { StreamRelay } from './stream-relay.js';
import { HookManager } from '../hooks/manager.js';
import { RequestContext, ResponseContext } from '../hooks/types.js';
import { EventBroadcaster } from '../telemetry/event-broadcaster.js';
import { HookSandbox } from '../telemetry/hook-sandbox.js';
import { TransactionRecord, SecretInterception } from '../telemetry/types.js';
import { PatternEngine } from '../vault/pattern-engine.js';
import { DashboardApi } from './dashboard-api.js';
import { SessionResolver } from './session-resolver.js';
import { RouteRegistry } from './route-registry.js';
import { PayloadCodec } from '../protocols/payload-codec.js';
import { TextReplacer } from '../vault/text-replacer.js';
import { UpstreamClient } from './upstream-client.js';
import { AdminAccess } from './admin-access.js';
import { RuntimeSessions } from './runtime-sessions.js';

const publicPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../public');

export interface LastCallInfo {
  direction: 'outbound' | 'inbound';
  client: string;
  timestamp: string;
  rawUrl: string;
  alias: string;
  key: string;
}

export class GhostProxyServer {
  private app: FastifyInstance;
  private vault: VaultStore;
  private patternEngine: PatternEngine;
  private hookManager: HookManager;
  private eventBroadcaster = new EventBroadcaster();
  private hookSandbox: HookSandbox;
  private dashboardApi: DashboardApi;
  private sessionResolver = new SessionResolver();
  private payloadCodec = new PayloadCodec();
  private upstreamClient = new UpstreamClient();
  private runtime = new RuntimeSessions(undefined, (sessionId, reason) => this.eventBroadcaster.broadcast({ id: crypto.randomUUID(), type: 'session_removed', timestamp: new Date().toISOString(), client: '', details: { sessionId, reason } }));
  private config: GhostVaultConfig;
  private startTime = Date.now();

  constructor(vault?: VaultStore, config?: Partial<GhostVaultConfig>, hookManager?: HookManager) {
    this.vault = vault ?? new VaultStore();
    this.patternEngine = new PatternEngine(this.vault.getDatabase());
    this.hookManager = hookManager ?? new HookManager();
    this.hookSandbox = new HookSandbox(this.hookManager);
    this.config = { port: 8765, host: '127.0.0.1', targetApiBase: 'https://api.anthropic.com', confirmationMode: 'auto', storagePath: '', maxBufferWindowChars: 64, ...config };
    if (this.config.hooksDir) this.hookManager.loadHooksFromDir(this.config.hooksDir);
    this.app = Fastify({ logger: false });
    const adminAccess = new AdminAccess(this.config.host);
    adminAccess.install(this.app);
    this.app.register(cors, { delegator: adminAccess.cors });
    this.app.register(fastifyStatic, { root: publicPath, prefix: '/', wildcard: false, index: false });
    this.dashboardApi = new DashboardApi(
      this.app, this.vault, this.patternEngine, this.hookManager, this.eventBroadcaster, this.hookSandbox,
      () => this.startTime, this.getLastCall, this.getLastTransactionContext,
      this.getTransactionHistory, this.getTransactionById,
      record => this.recordTransaction(record),
      (direction, client, secret) => this.recordInterception(direction, client, secret),
      () => this.getUpstreamSettings(),
      (s: { chatBase?: string; anthropicBase?: string }) => this.setUpstreamSettings(s), this.config.demoMode,
      this.clearTransactionHistory, this.config, this.runtime
    );
    this.dashboardApi.registerRoutes();
    this.app.route({ method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'], url: '/*', handler: this.handleUniversalProxy });
  }

  public getApp = (): FastifyInstance => this.app;
  public getVault = (): VaultStore => this.vault;
  public getPatternEngine = (): PatternEngine => this.patternEngine;
  public getHookManager = (): HookManager => this.hookManager;
  public getEventBroadcaster = (): EventBroadcaster => this.eventBroadcaster;
  public getRuntimeSessions = (): RuntimeSessions => this.runtime;
  public getLastCall = (): LastCallInfo | null => {
    const record = this.getLastTransactionContext();
    const secret = record?.interceptedSecrets.at(-1);
    return record && secret ? { direction: secret.direction, client: record.request.client, timestamp: record.timestamp, rawUrl: secret.realValue, alias: secret.alias, key: secret.key } : null;
  };
  public getLastTransactionContext = (): TransactionRecord | null => this.runtime.records()[0] || null;
  public getTransactionHistory = (): TransactionRecord[] => this.runtime.records();
  public getTransactionById = (id: string): TransactionRecord | undefined => this.runtime.find(id);
  public getUpstreamSettings = () => new RouteRegistry(this.vault.getDatabase()).getSettings();
  public setUpstreamSettings = (settings: Record<string, string | undefined>) => new RouteRegistry(this.vault.getDatabase()).updateSettings(settings);
  public listen = async (): Promise<string> =>
    this.app.listen({ port: this.config.port, host: this.config.host });
  public close = async (): Promise<void> => { this.eventBroadcaster.close(); await this.app.close(); this.runtime.clear(); };

  public clearTransactionHistory = (sessionId?: string): void => {
    this.runtime.clear(sessionId);
    if (sessionId === undefined) this.eventBroadcaster.broadcast({ id: crypto.randomUUID(), type: 'sessions_cleared', timestamp: new Date().toISOString(), client: '', details: {} });
  };

  public recordTransaction = (record: TransactionRecord): void => {
    this.runtime.record(record);
    this.completed(record, true);
  };

  private completed = (record: TransactionRecord, latest: boolean): void => this.eventBroadcaster.broadcast({ id: record.id, type: 'transaction_completed', timestamp: record.timestamp, client: record.request.client, details: { sessionId: record.sessionId || record.id, transactionId: record.id, latest, status: record.response?.status, endpoint: record.request.url, targetUrl: record.targetUrl, latencyMs: record.latencyMs, secretCount: record.interceptedSecrets.length } });

  public executeTestPing = (): TransactionRecord => this.dashboardApi.executeTestPing();

  private recordInterception = (direction: 'outbound' | 'inbound', client: string, secret: SecretEntry): void => {
    this.eventBroadcaster.broadcast({
      id: crypto.randomUUID(),
      type: direction === 'outbound' ? 'outbound_masked' : 'inbound_unmasked',
      timestamp: new Date().toISOString(),
      client,
      details: { key: secret.key, alias: secret.alias, realValue: secret.realValue },
    });
  };

  private checkAndRecord = (text: string, client: string, intercepted: SecretInterception[], direction: 'outbound' | 'inbound'): void => {
    for (const s of this.vault.getAllActiveSecrets()) {
      const match = direction === 'outbound' ? TextReplacer.variants(s).some(value => text.includes(value)) : this.vault.getSecretRepresentations(s).some(form => text.includes(form.alias));
      if (match) {
        this.recordInterception(direction, client, s);
        intercepted.push({ key: s.key, alias: s.alias, realValue: s.realValue, representations: this.vault.getSecretRepresentations(s), count: 1, direction });
      }
    }
  };

  private handleUniversalProxy = async (req: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (req.url.startsWith('/api/')) { reply.status(404).send({ error: 'Unknown API endpoint' }); return; }

    const startPerf = performance.now();
    const staticCandidate = req.url === '/' ? 'index.html' : req.url.replace(/^\/+/, '');
    if (req.method === 'GET' && existsSync(path.join(publicPath, staticCandidate))) {
      return reply.sendFile(staticCandidate);
    }
    const pathname = req.url.split('?')[0];
    const routePrefixes = [...this.vault.getDatabase().getAllRoutes().map(route => route.prefix), 'zen'];
    const isProviderRoute = routePrefixes.some(prefix => pathname === '/' + prefix || pathname.startsWith('/' + prefix + '/'));
    if (!isProviderRoute && !/^\/v\d+(?:beta)?(?:\/|$)/.test(pathname)) {
      reply.status(404).send({ error: 'Unknown gateway route' });
      return;
    }

    const txId = crypto.randomUUID();
    const interceptedSecrets: SecretInterception[] = [];
    const userAgent = String(req.headers['user-agent'] || '');
    const clientName = req.url.includes('chat') ? 'OpenCode' : (userAgent.includes('Claude') ? 'Claude Code' : (userAgent.includes('Aider') ? 'Aider' : (userAgent.includes('Cursor') ? 'Cursor' : 'AI Client')));
    const sessionId = this.sessionResolver.resolveSessionId(req, clientName);
    const incomingUrl = req.url;
    const started = new Date().toISOString();
    const call = this.runtime.begin({ id: txId, sessionId, timestamp: started, request: { method: req.method, url: incomingUrl, headers: req.headers as Record<string, string>, body: req.body, client: clientName }, interceptedSecrets: [] });
    const retain = call.current;
    let lastRecord: TransactionRecord | undefined;
    const record = (transaction: TransactionRecord): void => {
      lastRecord = { ...transaction, timestamp: started, request: { ...transaction.request, url: incomingUrl } };
      call.update(lastRecord);
    };
    this.eventBroadcaster.broadcast({ id: txId + '-start', type: 'request_started', timestamp: new Date().toISOString(), client: clientName, details: { sessionId, transactionId: txId, endpoint: req.url } });

    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower !== 'host' && lower !== 'content-length' && val !== undefined) headers[key] = Array.isArray(val) ? val[0] : val;
    }

    let reqCtx: RequestContext = { method: req.method, url: req.url, headers, body: req.body, client: clientName };
    try {
    reqCtx = await this.hookManager.runBeforeOutboundRequest(reqCtx);

    let inbound = this.vault.snapshot();
    let maskedBody: string | undefined = undefined;
    if (reqCtx.body !== undefined && reqCtx.body !== null) {
      const mapped = this.payloadCodec.request(reqCtx.body, reqCtx.url, text => {
        const remaining = this.vault.maskManualText(text).replace(/\$\$\{<[A-Z0-9_]+>\}/g, ' ');
        this.patternEngine.scanAndAutoDetect(remaining, (match, type, prefix) => this.vault.registerAutoDetectedSecret(match, type, prefix));
        if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'outbound');
        return this.vault.maskOutboundText(text);
      });
      maskedBody = typeof mapped === 'string' ? mapped : JSON.stringify(mapped);
      inbound = this.vault.snapshot();
      maskedBody = await this.hookManager.runAfterOutboundMask(maskedBody, reqCtx);
    }

    if (maskedBody !== undefined && !reqCtx.headers['content-type']) reqCtx.headers['content-type'] = 'application/json';

    record({ id: txId, sessionId, timestamp: started, request: reqCtx, maskedPrompt: maskedBody, interceptedSecrets });
    const upstream = this.getUpstreamSettings();
    const route = this.sessionResolver.resolveRoute(reqCtx.url, upstream, undefined, this.config.targetApiBase);
    reqCtx.url = route.forwardPath;
    const targetUrl = route.targetUrl;
    const targetProvider = route.targetProvider;
    const hasBody = reqCtx.method !== 'GET' && reqCtx.method !== 'HEAD' && maskedBody !== undefined;
    const disconnect = new AbortController();
    reply.raw.once('close', () => { if (!reply.raw.writableEnded) disconnect.abort(); });

    let upstreamRes: Response;
    try {
      upstreamRes = await this.upstreamClient.fetch(targetUrl, { method: reqCtx.method, headers: reqCtx.headers, body: hasBody ? maskedBody : undefined, signal: disconnect.signal });
    } catch (err: any) {
      const errCtx: ResponseContext = { status: reply.raw.destroyed ? 499 : 502, headers: {}, body: String(err?.message || err), isStream: false, client: clientName };
      record({ id: txId, sessionId, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: errCtx, interceptedSecrets, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - startPerf), maskedPrompt: maskedBody });
      reply.status(502).send({ error: 'Gateway upstream connection failed', details: String(err) });
      return;
    }

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text();
      const errHeaders: Record<string, string> = {};
      upstreamRes.headers.forEach((val, key) => { errHeaders[key] = val; });
      const errCtx: ResponseContext = { status: upstreamRes.status, headers: errHeaders, body: errText, isStream: false, client: clientName };
      record({ id: txId, sessionId, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: errCtx, interceptedSecrets, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - startPerf), maskedPrompt: maskedBody });
      reply.status(upstreamRes.status).header('content-type', upstreamRes.headers.get('content-type') || 'application/json').send(errText);
      return;
    }

    const contentType = upstreamRes.headers.get('content-type') || '';
    const isSse = contentType.includes('text/event-stream');
    const resHeaders: Record<string, string> = {};
    upstreamRes.headers.forEach((val, key) => { resHeaders[key] = val; });
    const resCtx: ResponseContext = { status: upstreamRes.status, headers: resHeaders, body: undefined, isStream: isSse, client: clientName };

    if (isSse) {
      const relay = new StreamRelay(inbound, this.hookManager, this.eventBroadcaster, this.config.maxBufferWindowChars);
      const { accumulatedText, sampleStreamChunk, totalChunks } = await relay.run(upstreamRes, reply, resCtx, { txId, sessionId, client: clientName }, text => { if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'inbound'); }, (body, sampleStreamChunk) => {
        if (!retain()) return false;
        record({ id: txId, sessionId, timestamp: started, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: { ...resCtx, body }, maskedPrompt: maskedBody, interceptedSecrets, sampleStreamChunk });
        return true;
      });
      record({ id: txId, sessionId, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: resCtx, sampleStreamChunk, sampleStreamChunkIndex: 0, interceptedSecrets, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - startPerf), maskedPrompt: maskedBody });
      await this.hookManager.runAfterStream({ totalChunks, accumulatedText, client: clientName });
      return;
    }

    const responseText = await upstreamRes.text();
    const processedRaw = await this.hookManager.runBeforeInboundResponse(responseText, resCtx);
    const unmask = (text: string): string => {
      if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'inbound');
      return inbound.unmaskInboundText(text);
    };
    let unmaskedResponse: string;
    try { unmaskedResponse = JSON.stringify(this.payloadCodec.response(JSON.parse(processedRaw), unmask)); }
    catch { unmaskedResponse = unmask(processedRaw); }
    const finalResponse = await this.hookManager.runAfterInboundUnmask(unmaskedResponse, resCtx);

    try {
      const parsedJson = JSON.parse(finalResponse);
      resCtx.body = parsedJson;
      reply.status(upstreamRes.status).send(parsedJson);
    } catch {
      resCtx.body = finalResponse;
      reply.status(upstreamRes.status).header('content-type', contentType || 'text/plain').send(finalResponse);
    }

    record({ id: txId, sessionId, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: resCtx, interceptedSecrets, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - startPerf), maskedPrompt: maskedBody });
    } catch (error) {
      record({ id: txId, sessionId, timestamp: started, request: reqCtx, interceptedSecrets, response: { status: reply.raw.destroyed ? 499 : Number((error as { statusCode?: number }).statusCode) || 500, headers: {}, body: { error: 'Gateway request failed' }, isStream: false, client: clientName }, latencyMs: Math.round(performance.now() - startPerf) });
      throw error;
    } finally {
      const latest = retain();
      call.end();
      if (lastRecord) this.completed(lastRecord, latest && Boolean(this.runtime.find(txId)));
    }
  };
}
