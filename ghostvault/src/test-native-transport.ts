import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { UpstreamClient } from './proxy/upstream-client.js';

interface SendCall {
  url: string;
  init: RequestInit;
}

class NativeTransportTests {
  private calls: SendCall[] = [];
  private relay: any;

  private send = async (input: Parameters<typeof fetch>[0], init: NonNullable<Parameters<typeof fetch>[1]> = {}): Promise<Response> => {
    this.calls.push({ url: String(input), init });
    return new Response('upstream');
  };

  private upstreamRouting = async (): Promise<void> => {
    const client = new UpstreamClient(this.send);
    const original = {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-provider-auth',
        'content-type': 'application/json',
        'x-ghostvault-native-relay': 'http://127.0.0.1:41234/relay',
        'x-ghostvault-native-token': 'synthetic-relay-token',
      },
      body: '{"model":"big-pickle"}',
    };
    await client.fetch('https://opencode.ai/inference/openai/v1/chat/completions', original);
    assert.equal(this.calls.at(-1)?.url, 'http://127.0.0.1:41234/relay');
    const relayedHeaders = new Headers(this.calls.at(-1)?.init.headers);
    assert.equal(relayedHeaders.get('authorization'), 'Bearer test-provider-auth');
    assert.equal(relayedHeaders.get('x-ghostvault-native-token'), 'synthetic-relay-token');
    assert.equal(relayedHeaders.get('x-ghostvault-native-target'), 'https://opencode.ai/inference/openai/v1/chat/completions');
    assert.equal(relayedHeaders.has('x-ghostvault-native-relay'), false);

    for (const target of [
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
      'https://other.example/inference/openai/v1/chat/completions',
      'https://opencode.ai/other/path',
    ]) {
      const count = this.calls.length;
      await client.fetch(target, original);
      assert.equal(this.calls.length, count + 1);
      assert.equal(this.calls.at(-1)?.url, target);
      assert.equal(new Headers(this.calls.at(-1)?.init.headers).has('x-ghostvault-native-token'), false);
      assert.equal(new Headers(this.calls.at(-1)?.init.headers).has('x-ghostvault-native-relay'), false);
    }

    const invalid = new UpstreamClient(this.send);
    assert.throws(() => invalid.fetch('https://opencode.ai/inference/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'x-ghostvault-native-relay': 'https://evil.example/relay', 'x-ghostvault-native-token': 'synthetic' },
    }), /Invalid native transport endpoint/);
  };

  private loadRelay = async (): Promise<void> => {
    const module = await import(new URL('../opencode/zen-connection/native-relay.mjs', import.meta.url).href);
    this.relay = new module.NativeZenRelay(this.send);
  };

  private relayGuardsAndAttach = async (): Promise<void> => {
    let sendsBefore = this.calls.length;
    const relayUrl = 'http://127.0.0.1:41234/relay';
    const unauthorized = await this.relay.handle(new Request(relayUrl, { method: 'POST' }));
    assert.equal(unauthorized.status, 403);
    const wrongMethod = await this.relay.handle(new Request(relayUrl, { headers: { 'x-ghostvault-native-token': this.relay.token } }));
    assert.equal(wrongMethod.status, 404);
    const invalidTargets = [
      'https://evil.example/inference/openai/v1/chat/completions',
      'https://opencode.ai/inference/go/openai/v1/chat/completions',
      'https://opencode.ai/other/path',
      'https://user:password@opencode.ai/inference/openai/v1/chat/completions',
    ];
    for (const target of invalidTargets) {
      const result = await this.relay.handle(new Request(relayUrl, { method: 'POST', headers: { 'x-ghostvault-native-token': this.relay.token, 'x-ghostvault-native-target': target } }));
      assert.equal(result.status, 400);
    }
    assert.equal(this.calls.length, sendsBefore);

    const endpoint = 'http://127.0.0.1:41234/relay';
    const matching = { request: new Request('http://127.0.0.1:8765/opencode/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }) };
    this.relay.attach(matching, endpoint);
    assert.equal(new URL(matching.request.url).pathname, '/opencode/v1/chat/completions');
    assert.equal(matching.request.headers.get('x-ghostvault-native-relay'), endpoint);
    assert.equal(matching.request.headers.get('x-ghostvault-native-token'), this.relay.token);
    for (const url of ['http://127.0.0.1:8765/opencode-go/v1/chat/completions', 'https://opencode.ai/opencode/v1/chat/completions', 'http://127.0.0.1:8765/custom/v1/chat/completions']) {
      const event = { request: new Request(url) };
      const original = event.request;
      this.relay.attach(event, endpoint);
      assert.equal(event.request, original);
      assert.equal(event.request.headers.has('x-ghostvault-native-relay'), false);
    }
  };

  private relayHeadersStreamAndAbort = async (): Promise<void> => {
    let captured: { url: string; init: RequestInit } | undefined;
    let capturedBody = '';
    let upstreamStream: ReadableStream<Uint8Array> | undefined;
    const send = async (input: Parameters<typeof fetch>[0], init: NonNullable<Parameters<typeof fetch>[1]> = {}): Promise<Response> => {
      captured = { url: String(input), init };
      capturedBody = await new Response(init.body).text();
      upstreamStream = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('data: first\n\n')); controller.enqueue(new TextEncoder().encode('data: second\n\n')); controller.close(); } });
      return new Response(upstreamStream, { status: 202, headers: { 'content-type': 'text/event-stream', 'content-length': '999', 'content-encoding': 'gzip', connection: 'keep-alive' } });
    };
    const relay = new (this.relay.constructor)(send);
    const controller = new AbortController();
    const target = 'https://opencode.ai/inference/openai/v1/chat/completions';
    const request = new Request('http://127.0.0.1:41234/relay', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'x-ghostvault-native-token': relay.token,
        'x-ghostvault-native-target': target,
        'content-type': 'application/json',
        'content-encoding': 'gzip',
        'content-length': '999',
        connection: 'keep-alive, x-remove-me',
        'x-remove-me': 'hop-value',
        authorization: 'Bearer test-provider-auth',
        'x-opencode-org-id': 'org-test',
      },
      body: '{"hello":true}',
    });
    const response = await relay.handle(request);
    assert.equal(response.status, 202);
    assert.equal(response.body, upstreamStream);
    assert.equal(response.headers.get('content-encoding'), null);
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('connection'), null);
    assert.equal(captured?.url, target);
    assert.equal(capturedBody, '{"hello":true}');
    const upstreamHeaders = new Headers(captured?.init.headers);
    for (const name of ['host', 'content-length', 'content-encoding', 'connection', 'keep-alive', 'x-remove-me', 'x-ghostvault-native-token', 'x-ghostvault-native-target']) assert.equal(upstreamHeaders.has(name), false, name + ' stripped');
    assert.equal(upstreamHeaders.get('authorization'), 'Bearer test-provider-auth');
    assert.equal(upstreamHeaders.get('x-opencode-org-id'), 'org-test');
    assert.equal(captured?.init.signal?.aborted, false);
    controller.abort();
    assert.equal(captured?.init.signal?.aborted, true);
    assert.equal(await response.text(), 'data: first\n\ndata: second\n\n');
  };

  private relayChunkedWire = async (): Promise<void> => {
    let capturedHeaders: import('node:http').IncomingHttpHeaders | undefined;
    let capturedBody = '';
    const upstream = createServer((request, response) => {
      capturedHeaders = request.headers;
      const chunks: Buffer[] = [];
      request.on('data', chunk => chunks.push(Buffer.from(chunk)));
      request.on('end', () => {
        capturedBody = Buffer.concat(chunks).toString('utf8');
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end('{"ok":true}');
      });
    });
    upstream.listen(0, '127.0.0.1');
    await once(upstream, 'listening');
    const address = upstream.address();
    assert.ok(address && typeof address !== 'string');
    const body = '{"model":"relay-chunked-test","messages":[{"role":"user","content":"synthetic payload"}]}';
    const relay = new (this.relay.constructor)(async (_target: string, init: RequestInit) => fetch('http://127.0.0.1:' + address.port + '/capture', init));
    const request = {
      method: 'POST',
      url: 'http://127.0.0.1:41234/relay',
      headers: new Headers({
        'x-ghostvault-native-token': relay.token,
        'x-ghostvault-native-target': 'https://opencode.ai/inference/openai/v1/chat/completions',
        'content-type': 'application/json',
        'transfer-encoding': 'chunked',
        connection: 'keep-alive, x-remove-me',
        'x-remove-me': 'hop-value',
        authorization: 'Bearer synthetic-relay-auth',
        'x-preserve-header': 'preserved-value',
      }),
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(body.slice(0, 17)));
          controller.enqueue(new TextEncoder().encode(body.slice(17)));
          controller.close();
        },
      }),
      signal: new AbortController().signal,
    };
    try {
      const response = await relay.handle(request);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), '{"ok":true}');
      assert.equal(capturedHeaders?.['transfer-encoding'], 'chunked');
      assert.equal(capturedHeaders?.['content-length'], undefined);
      assert.equal(capturedHeaders?.authorization, 'Bearer synthetic-relay-auth');
      assert.equal(capturedHeaders?.['x-preserve-header'], 'preserved-value');
      assert.equal(capturedHeaders?.['x-remove-me'], undefined);
      assert.equal(capturedBody, body);
    } finally {
      relay.stop();
      await new Promise<void>((resolve, reject) => upstream.close(error => error ? reject(error) : resolve()));
    }
  };

  public run = async (): Promise<void> => {
    await this.upstreamRouting();
    await this.loadRelay();
    await this.relayGuardsAndAttach();
    await this.relayHeadersStreamAndAbort();
    await this.relayChunkedWire();
    console.log('Native transport tests passed: target routing, guards, header filtering, stream passthrough, abort propagation, and chunked H1 framing.');
  };
}

new NativeTransportTests().run().catch(error => { console.error(error); process.exitCode = 1; });
