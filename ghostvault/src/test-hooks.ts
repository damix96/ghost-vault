import fs from 'node:fs';
import path from 'node:path';
import Fastify, { FastifyInstance } from 'fastify';
import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';
import { HookManager } from './hooks/manager.js';
import { GhostVaultHook, RequestContext, ResponseContext, StreamChunkContext, StreamEndContext } from './hooks/types.js';

export class HookIntegrationTestRunner {
  private mockUpstreamPort = 8797;
  private proxyPort = 8796;
  private mockApp: FastifyInstance = Fastify({ logger: false });
  private proxyServer!: GhostProxyServer;
  private vault = new VaultStore();
  private hookManager = new HookManager();
  private hooksDir = path.resolve(process.cwd(), 'temp-test-hooks');

  private executionLog: string[] = [];

  private setupMockUpstream = (): void => {
    this.mockApp.post('/v1/messages', async (req, reply) => {
      const body = req.body as any;
      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        reply.raw.write('event: message_start\ndata: {"type":"message_start"}\n\n');
        reply.raw.write('event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Secret is $${<HOOK_SECRET>}"}}\n\n');
        reply.raw.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        reply.raw.end();
        return;
      }
      return reply.status(200).send({
        content: [{ type: 'text', text: 'Non-stream secret is $${<HOOK_SECRET>}' }],
      });
    });
  };

  private setupTestHooks = (): void => {
    const memoryHook: GhostVaultHook = {
      beforeOutboundRequest: (ctx: RequestContext) => {
        this.executionLog.push('beforeOutboundRequest');
        ctx.headers['x-custom-injected'] = 'hook-active';
        return ctx;
      },
      afterOutboundMask: (body: string) => {
        this.executionLog.push('afterOutboundMask');
        if (!body.includes('$${<HOOK_SECRET>}')) {
          throw new Error('afterOutboundMask did not receive masked body');
        }
        return body;
      },
      beforeInboundResponse: (rawText: string) => {
        this.executionLog.push('beforeInboundResponse');
        return rawText;
      },
      afterInboundUnmask: (unmaskedText: string) => {
        this.executionLog.push('afterInboundUnmask');
        if (!unmaskedText.includes('super_secret_hook_val')) {
          throw new Error('afterInboundUnmask did not receive unmasked text');
        }
        return unmaskedText;
      },
      beforeStream: (_ctx: ResponseContext) => {
        this.executionLog.push('beforeStream');
      },
      onStreamChunk: (chunk: string, _ctx: StreamChunkContext) => {
        this.executionLog.push('onStreamChunk');
        return chunk;
      },
      afterStream: (ctx: StreamEndContext) => {
        this.executionLog.push('afterStream');
        if (!ctx.accumulatedText.includes('super_secret_hook_val')) {
          throw new Error('afterStream missing unmasked text');
        }
      },
    };
    this.hookManager.registerHook(memoryHook);

    if (!fs.existsSync(this.hooksDir)) fs.mkdirSync(this.hooksDir, { recursive: true });
    const diskHookCode = `
      export default {
        beforeOutboundRequest: (ctx) => {
          ctx.headers['x-disk-hook'] = 'loaded-from-dir';
          return ctx;
        }
      };
    `;
    fs.writeFileSync(path.join(this.hooksDir, 'sample-hook.js'), diskHookCode);
  };

  public run = async (): Promise<void> => {
    this.setupTestHooks();
    this.setupMockUpstream();

    await this.mockApp.listen({ port: this.mockUpstreamPort, host: '127.0.0.1' });

    this.vault.setManualSecret('HOOK_SECRET', 'super_secret_hook_val', 'Test secret for hook suite');

    this.proxyServer = new GhostProxyServer(
      this.vault,
      {
        port: this.proxyPort,
        targetApiBase: 'http://127.0.0.1:' + this.mockUpstreamPort,
        hooksDir: this.hooksDir,
      },
      this.hookManager
    );
    await this.proxyServer.listen();

    const baseUrl = 'http://127.0.0.1:' + this.proxyPort;

    const nonStreamRes = await fetch(baseUrl + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Use super_secret_hook_val here' }],
      }),
    });
    const nonStreamJson = (await nonStreamRes.json()) as any;

    if (!nonStreamJson.content[0].text.includes('super_secret_hook_val')) {
      throw new Error('Non-stream unmasking failed');
    }

    const streamRes = await fetch(baseUrl + '/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Stream with super_secret_hook_val' }],
      }),
    });
    const streamText = await streamRes.text();

    if (!streamText.includes('super_secret_hook_val')) {
      throw new Error('Stream unmasking failed');
    }

    const requiredHooks = [
      'beforeOutboundRequest',
      'afterOutboundMask',
      'beforeInboundResponse',
      'afterInboundUnmask',
      'beforeStream',
      'onStreamChunk',
      'afterStream',
    ];

    for (const h of requiredHooks) {
      if (!this.executionLog.includes(h)) {
        throw new Error(`Hook ${h} was not executed`);
      }
    }

    await this.proxyServer.close();
    await this.mockApp.close();

    fs.rmSync(this.hooksDir, { recursive: true, force: true });
    console.log('All 7 lifecycle hooks executed and verified successfully!');
  };
}

if (process.argv[1]?.endsWith('test-hooks.ts') || process.argv[1]?.endsWith('test-hooks.js')) {
  new HookIntegrationTestRunner().run().then(() => {
    process.exit(0);
  }).catch(e => {
    console.error('Hooks test failed:', e);
    process.exit(1);
  });
}
