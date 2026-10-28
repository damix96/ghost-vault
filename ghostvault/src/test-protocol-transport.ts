import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { RouteRegistry } from './proxy/route-registry.js';
import { GhostProxyServer } from './proxy/server.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

interface Capture {
  url: string;
  headers: IncomingMessage['headers'];
  body: any;
}

export class ProtocolTransportTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);
  private captures: Capture[] = [];
  private secret = 'TRANSPORT-"quote"-\\slash\n雪🔐';
  private alias = '$${<TRANSPORT_CANARY>}';
  private headerSecret = 'TRANSPORT-API-KEY-CANARY';
  private upstream: Server;
  private proxy: GhostProxyServer;

  constructor() {
    this.vault.setManualSecret('TRANSPORT_CANARY', this.secret);
    this.vault.setManualSecret('TRANSPORT_API_KEY', this.headerSecret);
    this.upstream = createServer(this.handleUpstream);
    this.proxy = new GhostProxyServer(this.vault, { port: 0, host: '127.0.0.1' });
  }

  private handleUpstream = (request: IncomingMessage, response: ServerResponse): void => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      this.captures.push({ url: request.url || '', headers: request.headers, body });
      const path = new URL(request.url || '/', 'http://127.0.0.1').pathname;
      const result = path.endsWith('/messages')
        ? { type: 'message', id: this.alias, content: [{ type: 'text', text: this.alias }, { type: 'thinking', thinking: this.alias, signature: this.alias }] }
        : path.endsWith('/responses')
          ? { id: this.alias, object: 'response', output: [{ type: 'message', content: [{ type: 'output_text', text: this.alias }] }] }
          : path.includes('v1internal')
            ? { response: { candidates: [{ content: { parts: [{ text: this.alias }] } }], traceId: this.alias } }
            : path.includes('models/')
              ? { candidates: [{ content: { parts: [{ text: this.alias }] } }], modelVersion: this.alias }
              : { id: this.alias, model: this.alias, choices: [{ message: { role: 'assistant', content: this.alias, refusal: this.alias, reasoning_content: this.alias } }] };
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(result));
    });
  };

  private listen = async (server: Server): Promise<number> => {
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve, reject) => {
      server.once('listening', resolve);
      server.once('error', reject);
    });
    return (server.address() as any).port;
  };

  private check = (condition: boolean, label: string): void => {
    if (!condition) throw new Error('Protocol transport regression: ' + label);
  };

  private run = async (): Promise<void> => {
    const upstreamPort = await this.listen(this.upstream);
    const upstreamUrl = 'http://127.0.0.1:' + upstreamPort;
    const registry = new RouteRegistry(this.db);
    const cases = [
      { prefix: 'protocol-chat', path: '/v1/chat/completions', body: { model: 'chat-audit', messages: [{ role: 'user', content: this.secret }] }, verify: (body: any) => body.messages[0].content === this.alias },
      { prefix: 'protocol-anthropic', path: '/v1/messages', body: { model: 'claude-audit', system: this.secret, messages: [{ role: 'user', content: [{ type: 'text', text: this.secret }] }] }, verify: (body: any) => body.system === this.alias && body.messages[0].content[0].text === this.alias },
      { prefix: 'protocol-responses', path: '/v1/responses', body: { model: 'responses-audit', instructions: this.secret, input: [{ type: 'message', role: 'user', content: [{ type: 'input_text', text: this.secret }] }] }, verify: (body: any) => body.instructions === this.alias && body.input[0].content[0].text === this.alias },
      { prefix: 'protocol-gemini', path: '/v1beta/models/gemini-audit:generateContent', body: { contents: [{ role: 'user', parts: [{ text: this.secret }] }] }, verify: (body: any) => body.contents[0].parts[0].text === this.alias },
      { prefix: 'protocol-antigravity', path: '/v1internal:generateContent', body: { request: { contents: [{ role: 'user', parts: [{ text: this.secret }] }] }, requestId: this.alias }, verify: (body: any) => body.request.contents[0].parts[0].text === this.alias && body.requestId === this.alias },
    ];
    for (const item of cases) registry.createCustomRoute({ name: item.prefix, prefix: item.prefix, upstreamUrl });
    const proxyUrl = await this.proxy.listen();
    for (const item of cases) {
      const requestUrl = proxyUrl + '/' + item.prefix + item.path + '?credential=' + encodeURIComponent(this.secret);
      const response = await fetch(requestUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-api-key': this.headerSecret, authorization: 'Bearer synthetic-provider-credential' },
        body: JSON.stringify(item.body),
      });
      this.check(response.status === 200, item.prefix + ' response status');
      const result = await response.json() as any;
      const captured = this.captures.at(-1)!;
      const search = new URL(captured.url, 'http://127.0.0.1').searchParams;
      this.check(item.verify(captured.body), item.prefix + ' outbound targeted text masked');
      this.check(captured.headers['x-api-key'] === this.headerSecret, item.prefix + ' custom header preserved');
      this.check(captured.headers.authorization === 'Bearer synthetic-provider-credential', item.prefix + ' provider authorization preserved');
      this.check(search.get('credential') === this.secret, item.prefix + ' query preserved');
      if (item.prefix === 'protocol-chat') this.check(result.choices[0].message.content === this.secret && result.id === this.alias && result.model === this.alias, 'chat response targets content only');
      if (item.prefix === 'protocol-anthropic') this.check(result.content[0].text === this.secret && result.content[1].thinking === this.alias, 'anthropic response leaves thinking opaque');
      if (item.prefix === 'protocol-responses') this.check(result.output[0].content[0].text === this.secret && result.id === this.alias, 'responses output unmasks text only');
      if (item.prefix === 'protocol-gemini') this.check(result.candidates[0].content.parts[0].text === this.secret && result.modelVersion === this.alias, 'gemini response leaves model metadata exact');
      if (item.prefix === 'protocol-antigravity') this.check(result.response.candidates[0].content.parts[0].text === this.secret && result.response.traceId === this.alias, 'antigravity response envelope targets content only');
    }
    console.log('Protocol transport tests passed: five routes, JSON masking, headers/query pass through, response text unmasking.');
  };

  public runTests = async (): Promise<void> => {
    try { await this.run(); }
    finally {
      await this.proxy.close();
      if (this.upstream.listening) await new Promise<void>(resolve => this.upstream.close(() => resolve()));
      this.db.close();
    }
  };
}

new ProtocolTransportTests().runTests().catch(error => { console.error(error); process.exitCode = 1; });
