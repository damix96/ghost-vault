import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { once } from 'node:events';
import { createParser } from 'eventsource-parser';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { RouteRegistry } from './proxy/route-registry.js';
import { SessionResolver } from './proxy/session-resolver.js';
import { SseTransformer } from './proxy/sse-transformer.js';
import { ResponseNormalizer } from './proxy/response-normalizer.js';
import { OpenCodeConfig } from './clients/opencode-config.js';

export class GatewayRegressionTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private value = 'https://service.internal/путь?value="quoted"&dir=C:\\work';

  private verifyStreams = (): void => {
    this.vault.setManualSecret('REGRESSION_URL', this.value);
    const token = '$${<REGRESSION_URL>}';
    const pieces = [token.slice(0, 12), token.slice(12)];
    const events = [
      ...pieces.map(content => ({ choices: [{ index: 0, delta: { content }, finish_reason: null }] })),
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'tool-one', function: { name: 'fetch', arguments: '{"url":"' + pieces[0] } }] } }] },
      { choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: pieces[1] + '"}' } }] } }] },
      { choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] },
    ];
    const input = events.map(event => 'data: ' + JSON.stringify(event) + '\n\n').join('') + 'data: [DONE]\n\n';
    const transformer = new SseTransformer(this.vault, 64, () => {});
    let output = '';
    for (let index = 0; index < input.length; index += 7) output += transformer.push(input.slice(index, index + 7));
    output += transformer.flush();
    const payloads: any[] = [];
    createParser({ onEvent: event => { if (event.data !== '[DONE]') payloads.push(JSON.parse(event.data)); } }).feed(output);
    const text = payloads.map(payload => payload.choices[0].delta.content || '').join('');
    const args = payloads.flatMap(payload => payload.choices[0].delta.tool_calls || []).map(tool => tool.function?.arguments || '').join('');
    assert.equal(text, this.value);
    assert.equal(JSON.parse(args).url, this.value);
    assert.equal(payloads.at(-1).choices[0].finish_reason, 'tool_calls');
    const normalized = ResponseNormalizer.normalize(output);
    assert.equal(normalized.content.filter((block: any) => block.type === 'tool_use').length, 1);
    assert.equal(normalized.content.find((block: any) => block.type === 'tool_use').input.url, this.value);

    const anthropic = new SseTransformer(this.vault, 64, () => {});
    const frames = [
      { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'anthropic-one', name: 'fetch', input: {} } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"url":"' + pieces[0] } },
      { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: pieces[1] + '"}' } },
      { type: 'content_block_stop', index: 0 },
    ];
    const result = anthropic.push(frames.map(frame => 'event: ' + frame.type + '\ndata: ' + JSON.stringify(frame) + '\n\n').join('')) + anthropic.flush();
    const tool = ResponseNormalizer.normalize(result).content.find((block: any) => block.type === 'tool_use');
    assert.equal(tool.input.url, this.value);
    assert.equal(tool.name, 'fetch');
  };

  private verifyOpenCodeConfigVersions = (): void => {
    const options = { id: 'ghostvault-test', name: 'GhostVault mock', baseUrl: 'http://127.0.0.1:9108/ghostvault-test/v1', modelId: 'zen-mock', apiKey: 'local-test-only' };
    const v1 = OpenCodeConfig.create(options, 1);
    const v2 = OpenCodeConfig.create(options, 2);
    const legacy = v1.provider[options.id];
    const native = v2.providers[options.id];
    assert.equal(legacy.options.baseURL, native.settings.baseURL);
    assert.equal(legacy.models[options.modelId].name, native.models[options.modelId].name);
    assert.equal(legacy.options.apiKey, native.settings.apiKey);
    assert.equal(legacy.npm, '@ai-sdk/openai-compatible');
    assert.equal(native.package, '@opencode/ai/providers/openai-compatible');
    assert.equal(native.models[options.modelId].capabilities.tools, true);
    assert.deepEqual(native.models[options.modelId].capabilities.input, ['text']);
    assert.deepEqual(native.models[options.modelId].capabilities.output, ['text']);
  };

  private verifyRoutes = async (): Promise<void> => {
    const transactionCount = this.db.getTransactions().length;
    const registry = new RouteRegistry(this.db);
    const resolver = new SessionResolver();
    const settings = registry.getSettings();
    assert.equal(resolver.resolveRoute('/opencode-go/v1/chat/completions', settings).targetUrl, 'https://opencode.ai/inference/go/openai/v1/chat/completions');
    assert.equal(resolver.resolveRoute('/opencode-go/v1/messages', settings).targetUrl, 'https://opencode.ai/inference/go/anthropic/v1/messages');
    assert.equal(resolver.resolveRoute('/opencode/v1/chat/completions', settings).targetUrl, 'https://opencode.ai/inference/openai/v1/chat/completions');
    assert.equal(resolver.resolveRoute('/opencode/v1/responses', settings).targetUrl, 'https://opencode.ai/inference/openai/v1/responses');
    assert.equal(resolver.resolveRoute('/opencode/v1/messages', settings).targetUrl, 'https://opencode.ai/inference/anthropic/v1/messages');
    assert.equal(resolver.resolveRoute('/anthropic/v1/messages', settings).targetUrl, 'https://api.anthropic.com/v1/messages');
    assert.equal(resolver.resolveRoute('/opencode/v1beta/models/gemini-audit:generateContent', settings).targetUrl, 'https://opencode.ai/inference/google/v1beta/models/gemini-audit:generateContent');
    assert.equal(resolver.resolveRoute('/opencode/v1beta/models/gemini-audit:streamGenerateContent?alt=sse', settings).targetUrl, 'https://opencode.ai/inference/google/v1beta/models/gemini-audit:streamGenerateContent?alt=sse');
    const server = new GhostProxyServer(this.vault);
    try {
      const changed = await server.getApp().inject({ method: 'POST', url: '/api/settings', payload: { chatBase: 'http://127.0.0.1:9098/v1' } });
      assert.equal(changed.statusCode, 200);
      assert.equal(resolver.resolveRoute('/opencode/v1/chat/completions', registry.getSettings()).targetUrl, 'http://127.0.0.1:9098/v1/chat/completions');
      assert.equal(registry.getSettings().go, settings.go);
      const bad = await server.getApp().inject({ method: 'POST', url: '/api/routes/openai', payload: { upstreamUrl: 'file:///etc/passwd' } });
      assert.equal(bad.statusCode, 400);
      assert.equal(registry.getSettings().openai, settings.openai);
      const missing = await server.getApp().inject({ method: 'GET', url: '/api/nonexistent' });
      assert.equal(missing.statusCode, 404);
      const favicon = await server.getApp().inject({ method: 'GET', url: '/favicon.ico' });
      assert.equal(favicon.statusCode, 404);
      assert.equal(this.db.getTransactions().length, transactionCount);
      const claimedPreset = registry.createCustomRoute({ name: 'claimed', prefix: 'openai', upstreamUrl: 'http://127.0.0.1:9098' });
      assert.equal(claimedPreset.id, 'openai');
      assert.equal(claimedPreset.isCustom, true);
      assert.throws(() => registry.createCustomRoute({ name: 'collision', prefix: 'openai', upstreamUrl: 'http://127.0.0.1:9098' }));
      assert.throws(() => registry.createCustomRoute({ name: 'reserved', prefix: 'api', upstreamUrl: 'http://127.0.0.1:9098' }));
      const encodedAlias = this.vault.maskOutboundText(Buffer.from(this.value).toString('base64'));
      assert.match(encodedAlias, /^\$\$\{<[A-Z0-9_]+>\}$/);
      assert.notEqual(encodedAlias, '$${<REGRESSION_URL>}');
      assert.equal(this.vault.unmaskInboundText(encodedAlias), Buffer.from(this.value).toString('base64'));
    } finally { await server.close(); }
  };

  private verifyStreamFailure = async (): Promise<void> => {
    const upstream = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: 'A partial response that is long enough to pass the relay buffer safely.' }, finish_reason: null }] }) + '\n\n');
      setTimeout(() => response.socket?.destroy(), 80);
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    new RouteRegistry(this.db).createCustomRoute({ name: 'Reset fixture', prefix: 'reset-fixture', upstreamUrl: 'http://127.0.0.1:' + address.port });
    const proxy = new GhostProxyServer(this.vault, { port: 0 });
    try {
      const proxyAddress = await proxy.listen();
      const response = await fetch(proxyAddress + '/reset-fixture/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-session-id': 'reset-regression' },
        body: JSON.stringify({ stream: true, messages: [{ role: 'user', content: 'reset test' }] }),
      });
      assert.equal(response.status, 200);
      const body = await Promise.race([
        response.text(),
        new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error('SSE relay hung after upstream reset')), 5000)),
      ]);
      const relayedText: string[] = [];
      let relayedError: any;
      createParser({ onEvent: event => {
        if (event.event === 'error') relayedError = JSON.parse(event.data);
        else if (event.data !== '[DONE]') relayedText.push(JSON.parse(event.data).choices?.[0]?.delta?.content || '');
      } }).feed(body);
      assert.equal(relayedText.join(''), 'A partial response that is long enough to pass the relay buffer safely.');
      assert.equal(relayedError?.error?.type, 'upstream_error');
      const transaction = proxy.getTransactionHistory()[0];
      assert.equal(transaction.response?.status, 502);
      assert.match(String(transaction.response?.body), /Stream interrupted/);
    } finally {
      await proxy.close();
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    }
  };

  private verifyChunkedRequest = async (): Promise<void> => {
    const secret = 'CHUNKED-REQUEST-CANARY-4D71';
    const alias = '$${<CHUNKED_REQUEST>}';
    this.vault.setManualSecret('CHUNKED_REQUEST', secret);
    const captured: Array<{ headers: import('node:http').IncomingHttpHeaders; body: any }> = [];
    const upstream = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        captured.push({ headers: request.headers, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify({ id: 'chunked-mock', choices: [{ message: { role: 'assistant', content: 'ok' } }] }));
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    new RouteRegistry(this.db).createCustomRoute({ name: 'Chunked fixture', prefix: 'chunked-regression', upstreamUrl: 'http://127.0.0.1:' + address.port });
    const proxy = new GhostProxyServer(this.vault, { port: 0 });
    try {
      const proxyUrl = await proxy.listen();
      const proxyAddress = new URL(proxyUrl);
      const payload = JSON.stringify({ model: 'chunked-test', messages: [{ role: 'user', content: 'echo ' + secret }] });
      const send = (body: string, chunked: boolean): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
        const headers: Record<string, string | number> = {
          'content-type': 'application/json', 'x-session-id': chunked ? 'chunked-fixture' : 'fixed-fixture', authorization: 'Bearer synthetic-chunked-test', 'x-preserve-header': 'preserved-value', connection: 'keep-alive, x-remove-hop', 'x-remove-hop': 'must-not-forward',
        };
        if (!chunked) headers['content-length'] = Buffer.byteLength(body);
        const request = httpRequest({ hostname: proxyAddress.hostname, port: Number(proxyAddress.port), path: '/chunked-regression/v1/chat/completions', method: 'POST', headers }, response => {
          const chunks: Buffer[] = [];
          response.on('data', chunk => chunks.push(Buffer.from(chunk)));
          response.on('end', () => resolve({ status: response.statusCode || 0, body: Buffer.concat(chunks).toString('utf8') }));
        });
        request.once('error', reject);
        if (chunked) {
          request.write(body.slice(0, 19));
          request.end(body.slice(19));
        } else request.end(body);
      });
      const chunkedResult = await send(payload, true);
      const fixedResult = await send(payload, false);
      assert.equal(chunkedResult.status, 200);
      assert.equal(fixedResult.status, 200);
      assert.equal(JSON.parse(chunkedResult.body).choices[0].message.content, 'ok');
      assert.equal(JSON.parse(fixedResult.body).choices[0].message.content, 'ok');
      assert.equal(captured.length, 2);
      for (const upstreamCapture of captured) {
        assert.equal(upstreamCapture.headers.authorization, 'Bearer synthetic-chunked-test');
        assert.equal(upstreamCapture.headers['x-preserve-header'], 'preserved-value');
        assert.equal(upstreamCapture.headers['x-remove-hop'], undefined);
        assert.ok(!String(upstreamCapture.headers.connection || '').split(',').map(value => value.trim().toLowerCase()).includes('x-remove-hop'));
        const content = upstreamCapture.body.messages[0].content;
        assert.ok(content.includes(alias));
        assert.ok(!content.includes(secret));
      }
      assert.equal(captured[0].headers['transfer-encoding'], 'chunked');
      assert.equal(captured[0].headers['content-length'], undefined);
      assert.equal(captured[1].headers['transfer-encoding'], undefined);
      assert.equal(Number(captured[1].headers['content-length']), Buffer.byteLength(JSON.stringify({ model: 'chunked-test', messages: [{ role: 'user', content: 'echo ' + alias }] })));
      const transactions = proxy.getTransactionHistory();
      const chunkedTransaction = transactions.find(transaction => transaction.request.headers['transfer-encoding'] === 'chunked');
      const fixedTransaction = transactions.find(transaction => transaction.request.headers['transfer-encoding'] === undefined);
      assert.ok(chunkedTransaction);
      assert.ok(fixedTransaction);
      assert.equal(chunkedTransaction.request.headers['content-length'], undefined);
      assert.match(chunkedTransaction.request.headers.connection, /x-remove-hop/i);
      assert.equal(chunkedTransaction.request.headers['x-remove-hop'], 'must-not-forward');
      assert.equal(chunkedTransaction.response?.status, 200);
      assert.equal(fixedTransaction.response?.status, 200);
    } finally {
      this.vault.deleteSecret('CHUNKED_REQUEST');
      await proxy.close();
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    }
  };

  public run = async (): Promise<void> => {
    try {
      this.verifyStreams();
      this.verifyOpenCodeConfigVersions();
      await this.verifyStreamFailure();
      await this.verifyRoutes();
      await this.verifyChunkedRequest();
      console.log('Gateway regressions passed: fragmented SSE, socket reset handling, chunked HTTP forwarding, JSON escaping, route settings, Go isolation, URL validation.');
    } finally { this.db.close(); }
  };
}

new GatewayRegressionTests().run().catch(error => { console.error(error); process.exitCode = 1; });
