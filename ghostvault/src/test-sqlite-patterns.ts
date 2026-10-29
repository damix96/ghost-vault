import Fastify, { FastifyInstance } from 'fastify';
import { VaultDatabase } from './vault/sqlite-db.js';
import { PatternEngine } from './vault/pattern-engine.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

export class SqlitePatternsTestRunner {
  private db: VaultDatabase;
  private patternEngine: PatternEngine;
  private vault: VaultStore;
  private proxyServer: GhostProxyServer;
  private mockPort = 8991;
  private proxyPort = 8992;
  private mockApp: FastifyInstance = Fastify({ logger: false });

  constructor() {
    this.db = new VaultDatabase(':memory:');
    this.patternEngine = new PatternEngine(this.db);
    this.vault = new VaultStore(this.db);
    this.proxyServer = new GhostProxyServer(this.vault, {
      port: this.proxyPort,
      targetApiBase: 'http://127.0.0.1:' + this.mockPort,
    });
  }

  private setupMock = (): void => {
    this.mockApp.post('/v1/chat/completions', async (req, reply) => {
      const auth = req.headers['authorization'];
      if (!auth) return reply.status(401).send({ error: 'Unauthorized: missing token' });
      return reply.status(200).send({
        choices: [{
          message: {
            content: 'Success normalized answer',
            tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'calculator', arguments: '{"expr":"2+2"}' } }]
          }
        }]
      });
    });
  };

  public run = async (): Promise<void> => {
    this.setupMock();
    await this.mockApp.listen({ port: this.mockPort, host: '127.0.0.1' });
    await this.proxyServer.listen();

    const patterns = this.patternEngine.getPatterns();
    if (patterns.length !== 5) throw new Error('Expected 5 default patterns including any-IP, got ' + patterns.length);

    let detectedKey = '';
    this.patternEngine.scanAndAutoDetect(
      'Connect to https://core.internal.bank.corp/api/v1 with postgres://admin:pass@10.0.1.5:5432/db',
      (match, type) => {
        const sec = this.vault.registerAutoDetectedSecret(match, type);
        detectedKey = sec.key;
      }
    );
    if (!detectedKey.startsWith('AUTO_')) throw new Error('Auto secret registration failed');
    const autoSecrets = this.vault.getAutoSecrets();
    if (autoSecrets.length === 0) throw new Error('Expected auto secrets to be populated');

    const added = this.patternEngine.addPattern('aws-keys', 'AKIA[0-9A-Z]{16}', 'aws');
    if (!added || added.name !== 'aws-keys') throw new Error('Failed to add custom pattern');
    if (this.patternEngine.addPattern('bad', '[unclosed', 'custom') !== null) throw new Error('Expected invalid regex rejection');

    const toggled = this.patternEngine.togglePattern(added.id);
    if (toggled?.enabled !== 0) throw new Error('Failed to toggle pattern to disabled');

    const deleted = this.patternEngine.deletePattern(added.id);
    if (!deleted) throw new Error('Failed to delete pattern');

    const baseUrl = 'http://127.0.0.1:' + this.proxyPort;

    const patRes = await fetch(baseUrl + '/api/patterns');
    const patList = (await patRes.json()) as any[];
    if (patList.length !== 5) throw new Error('Dashboard patterns endpoint failed');

    const createRes = await fetch(baseUrl + '/api/patterns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'eub.kz', pattern: 'eub.kz', type: 'internal domain' }),
    });
    const createdJson = (await createRes.json()) as any;
    if (!createdJson.success || createdJson.pattern.type !== 'internal domain') throw new Error('Failed eub.kz pattern post');

    const badPostRes = await fetch(baseUrl + '/api/patterns', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'bad', pattern: '[unclosed' }),
    });
    if (badPostRes.status !== 400) throw new Error('Expected 400 for bad pattern');

    const failRes = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-session-id': 'test-session-401' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Secret ping' }] }),
    });
    if (failRes.status !== 401) throw new Error('Expected 401 upstream failure');

    const sessionsRes = await fetch(baseUrl + '/api/sessions');
    const sessions = (await sessionsRes.json()) as any[];
    const session401 = sessions.find(s => s.id === 'test-session-401');
    if (!session401) throw new Error('Expected test-session-401 to be recorded in SQLite');

    const sessionTxsRes = await fetch(baseUrl + '/api/sessions/test-session-401');
    const sessionTxs = (await sessionTxsRes.json()) as any[];
    if (sessionTxs[0].response?.status !== 401 && sessionTxs[0].status !== 401) throw new Error('Expected status 401 in recorded transaction');
    if (!sessionTxs[0].maskedPrompt) throw new Error('Expected maskedPrompt in structured transaction');
    if (sessionTxs[0].targetProvider !== 'OpenCode') throw new Error('Expected targetProvider OpenCode');

    const multiTurn1 = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer valid' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Unique dialogue root for CLI session' }] }),
    });
    if (multiTurn1.status !== 200) throw new Error('Multi-turn step 1 failed');

    const multiTurn2 = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer valid' },
      body: JSON.stringify({
        messages: [
          { role: 'user', content: 'Unique dialogue root for CLI session' },
          { role: 'assistant', content: 'Success normalized answer' },
          { role: 'user', content: 'Step 2 prompt' },
        ],
      }),
    });
    if (multiTurn2.status !== 200) throw new Error('Multi-turn step 2 failed');

    const updatedSessions = (await (await fetch(baseUrl + '/api/sessions')).json()) as any[];
    const resolvedSession = updatedSessions.find(s => s.id.startsWith('sess_'));
    if (!resolvedSession) throw new Error('Expected fingerprint-based session');

    const resolvedTxs = (await (await fetch(baseUrl + '/api/sessions/' + resolvedSession.id)).json()) as any[];
    if (resolvedTxs.length < 2) throw new Error('Expected both steps grouped into same session');
    const contentBlocks = resolvedTxs[0].response?.body?.content || [];
    const textBlock = contentBlocks.find((b: any) => b.type === 'text');
    const toolBlock = contentBlocks.find((b: any) => b.type === 'tool_use');
    if (!textBlock || textBlock.text !== 'Success normalized answer') throw new Error('Expected normalized text block');
    if (!toolBlock || toolBlock.name !== 'calculator') throw new Error('Expected normalized tool_use block');

    const fullSessionRes = await fetch(baseUrl + '/api/sessions/' + resolvedSession.id + '/full');
    const fullMessages = (await fullSessionRes.json()) as any[];
    if (!Array.isArray(fullMessages) || fullMessages.length < 3) throw new Error('Expected full dialogue chain with >= 3 messages');

    const historyRes = await fetch(baseUrl + '/api/history');
    const history = (await historyRes.json()) as any[];
    if (history.length === 0) throw new Error('Expected history to return transactions');

    const delRes = await fetch(baseUrl + '/api/sessions/test-session-401', { method: 'DELETE' });
    const delJson = (await delRes.json()) as any;
    if (!delJson.success) throw new Error('Expected successful session delete');

    const checkDelSession = await fetch(baseUrl + '/api/sessions/test-session-401');
    const remainingTxs = (await checkDelSession.json()) as any[];
    if (remainingTxs.length !== 0) throw new Error('Expected session transactions to be deleted');

    const clearRes = await fetch(baseUrl + '/api/sessions', { method: 'DELETE' });
    const clearJson = (await clearRes.json()) as any;
    if (!clearJson.success || clearJson.count !== 0) throw new Error('Expected successful clearAllSessions with count 0');

    const remainingSessions = (await (await fetch(baseUrl + '/api/sessions')).json()) as any[];
    if (remainingSessions.length !== 0) throw new Error('Expected all sessions to be cleared');

    const settingsGet = await fetch(baseUrl + '/api/settings');
    const settingsJson = (await settingsGet.json()) as any;
    if (!settingsJson.chatBase || !settingsJson.anthropicBase) throw new Error('Settings GET failed');

    const settingsPost = await fetch(baseUrl + '/api/settings', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chatBase: 'https://custom.opencode.ai', anthropicBase: 'https://custom.anthropic.com' }),
    });
    const updatedSettings = (await settingsPost.json()) as any;
    if (updatedSettings.chatBase !== 'https://custom.opencode.ai') throw new Error('Settings POST failed');

    const prefixRes = await fetch(baseUrl + '/zen/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer valid' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Zen ping' }] }),
    });
    if (prefixRes.status !== 200) throw new Error('Prefix route /zen failed');

    const routesGet = await fetch(baseUrl + '/api/routes');
    const routes = (await routesGet.json()) as any[];
    if (routes.length !== 5) throw new Error('Expected 5 routes including separate Go');
    const opencodeRoute = routes.find(r => r.id === 'opencode');
    if (!opencodeRoute || !opencodeRoute.cliUrl || !opencodeRoute.commandExample || !opencodeRoute.description) throw new Error('Invalid opencode route structure');

    const updateRouteRes = await fetch(baseUrl + '/api/routes/ollama', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ upstreamUrl: 'http://127.0.0.1:11435' }),
    });
    const updatedOllama = (await updateRouteRes.json()) as any;
    if (updatedOllama.upstreamUrl !== 'http://127.0.0.1:11435') throw new Error('Failed to update ollama route');

    const openaiRes = await fetch(baseUrl + '/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer valid' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'OpenAI ping' }] }),
    });
    if (openaiRes.status !== 200) throw new Error('Prefix route /openai failed');

    const createCustomRes = await fetch(baseUrl + '/api/routes', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: 'DeepSeek Direct', prefix: 'deepseek', upstreamUrl: 'http://127.0.0.1:' + this.mockPort }),
    });
    const createdCustom = (await createCustomRes.json()) as any;
    if (createdCustom.id !== 'custom-deepseek' || !createdCustom.isCustom) throw new Error('Failed to create custom route');

    const customProxyRes = await fetch(baseUrl + '/deepseek/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'authorization': 'Bearer valid' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'Deepseek ping' }] }),
    });
    if (customProxyRes.status !== 200) throw new Error('Dynamic custom route proxying failed');

    const failDelDefault = await fetch(baseUrl + '/api/routes/opencode', { method: 'DELETE' });
    if (failDelDefault.status !== 400) throw new Error('Expected 400 when attempting to delete default route');

    const delCustomRes = await fetch(baseUrl + '/api/routes/custom-deepseek', { method: 'DELETE' });
    const delCustomJson = (await delCustomRes.json()) as any;
    if (!delCustomJson.success) throw new Error('Failed to delete custom route');

    const routesAfterDel = (await (await fetch(baseUrl + '/api/routes')).json()) as any[];
    if (routesAfterDel.some(r => r.id === 'custom-deepseek')) throw new Error('Custom route still exists after delete');

    await this.proxyServer.close();
    await this.mockApp.close();
    this.db.close();
    console.log('All SQLite persistence and pattern engine tests passed successfully!');
  };
}

if (process.argv[1]?.endsWith('test-sqlite-patterns.ts') || process.argv[1]?.endsWith('test-sqlite-patterns.js')) {
  new SqlitePatternsTestRunner().run().catch(e => {
    console.error('TEST FAILED:', e);
    process.exit(1);
  });
}
