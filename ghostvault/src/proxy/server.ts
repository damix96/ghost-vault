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
import { RequestCapture } from './request-capture.js';
import { AdminAccess } from './admin-access.js';
import { HistoryRetention } from './history-retention.js';

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
  private requestCapture = new RequestCapture();
  private historyRetention = new HistoryRetention();
  private config: GhostVaultConfig;
  private startTime = Date.now();
  private lastCall: LastCallInfo | null = null;
  private lastTransactionContext: TransactionRecord | null = null;
  private transactionHistory: TransactionRecord[] = [];
  private activeSessionId = 'sess_' + Date.now().toString(36);

  constructor(vault?: VaultStore, config?: Partial<GhostVaultConfig>, hookManager?: HookManager) {
    this.vault = vault ?? new VaultStore();
    this.patternEngine = new PatternEngine(this.vault.getDatabase());
    this.hookManager = hookManager ?? new HookManager();
    this.hookSandbox = new HookSandbox(this.hookManager);
    this.config = { port: 8765, host: '127.0.0.1', targetApiBase: 'https://api.anthropic.com', confirmationMode: 'auto', storagePath: '', maxBufferWindowChars: 64, ...config };
    if (this.config.hooksDir) this.hookManager.loadHooksFromDir(this.config.hooksDir);
    this.app = Fastify({ logger: false });
    this.requestCapture.install(this.app);
    const adminAccess = new AdminAccess(this.config.host);
    adminAccess.install(this.app);
    this.app.register(cors, { delegator: adminAccess.cors });
    this.app.register(fastifyStatic, { root: publicPath, prefix: '/', wildcard: false, index: false });
    this.dashboardApi = new DashboardApi(
      this.app, this.vault, this.patternEngine, this.hookManager, this.eventBroadcaster, this.hookSandbox,
      () => this.startTime, () => this.lastCall, () => this.lastTransactionContext,
      () => this.transactionHistory, id => this.transactionHistory.find(tx => tx.id === id),
      record => this.recordTransaction(record),
      (direction, client, secret) => this.recordInterception(direction, client, secret),
      () => this.getUpstreamSettings(),
      (s: { chatBase?: string; anthropicBase?: string }) => this.setUpstreamSettings(s), this.config.demoMode,
      this.clearTransactionHistory, this.config
    );
    this.dashboardApi.registerRoutes();
    this.app.route({ method: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD'], url: '/*', handler: this.handleUniversalProxy });
  }

  public getApp = (): FastifyInstance => this.app;
  public getVault = (): VaultStore => this.vault;
  public getPatternEngine = (): PatternEngine => this.patternEngine;
  public getHookManager = (): HookManager => this.hookManager;
  public getEventBroadcaster = (): EventBroadcaster => this.eventBroadcaster;
  public getLastCall = (): LastCallInfo | null => this.lastCall;
  public getLastTransactionContext = (): TransactionRecord | null => this.lastTransactionContext;
  public getTransactionHistory = (): TransactionRecord[] => this.transactionHistory;
  public getTransactionById = (id: string): TransactionRecord | undefined =>
    this.transactionHistory.find(tx => tx.id === id);
  public getUpstreamSettings = () => new RouteRegistry(this.vault.getDatabase()).getSettings();
  public setUpstreamSettings = (settings: Record<string, string | undefined>) => new RouteRegistry(this.vault.getDatabase()).updateSettings(settings);
  public listen = async (): Promise<string> =>
    this.app.listen({ port: this.config.port, host: this.config.host });
  public close = async (): Promise<void> => { this.eventBroadcaster.close(); await this.app.close(); };

  public clearTransactionHistory = (sessionId?: string): void => {
    this.historyRetention.clear(sessionId);
    this.transactionHistory = sessionId === undefined ? [] : this.transactionHistory.filter(record => record.sessionId !== sessionId);
    this.lastTransactionContext = this.transactionHistory[0] || null;
    this.lastCall = null;
  };

  public recordTransaction = (record: TransactionRecord): void => {
    this.lastTransactionContext = record;
    this.transactionHistory.unshift(record);
    if (this.transactionHistory.length > 50) this.transactionHistory.pop();
    const promptText = typeof record.request.body === 'string' ? record.request.body : JSON.stringify(record.request.body ?? '');
    const modelResponse = typeof record.response?.body === 'string' ? record.response.body : JSON.stringify(record.response?.body ?? record.sampleStreamChunk ?? '');
    const sId = record.sessionId || this.activeSessionId;
    this.vault.getDatabase().upsertSession(sId, record.request.client);
    this.vault.getDatabase().saveTransaction({
      id: record.id,
      session_id: sId,
      client: record.request.client,
      method: record.request.method,
      url: record.request.url,
      status: record.response?.status ?? 200,
      latency_ms: record.latencyMs ?? 0,
      prompt_text: promptText,
      masked_prompt: record.maskedPrompt || promptText,
      model_response: modelResponse,
      intercepted_secrets: JSON.stringify(record.interceptedSecrets),
      timestamp: record.timestamp,
      target_provider: record.targetProvider,
      target_url: record.targetUrl || record.request.targetUrl,
    });
    this.eventBroadcaster.broadcast({ id: record.id, type: 'transaction_completed', timestamp: record.timestamp, client: record.request.client, details: { sessionId: sId, transactionId: record.id, status: record.response?.status, endpoint: record.request.url, targetUrl: record.targetUrl, latencyMs: record.latencyMs, secretCount: record.interceptedSecrets.length } });
  };

  public executeTestPing = (): TransactionRecord => this.dashboardApi.executeTestPing();

  private recordInterception = (direction: 'outbound' | 'inbound', client: string, secret: SecretEntry): void => {
    this.lastCall = { direction, client, timestamp: new Date().toLocaleTimeString(), rawUrl: secret.realValue, alias: secret.alias, key: secret.key };
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
        intercepted.push({ key: s.key, alias: s.alias, realValue: s.realValue, count: 1, direction });
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

    const txId = 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const interceptedSecrets: SecretInterception[] = [];
    const userAgent = String(req.headers['user-agent'] || '');
    const clientName = req.url.includes('chat') ? 'OpenCode' : (userAgent.includes('Claude') ? 'Claude Code' : (userAgent.includes('Aider') ? 'Aider' : (userAgent.includes('Cursor') ? 'Cursor' : 'AI Client')));
    const sessionId = this.sessionResolver.resolveSessionId(req, clientName);
    const retain = this.historyRetention.capture(sessionId);
    const record = (transaction: TransactionRecord): void => { if (retain()) this.recordTransaction(transaction); };
    this.activeSessionId = sessionId;
    this.eventBroadcaster.broadcast({ id: txId + '-start', type: 'request_started', timestamp: new Date().toISOString(), client: clientName, details: { sessionId, transactionId: txId, endpoint: req.url } });

    const headers: Record<string, string> = {};
    for (const [key, val] of Object.entries(req.headers)) {
      const lower = key.toLowerCase();
      if (lower !== 'host' && lower !== 'content-length' && val !== undefined) headers[key] = Array.isArray(val) ? val[0] : val;
    }

    let reqCtx: RequestContext = { method: req.method, url: req.url, headers, body: req.body, client: clientName };
    reqCtx = await this.hookManager.runBeforeOutboundRequest(reqCtx);

    let maskedBody: string | undefined = undefined;
    if (reqCtx.body !== undefined && reqCtx.body !== null) {
      const mapped = this.payloadCodec.request(reqCtx.body, reqCtx.url, text => {
        const remaining = this.vault.maskManualText(text).replace(/\$\$\{<[A-Z0-9_]+>\}/g, ' ');
        this.patternEngine.scanAndAutoDetect(remaining, (match, type) => this.vault.registerAutoDetectedSecret(match, type));
        if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'outbound');
        return this.vault.maskOutboundText(text);
      });
      maskedBody = typeof mapped === 'string' ? mapped : JSON.stringify(mapped);
      maskedBody = await this.hookManager.runAfterOutboundMask(maskedBody, reqCtx);
    }

    if (maskedBody !== undefined && !reqCtx.headers['content-type']) reqCtx.headers['content-type'] = 'application/json';

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
      upstreamRes = await this.requestCapture.send(req, txId, targetUrl, () => this.upstreamClient.fetch(targetUrl, { method: reqCtx.method, headers: reqCtx.headers, body: hasBody ? maskedBody : undefined, signal: disconnect.signal }));
    } catch (err: any) {
      const errCtx: ResponseContext = { status: 502, headers: {}, body: String(err?.message || err), isStream: false, client: clientName };
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
      const relay = new StreamRelay(this.vault, this.hookManager, this.eventBroadcaster, this.config.maxBufferWindowChars);
      const { accumulatedText, sampleStreamChunk, totalChunks } = await relay.run(upstreamRes, reply, resCtx, { txId, sessionId, client: clientName }, text => { if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'inbound'); });
      record({ id: txId, sessionId, targetProvider, targetUrl, request: { ...reqCtx, targetUrl }, response: resCtx, sampleStreamChunk, sampleStreamChunkIndex: 0, interceptedSecrets, timestamp: new Date().toISOString(), latencyMs: Math.round(performance.now() - startPerf), maskedPrompt: maskedBody });
      await this.hookManager.runAfterStream({ totalChunks, accumulatedText, client: clientName });
      return;
    }

    const responseText = await upstreamRes.text();
    const processedRaw = await this.hookManager.runBeforeInboundResponse(responseText, resCtx);
    const unmask = (text: string): string => {
      if (retain()) this.checkAndRecord(text, clientName, interceptedSecrets, 'inbound');
      return this.vault.unmaskInboundText(text);
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
  };
}
