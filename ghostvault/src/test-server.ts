import Fastify, { FastifyInstance } from 'fastify';
import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';

export class ProxyServerTestRunner {
  private mockUpstreamPort = 8799;
  private proxyPort = 8798;
  private mockApp: FastifyInstance = Fastify({ logger: false });
  private proxyServer: GhostProxyServer;
  private vault = new VaultStore();
  private lastReceivedUpstreamBody: any = null;

  constructor() {
    this.proxyServer = new GhostProxyServer(this.vault, {
      port: this.proxyPort,
      targetApiBase: 'http://127.0.0.1:' + this.mockUpstreamPort,
    });
  }

  private setupMockUpstream = (): void => {
    this.mockApp.post('/v1/messages', async (req, reply) => {
      this.lastReceivedUpstreamBody = req.body;
      const body = req.body as any;
      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        reply.raw.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant"}}\n\n');
        reply.raw.write('event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n');
        reply.raw.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Result is $${<TEST_API_KEY>}"}}\n\n');
        reply.raw.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n');
        reply.raw.write('event: content_block_start\ndata: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tool_1","name":"bash","input":{}}}\n\n');
        reply.raw.write('event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"token\\": \\"$${<TEST_API_KEY>}\\"}"}}\n\n');
        reply.raw.write('event: content_block_stop\ndata: {"type":"content_block_stop","index":1}\n\n');
        reply.raw.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        reply.raw.end();
        return;
      }
      return reply.status(200).send({
        id: 'msg_2',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Answer' },
          { type: 'tool_use', id: 'tool_2', name: 'curl', input: { auth: '$${<TEST_API_KEY>}' } },
        ],
      });
    });

    this.mockApp.post('/v1/chat/completions', async (req, reply) => {
      this.lastReceivedUpstreamBody = req.body;
      const body = req.body as any;
      if (body.stream) {
        reply.hijack();
        reply.raw.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-cache',
          'connection': 'keep-alive',
        });
        reply.raw.write('data: {"choices":[{"index":0,"delta":{"content":"AI answer with $${<TEST_API_KEY>}"},"finish_reason":null}]}\n\n');
        reply.raw.write('data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"run","arguments":"{\\"key\\": \\"$${<TEST_API_KEY>}\\"}"}}]},"finish_reason":null}]}\n\n');
        reply.raw.write('data: {"choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n');
        reply.raw.write('data: [DONE]\n\n');
        reply.raw.end();
        return;
      }
      return reply.status(200).send({
        id: 'chatcmpl-1',
        choices: [{
          index: 0,
          message: {
            role: 'assistant',
            content: 'Chat reply',
            tool_calls: [{
              id: 'call_2',
              type: 'function',
              function: { name: 'run', arguments: '{"token":"$${<TEST_API_KEY>}"}' },
            }],
          },
          finish_reason: 'tool_calls',
        }],
      });
    });
  };

  public run = async (): Promise<void> => {
    this.setupMockUpstream();
    await this.mockApp.listen({ port: this.mockUpstreamPort, host: '127.0.0.1' });
    await this.proxyServer.listen();

    const baseUrl = 'http://127.0.0.1:' + this.proxyPort;

    const healthRes = await fetch(baseUrl + '/health');
    const healthJson = (await healthRes.json()) as any;
    if (healthJson.status !== 'ok') throw new Error('Health check failed');

    const dashRes = await fetch(baseUrl + '/dashboard');
    const dashHtml = await dashRes.text();
    if (dashRes.status !== 200 || !dashHtml.includes('GhostVault')) {
      throw new Error('Dashboard check failed');
    }

    const rootRes = await fetch(baseUrl + '/');
    if (rootRes.status !== 200) throw new Error('Root check failed');

    const appJsRes = await fetch(baseUrl + '/app.js');
    if (appJsRes.status !== 200) throw new Error('Static asset check failed');

    const addSecretRes = await fetch(baseUrl + '/api/vault/secret', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'TEST_API_KEY', realValue: 'super_secret_val_123', description: 'Test key' }),
    });
    const addSecretJson = (await addSecretRes.json()) as any;
    if (!addSecretJson.success || addSecretJson.secret.alias !== '$${<TEST_API_KEY>}') {
      throw new Error('Add secret failed');
    }

    this.vault.setAutoSecret('AUTO_KEY', 'auto_secret_456');
    const promoteRes = await fetch(baseUrl + '/api/vault/promote', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: 'AUTO_KEY' }),
    });
    const promoteJson = (await promoteRes.json()) as any;
    if (!promoteJson.success || promoteJson.secret.key !== 'AUTO_KEY') {
      throw new Error('Promote failed');
    }

    const deleteRes = await fetch(baseUrl + '/api/vault/secret/AUTO_KEY', { method: 'DELETE' });
    const deleteJson = (await deleteRes.json()) as any;
    if (!deleteJson.success) throw new Error('Delete failed');

    const nonStreamRes = await fetch(baseUrl + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-anthropic-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Use super_secret_val_123 here' }],
      }),
    });
    const nonStreamJson = (await nonStreamRes.json()) as any;
    if (this.lastReceivedUpstreamBody?.messages?.[0]?.content !== 'Use $${<TEST_API_KEY>} here') {
      throw new Error('Outbound masking failed in non-stream: ' + JSON.stringify(this.lastReceivedUpstreamBody));
    }
    if (nonStreamJson.content[1].input.auth !== 'super_secret_val_123') {
      throw new Error('Inbound tool unmasking failed in non-stream: ' + JSON.stringify(nonStreamJson));
    }

    const streamRes = await fetch(baseUrl + '/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-anthropic-key',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Stream with super_secret_val_123' }],
      }),
    });
    if (this.lastReceivedUpstreamBody?.messages?.[0]?.content !== 'Stream with $${<TEST_API_KEY>}') {
      throw new Error('Outbound masking failed in stream: ' + JSON.stringify(this.lastReceivedUpstreamBody));
    }
    const streamBody = await streamRes.text();
    if (!streamBody.includes('Result is super_secret_val_123')) {
      throw new Error('Stream text unmasking failed: ' + streamBody);
    }
    if (!streamBody.includes('super_secret_val_123') || streamBody.includes('$${<TEST_API_KEY>}')) {
      throw new Error('Stream tool unmasking failed: ' + streamBody);
    }

    const chatRes = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'user', content: 'Chat with super_secret_val_123' }],
      }),
    });
    const chatJson = (await chatRes.json()) as any;
    if (this.lastReceivedUpstreamBody?.messages?.[0]?.content !== 'Chat with $${<TEST_API_KEY>}') {
      throw new Error('Outbound masking failed in chat: ' + JSON.stringify(this.lastReceivedUpstreamBody));
    }
    const chatArgs = chatJson.choices[0].message.tool_calls[0].function.arguments;
    if (!chatArgs.includes('super_secret_val_123') || chatArgs.includes('$${<TEST_API_KEY>}')) {
      throw new Error('Inbound tool unmasking failed in chat: ' + JSON.stringify(chatJson));
    }

    const chatStreamRes = await fetch(baseUrl + '/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        stream: true,
        messages: [{ role: 'user', content: 'Stream chat with super_secret_val_123' }],
      }),
    });
    const chatStreamText = await chatStreamRes.text();
    if (!chatStreamText.includes('AI answer with super_secret_val_123')) {
      throw new Error('Chat stream text unmasking failed: ' + chatStreamText);
    }
    if (!chatStreamText.includes('super_secret_val_123') || chatStreamText.includes('$${<TEST_API_KEY>}')) {
      throw new Error('Chat stream tool unmasking failed: ' + chatStreamText);
    }

    const vaultRes = await fetch(baseUrl + '/api/vault');
    const vaultJson = (await vaultRes.json()) as any;
    if (!vaultJson.lastCall || vaultJson.lastCall.key !== 'TEST_API_KEY') {
      throw new Error('LastCall verification failed: ' + JSON.stringify(vaultJson));
    }

    await this.proxyServer.close();
    await this.mockApp.close();
    console.log('All tests passed successfully!');
  };
}

new ProxyServerTestRunner().run();
