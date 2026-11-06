import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { VAULT_MCP_INSTRUCTIONS } from './mcp/instructions.js';

class McpHttpTests {
  private app = Fastify();
  private authToken = 'synthetic-local-access-token';
  private calls = 0;
  private drainOnCall = false;
  private draining?: Promise<void>;
  private provider = { listVariables: () => {
    this.calls++;
    if (this.drainOnCall) this.draining = this.endpoint.close();
    return { revision: 'one', variables: [{ name: 'BASE_URL', token: '$${<BASE_URL>}', source: 'fixed' as const }] };
  } };
  private endpoint = new VaultMcpEndpoint(this.app, this.provider, { version: '0.1.0-http-test', mcpToken: this.authToken });
  private url!: URL;
  private clients: Client[] = [];
  private transports: StreamableHTTPClientTransport[] = [];

  private client = async (): Promise<Client> => {
    const client = new Client({ name: 'independent-client-' + this.clients.length, version: '1.0.0' });
    const transport = new StreamableHTTPClientTransport(this.url, { requestInit: { headers: { authorization: 'Bearer ' + this.authToken } } });
    this.clients.push(client);
    this.transports.push(transport);
    await client.connect(transport);
    return client;
  };

  private independentClients = async (): Promise<void> => {
    const [first, second] = await Promise.all([this.client(), this.client()]);
    assert.equal(first.getInstructions(), VAULT_MCP_INSTRUCTIONS);
    assert.equal(second.getInstructions(), VAULT_MCP_INSTRUCTIONS);
    assert.equal(first.getServerVersion()?.version, '0.1.0-http-test');
    assert.deepEqual((await first.listTools()).tools.map(tool => tool.name), ['ghostvault_list_variables']);
    assert.equal((await first.callTool({ name: 'ghostvault_list_variables' })).isError, undefined);
    const calls = await Promise.all(Array.from({ length: 24 }, (_, index) => (index % 2 ? first : second).callTool({ name: 'ghostvault_list_variables', arguments: {} })));
    assert.equal(this.calls, 25);
    for (const result of calls) assert.deepEqual(result.structuredContent, { revision: 'one', variables: [{ name: 'BASE_URL', source: 'fixed' }] });
    assert.equal(this.endpoint.getActiveRequestCount(), 0);
    for (const transport of this.transports) assert.equal(transport.sessionId, undefined);
    await first.close();
    assert.equal((await second.callTool({ name: 'ghostvault_list_variables', arguments: {} })).isError, undefined);
    await second.close();
    const reconnected = await this.client();
    assert.equal((await reconnected.listTools()).tools.length, 1);
    await reconnected.close();
    assert.equal(this.endpoint.getActiveRequestCount(), 0);
  };

  private headers = (extra: Record<string, string> = {}) => ({
    authorization: 'Bearer ' + this.authToken,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...extra,
  });

  private rawPost = (headers: Record<string, string>): Promise<{ status: number; body: string }> => new Promise((resolve, reject) => {
    const request = httpRequest(this.url, { method: 'POST', headers }, response => {
      let body = '';
      response.setEncoding('utf8');
      response.on('data', chunk => { body += chunk; });
      response.on('end', () => resolve({ status: response.statusCode!, body }));
    });
    request.on('error', reject);
    request.end('{}');
  });

  private access = async (): Promise<void> => {
    for (const [index, headers] of [
      this.headers({ authorization: '' }),
      this.headers({ authorization: 'Bearer incorrect' }),
      this.headers({ origin: 'https://foreign.invalid' }),
      this.headers({ origin: 'null' }),
      this.headers({ origin: '' }),
      this.headers({ origin: this.url.origin }),
      this.headers({ origin: this.url.origin + '/' }),
      this.headers({ 'sec-fetch-site': 'cross-site' }),
      this.headers({ host: 'foreign.invalid:' + this.url.port }),
      this.headers({ host: 'localhost:1' }),
    ].entries()) {
      const response = await this.rawPost(headers);
      assert.equal(response.status, 403, 'Access rejection case ' + index);
      assert.deepEqual(JSON.parse(response.body), { error: 'MCP access denied' });
    }
    for (const method of ['GET', 'DELETE']) {
      const response = await fetch(this.url, { method, headers: this.headers() });
      assert.equal(response.status, 405);
      assert.equal(response.headers.get('allow'), 'POST');
      await response.text();
    }
    const malformed = await fetch(this.url, { method: 'POST', headers: this.headers(), body: '{"synthetic-secret":"not valid json' });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.text()).includes('synthetic-secret'), false);
    const nonRpc = await fetch(this.url, { method: 'POST', headers: this.headers(), body: '{"secret":"synthetic-hidden"}' });
    assert.equal(nonRpc.status, 400);
    assert.equal((await nonRpc.text()).includes('synthetic-hidden'), false);
    assert.equal(this.endpoint.getActiveRequestCount(), 0);
  };

  private disconnect = async (): Promise<void> => {
    await new Promise<void>((resolve, reject) => {
      const request = httpRequest(this.url, { method: 'POST', agent: false, headers: this.headers({ 'content-length': '5000' }) });
      request.on('error', error => (error as NodeJS.ErrnoException).code === 'ECONNRESET' ? resolve() : reject(error));
      request.on('socket', socket => socket.once('connect', () => {
        request.write('{"jsonrpc":"2.0",');
        request.destroy();
        resolve();
      }));
    });
    const afterAbort = await this.client();
    assert.equal((await afterAbort.listTools()).tools.length, 1);
    await afterAbort.close();
    assert.equal(this.endpoint.getActiveRequestCount(), 0);
  };

  public run = async (): Promise<void> => {
    this.endpoint.register();
    try {
      this.url = new URL('/mcp', await this.app.listen({ port: 0, host: '127.0.0.1' }));
      await this.independentClients();
      await this.access();
      await this.disconnect();
      const lastClient = await this.client();
      this.drainOnCall = true;
      assert.equal((await lastClient.callTool({ name: 'ghostvault_list_variables' })).isError, undefined);
      await this.draining;
      await this.endpoint.close();
      const stopped = await fetch(this.url, { method: 'POST', headers: this.headers(), body: '{}' });
      assert.equal(stopped.status, 503);
      await stopped.text();
      assert.equal(this.endpoint.getActiveRequestCount(), 0);
      console.log('MCP HTTP independent clients, access policy, reconnect, abort and close tests passed');
    } finally {
      await Promise.all(this.clients.map(client => client.close()));
      await this.app.close();
    }
  };
}

await new McpHttpTests().run();
