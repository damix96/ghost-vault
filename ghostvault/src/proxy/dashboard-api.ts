import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { VaultStore } from '../vault/store.js';
import { PatternEngine } from '../vault/pattern-engine.js';
import { PatternEditorApi } from './pattern-editor-api.js';
import { RulePreviewApi } from './rule-preview-api.js';
import { TransactionRow } from '../vault/sqlite-db.js';
import { HookManager } from '../hooks/manager.js';
import { EventBroadcaster } from '../telemetry/event-broadcaster.js';
import { HookSandbox } from '../telemetry/hook-sandbox.js';
import { TransactionRecord, HookDryRunRequest } from '../telemetry/types.js';
import { GhostVaultConfig, SecretEntry } from '../types/index.js';
import { LastCallInfo } from './server.js';
import { ResponseNormalizer } from './response-normalizer.js';
import { RouteRegistry } from './route-registry.js';
import { DashboardDemo } from './dashboard-demo.js';
import { SessionDialogue } from './session-dialogue.js';
import { WorkspaceApi } from './workspace-api.js';

const secretSchema = z.object({
  key: z.string().min(1),
  realValue: z.string().min(1),
  description: z.string().optional(),
});

const promoteSchema = z.object({
  key: z.string().min(1),
});

export class DashboardApi {
  private routeRegistry: RouteRegistry;

  constructor(
    private app: FastifyInstance,
    private vault: VaultStore,
    private patternEngine: PatternEngine,
    private hookManager: HookManager,
    private eventBroadcaster: EventBroadcaster,
    private hookSandbox: HookSandbox,
    private getStartTime: () => number,
    private getLastCall: () => LastCallInfo | null,
    private getLastTransactionContext: () => TransactionRecord | null,
    private getTransactionHistory: () => TransactionRecord[],
    private getTransactionById: (id: string) => TransactionRecord | undefined,
    private recordTransaction: (record: TransactionRecord) => void,
    private recordInterception: (direction: 'outbound' | 'inbound', client: string, secret: SecretEntry) => void,
    private getUpstreamSettings?: () => { chatBase: string; anthropicBase: string },
    private setUpstreamSettings?: (s: { chatBase?: string; anthropicBase?: string }) => { chatBase: string; anthropicBase: string },
    private demoMode = false,
    private clearHistory: (sessionId?: string) => void = () => {},
    private proxyConfig: Partial<GhostVaultConfig> = {}
  ) {
    this.routeRegistry = new RouteRegistry(this.vault.getDatabase());
  }

  private safeJson = (val: string, fallback: any = val): any => {
    try {
      const parsed = JSON.parse(val);
      if (parsed !== undefined) return parsed;
    } catch {}
    return fallback;
  };

  private mapDbTx = (row: TransactionRow): TransactionRecord => {
    const targetUrl = row.target_url;
    return {
      id: row.id,
      sessionId: row.session_id,
      targetProvider: row.target_provider,
      targetUrl,
      latencyMs: row.latency_ms,
      maskedPrompt: row.masked_prompt || undefined,
      request: { method: row.method, url: row.url, targetUrl, headers: {}, body: this.safeJson(row.prompt_text), client: row.client },
      response: { status: row.status, headers: {}, body: ResponseNormalizer.normalize(this.safeJson(row.model_response)), isStream: false, client: row.client },
      interceptedSecrets: this.safeJson(row.intercepted_secrets, []),
      timestamp: row.timestamp,
    };
  };

  private autoSecrets = () => this.vault.getAutoSecrets();

  public registerRoutes = (): void => {
    new WorkspaceApi(this.app, this.vault.getDatabase(), this.hookManager, this.proxyConfig, this.vault).register();
    this.app.get('/dashboard', async (_, reply: FastifyReply) => reply.sendFile('index.html'));

    this.app.get('/health', async () => ({
      status: 'ok',
      mode: this.demoMode ? 'demo' : 'gateway',
      uptime: Math.floor((Date.now() - this.getStartTime()) / 1000),
    }));

    this.app.get('/api/vault', async () => ({
      manual: this.vault.getManualSecrets(),
      auto: this.autoSecrets(),
      manualSecrets: this.vault.getManualSecrets(),
      autoSecrets: this.autoSecrets(),
      lastCall: this.getLastCall(),
      retention: this.vault.getRetention(),
    }));

    this.app.post('/api/vault/secret', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = secretSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.setManualSecret(parsed.data.key, parsed.data.realValue, parsed.data.description);
      return reply.status(200).send({ success: true, secret: entry });
    });

    this.app.post('/api/vault/promote', async (req: FastifyRequest, reply: FastifyReply) => {
      const parsed = promoteSchema.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.promote(parsed.data.key);
      if (!entry) return reply.status(404).send({ error: 'Secret not found in auto vault' });
      return reply.status(200).send({ success: true, secret: entry });
    });

    this.app.delete('/api/vault/secret/:key', async (req: FastifyRequest<{ Params: { key: string } }>, reply: FastifyReply) => {
      const deleted = this.vault.deleteSecret(req.params.key);
      return reply.status(deleted ? 200 : 404).send({ success: deleted });
    });

    this.app.get('/api/history', async () => {
      const dbTxs = this.vault.getDatabase().getTransactions(50);
      if (dbTxs.length > 0) {
        return dbTxs.map(tx => ({
          id: tx.id, timestamp: tx.timestamp, method: tx.method, url: tx.url, client: tx.client, secretCount: this.safeJson(tx.intercepted_secrets, []).length, latencyMs: tx.latency_ms, status: tx.status,
        }));
      }
      return this.getTransactionHistory().map(tx => ({
        id: tx.id, timestamp: tx.timestamp, method: tx.request.method, url: tx.request.url, client: tx.request.client, secretCount: tx.interceptedSecrets.length, latencyMs: tx.latencyMs ?? 0, status: tx.response?.status ?? 200,
      }));
    });

    this.app.get('/api/hooks/context', async (req: FastifyRequest<{ Querystring: { id?: string } }>) => {
      const targetId = req.query?.id;
      if (targetId) {
        const found = this.getTransactionById(targetId);
        if (found) return found;
        const fromDb = this.vault.getDatabase().getTransaction(targetId);
        return fromDb ? this.mapDbTx(fromDb) : { empty: true };
      }
      const latest = this.getLastTransactionContext();
      return latest || { empty: true };
    });

    this.app.addContentTypeParser('application/x-www-form-urlencoded', (_, __, done) => done(null, null));

    this.app.post('/api/test-ping', async () => ({
      success: true,
      transaction: this.executeTestPing(),
    }));

    this.app.post('/api/hooks/test-run', async (req: FastifyRequest, reply: FastifyReply) => {
      const dryRunReq = req.body as HookDryRunRequest;
      const result = await this.hookSandbox.executeDryRun(dryRunReq, this.getLastTransactionContext());
      return reply.status(200).send(result);
    });

    this.app.get('/api/sessions', async () =>
      this.vault.getDatabase().getSessions().map(s => ({
        id: s.id,
        name: s.id,
        endpoints: this.safeJson(s.endpoints || '[]', []),
        client: s.client,
        firstSeen: s.first_seen,
        lastSeen: s.last_seen,
        txCount: s.tx_count,
        stepsCount: s.tx_count,
        timestamp: s.last_seen,
      }))
    );

    this.app.get('/api/sessions/:id', async (req: FastifyRequest<{ Params: { id: string } }>) =>
      this.vault.getDatabase().getTransactionsBySession(req.params.id).map(this.mapDbTx)
    );

    this.app.get('/api/sessions/:id/full', async (req: FastifyRequest<{ Params: { id: string } }>) =>
      SessionDialogue.buildChain(this.vault.getDatabase().getTransactionsBySession(req.params.id))
    );

    this.app.delete('/api/sessions/:id', async (req: FastifyRequest<{ Params: { id: string } }>) => {
      this.vault.getDatabase().deleteSession(req.params.id);
      this.clearHistory(req.params.id);
      return { success: true };
    });

    this.app.delete('/api/sessions', async () => {
      this.vault.getDatabase().clearAllSessions();
      this.clearHistory();
      return { success: true, count: 0 };
    });

    this.app.get('/api/patterns', async () => this.patternEngine.getPatterns());
    new PatternEditorApi(this.app, this.patternEngine).register();
    new RulePreviewApi(this.app, this.vault.getDatabase(), this.vault).register();

    this.app.delete('/api/patterns/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = this.patternEngine.deletePattern(req.params.id);
      return reply.status(deleted ? 200 : 404).send({ success: deleted });
    });

    this.app.post('/api/patterns/:id/toggle', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const toggled = this.patternEngine.togglePattern(req.params.id);
      if (!toggled) return reply.status(404).send({ error: 'Pattern not found' });
      return reply.status(200).send({ success: true, pattern: toggled });
    });

    this.app.get('/api/routes', async (req: FastifyRequest) => {
      const host = req.headers.host ? 'http://' + req.headers.host : 'http://127.0.0.1:8765';
      return this.routeRegistry.getRoutes(host);
    });

    this.app.post('/api/routes', async (req: FastifyRequest<{ Body: { name?: string; prefix?: string; upstreamUrl?: string; description?: string; suffix?: string } }>, reply: FastifyReply) => {
      const b = req.body || {};
      if (!b.name || !b.prefix || !b.upstreamUrl) return reply.status(400).send({ error: 'Name, prefix, and upstreamUrl are required' });
      try {
        const host = req.headers.host ? 'http://' + req.headers.host : 'http://127.0.0.1:8765';
        const created = this.routeRegistry.createCustomRoute({ name: b.name, prefix: b.prefix, upstreamUrl: b.upstreamUrl, description: b.description, suffix: b.suffix }, host);
        return reply.status(201).send(created);
      } catch (err: any) {
        return reply.status(400).send({ error: err?.message || String(err) });
      }
    });

    this.app.post('/api/routes/:id', async (req: FastifyRequest<{ Params: { id: string }; Body: { upstreamUrl?: string; targetUrl?: string; name?: string; suffix?: string } }>, reply: FastifyReply) => {
      const url = req.body?.upstreamUrl || req.body?.targetUrl;
      if (!url) return reply.status(400).send({ error: 'upstreamUrl is required' });
      const host = req.headers.host ? 'http://' + req.headers.host : 'http://127.0.0.1:8765';
      try {
        const updated = this.routeRegistry.updateRoute(req.params.id, url, host, req.body?.name, req.body?.suffix);
        if (!updated) return reply.status(404).send({ error: 'Route not found' });
        return reply.status(200).send(updated);
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    });

    this.app.delete('/api/routes/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
      const deleted = this.routeRegistry.deleteRoute(req.params.id);
      if (!deleted) return reply.status(400).send({ error: 'Cannot delete route: not found or is default route' });
      return reply.status(200).send({ success: true, id: req.params.id });
    });


    this.app.get('/api/settings', async () => ({
      ...this.routeRegistry.getSettings(),
    }));

    this.app.post('/api/settings', async (req: FastifyRequest<{ Body: Record<string, string> }>, reply: FastifyReply) => {
      try {
        return { success: true, ...this.routeRegistry.updateSettings(req.body || {}) };
      } catch (error: any) {
        return reply.status(400).send({ error: error.message });
      }
    });

    this.app.get('/api/events', async (_, reply: FastifyReply) => {
      this.eventBroadcaster.subscribe(reply);
    });
  };

  public executeTestPing = () => new DashboardDemo(this.vault, this.recordTransaction, this.recordInterception).execute();
}
