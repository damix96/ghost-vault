import path from 'node:path';
import fs from 'node:fs';
import Fastify, { FastifyInstance } from 'fastify';
import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { RouteRegistry } from './proxy/route-registry.js';
import { OpenCodeCli } from './clients/opencode-cli.js';
import { OpenCodeConfig } from './clients/opencode-config.js';

export interface E2eEvidence {
  outboundPromptIntercepted: string;
  outboundMaskedCorrectly: boolean;
  rawUrlLeakedToLlm: boolean;
  llmResponsePayload: string;
  inboundUnmaskedCorrectly: boolean;
  targetHitReceived: boolean;
  targetHitHeaders: Record<string, string>;
  dashboardLastCall: any;
  dashboardHtmlValid: boolean;
  agentOutput: string;
}

export interface E2eOptions {
  bankPort?: number;
  upstreamPort?: number;
  proxyPort?: number;
  sandboxDir?: string;
  evidencePath?: string;
}

export class GhostVaultE2eRunner {
  private bankPort = 9099;
  private upstreamLlmPort = 9098;
  private proxyPort = 8766;
  private bankApp: FastifyInstance = Fastify({ logger: false });
  private upstreamApp: FastifyInstance = Fastify({ logger: false });
  private proxyServer: GhostProxyServer;
  private vault = new VaultStore(new VaultDatabase(':memory:'));

  private targetHitCount = 0;
  private lastTargetHeaders: Record<string, string> = {};
  private interceptedOutboundPayloads: any[] = [];
  private agentStdout = '';
  private agentStderr = '';
  private client = new OpenCodeCli();

  constructor(private options: E2eOptions = {}) {
    this.bankPort = options.bankPort ?? this.bankPort;
    this.upstreamLlmPort = options.upstreamPort ?? this.upstreamLlmPort;
    this.proxyPort = options.proxyPort ?? this.proxyPort;
    this.proxyServer = new GhostProxyServer(this.vault, {
      port: this.proxyPort,
      demoMode: true,
    });
  }

  private setupBankServer = (): void => {
    this.bankApp.get('/internal-bank', async (req, reply) => {
      this.targetHitCount++;
      const headersRecord: Record<string, string> = {};
      for (const [k, v] of Object.entries(req.headers)) {
        if (v) headersRecord[k] = Array.isArray(v) ? v.join(', ') : String(v);
      }
      this.lastTargetHeaders = headersRecord;
      return reply.status(200).send({
        status: 'ok',
        account: 'KZ-PRIV-9912',
        balance: 1450000.50,
        currency: 'USD',
        holder: 'GhostVault Internal Asset',
        timestamp: new Date().toISOString(),
      });
    });
  };

  private setupUpstreamLlm = (): void => {
    this.upstreamApp.post('/v1/chat/completions', async (req, reply) => {
      const body = req.body as any;
      this.interceptedOutboundPayloads.push(body);

      const isTitle = body.messages?.some((m: any) =>
        typeof m.content === 'string' && m.content.includes('title generator')
      );

      if (isTitle) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        reply.raw.write('data: {"id":"chatcmpl-title","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Bank Check"},"finish_reason":null}]}\n\n');
        reply.raw.write('data: {"id":"chatcmpl-title","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      const hasToolResult = body.messages?.some((m: any) =>
        m.role === 'tool' || (typeof m.content === 'string' && m.content.includes('KZ-PRIV-9912'))
      );

      if (hasToolResult) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        reply.raw.write('data: {"id":"chatcmpl-res","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":"Balance for KZ-PRIV-9912 is 1450000.50 USD."},"finish_reason":null}]}\n\n');
        reply.raw.write('data: {"id":"chatcmpl-res","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }

      reply.hijack();
      reply.raw.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        'connection': 'keep-alive',
      });
      const executionTool = body.tools?.find((tool: any) => ['shell', 'bash'].includes(tool.function?.name) && tool.function?.parameters?.properties?.command);
      if (!executionTool) throw new Error('OpenCode did not provide a supported shell tool');
      const toolCall = { index: 0, id: 'call_shell_001', type: 'function', function: { name: executionTool.function.name, arguments: JSON.stringify({ command: 'curl.exe -s $${<BANK_URL>}' }) } };
      reply.raw.write('data: ' + JSON.stringify({ id: 'chatcmpl-cmd', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: null }] }) + '\n\n');
      reply.raw.write('data: {"id":"chatcmpl-cmd","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n');
      reply.raw.write('data: [DONE]\n\n');
      reply.raw.end();
    });
  };

  private runAgentProcess = async (sandboxDir: string): Promise<number> => {
    const result = await this.client.run(sandboxDir, 'ghostvault-test/zen-mock', 'Fetch balance from http://127.0.0.1:' + this.bankPort + '/internal-bank');
    this.agentStdout = result.stdout;
    this.agentStderr = result.stderr;
    return result.exitCode;
  };

  public startSandbox = async (): Promise<string> => {
    this.setupBankServer();
    this.setupUpstreamLlm();

    await this.bankApp.listen({ port: this.bankPort, host: '127.0.0.1' });
    await this.upstreamApp.listen({ port: this.upstreamLlmPort, host: '127.0.0.1' });
    await this.proxyServer.listen();

    this.vault.setManualSecret('BANK_URL', `http://127.0.0.1:${this.bankPort}/internal-bank`, 'Core banking endpoint');
    new RouteRegistry(this.vault.getDatabase()).createCustomRoute({ name: 'GhostVault Test (Zen mock)', prefix: 'ghostvault-test', upstreamUrl: 'http://127.0.0.1:' + this.upstreamLlmPort });

    const sandboxDir = this.options.sandboxDir || path.resolve(process.cwd(), '../e2e-sandbox');
    if (!fs.existsSync(sandboxDir)) fs.mkdirSync(sandboxDir, { recursive: true });

    const opencodeConfig = OpenCodeConfig.create({
      id: 'ghostvault-test',
      name: 'GhostVault Test (Zen mock)',
      baseUrl: 'http://127.0.0.1:' + this.proxyPort + '/ghostvault-test/v1',
      apiKey: 'local-test-only',
      modelId: 'zen-mock',
    }, await this.client.version());
    fs.writeFileSync(path.join(sandboxDir, 'opencode.json'), JSON.stringify(opencodeConfig, null, 2));
    return `http://127.0.0.1:${this.proxyPort}/dashboard?route=custom-ghostvault-test`;
  };

  public close = async (): Promise<void> => {
    await this.proxyServer.close();
    await this.upstreamApp.close();
    await this.bankApp.close();
    this.vault.getDatabase().close();
  };

  public execute = async (): Promise<E2eEvidence> => {
    await this.startSandbox();
    const exitCode = await this.runAgentProcess(this.options.sandboxDir || path.resolve(process.cwd(), '../e2e-sandbox'));
    if (exitCode !== 0) { await this.close(); throw new Error('OpenCode exited with ' + exitCode + ': ' + this.agentStderr); }

    const rawBankUrl = `http://127.0.0.1:${this.bankPort}/internal-bank`;
    const stringifiedPayloads = JSON.stringify(this.interceptedOutboundPayloads);
    const rawUrlLeaked = stringifiedPayloads.includes(rawBankUrl);
    const maskedPresent = stringifiedPayloads.includes('$${<BANK_URL>}');

    const dashRes = await fetch(`http://127.0.0.1:${this.proxyPort}/dashboard`);
    const dashHtml = await dashRes.text();

    const vaultRes = await fetch(`http://127.0.0.1:${this.proxyPort}/api/vault`);
    const vaultData = (await vaultRes.json()) as any;

    const evidence: E2eEvidence = {
      outboundPromptIntercepted: stringifiedPayloads,
      outboundMaskedCorrectly: maskedPresent,
      rawUrlLeakedToLlm: rawUrlLeaked,
      llmResponsePayload: '{"command": "curl.exe -s $${<BANK_URL>}"}',
      inboundUnmaskedCorrectly: this.targetHitCount > 0,
      targetHitReceived: this.targetHitCount > 0,
      targetHitHeaders: this.lastTargetHeaders,
      dashboardLastCall: vaultData.lastCall,
      dashboardHtmlValid: dashRes.status === 200 && (dashHtml.includes('GhostVault') || dashHtml.includes('Hook Workbench')),
      agentOutput: this.agentStdout + '\n' + this.agentStderr,
    };

    await this.close();

    fs.writeFileSync(this.options.evidencePath || path.resolve(process.cwd(), '../e2e-evidence.json'), JSON.stringify(evidence, null, 2));
    return evidence;
  };
}

if (process.argv[1]?.endsWith('e2e-runner.ts') || process.argv[1]?.endsWith('e2e-runner.js')) {
  new GhostVaultE2eRunner().execute().then(ev => {
    console.log('E2E TEST RESULT:');
    console.log('  Outbound Masked:', ev.outboundMaskedCorrectly);
    console.log('  Raw URL Leaked:', ev.rawUrlLeakedToLlm);
    console.log('  Target Hit Received:', ev.targetHitReceived);
    console.log('  Dashboard Valid:', ev.dashboardHtmlValid);
    console.log('  Last Call Direction:', ev.dashboardLastCall?.direction);
    process.exit(ev.outboundMaskedCorrectly && !ev.rawUrlLeakedToLlm && ev.targetHitReceived ? 0 : 1);
  }).catch(e => {
    console.error('E2E FAILED:', e);
    process.exit(1);
  });
}
