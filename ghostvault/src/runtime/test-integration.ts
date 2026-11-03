import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeLauncher } from './launcher.js';
import { RuntimeCredentials } from './credentials.js';

class RuntimeIntegrationTests {
  public run = async (): Promise<void> => {
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-integration-'));
    const portProbe = createServer();
    await new Promise<void>(resolve => portProbe.listen(0, '127.0.0.1', resolve));
    const port = (portProbe.address() as { port: number }).port;
    await new Promise<void>(resolve => portProbe.close(() => resolve()));
    const settings = new RuntimeSettings({ dataDir: path.join(root, 'data'), port });
    const launcher = new RuntimeLauncher(settings);
    const entry = fileURLToPath(new URL('./cli.js', import.meta.url));
    const clients: Client[] = [];
    const upstreamBodies: string[] = [];
    const upstream = createServer(async (request, response) => {
      let body = '';
      for await (const chunk of request) body += chunk;
      upstreamBodies.push(body);
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '$${<BASE_URL>}' } }] }));
    });
    await new Promise<void>(resolve => upstream.listen(0, '127.0.0.1', resolve));
    const admin = async (route: string, body: unknown, method = 'POST'): Promise<any> => {
      const response = await fetch(settings.url + route, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      assert.ok(response.status === 200 || response.status === 201);
      return response.json();
    };
    try {
      const transports = [0, 1].map(() => new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp-bridge', ...settings.arguments()], cwd: root, stderr: 'pipe' }));
      let errors = '';
      for (const transport of transports) transport.stderr?.on('data', data => { errors += String(data); });
      await Promise.all(transports.map(async (transport, index) => {
        const client = new Client({ name: 'stdio-integration-' + index, version: '1.0.0' });
        clients.push(client);
        await client.connect(transport);
      }));
      const identity = (await launcher.status())!;
      assert.equal(identity.state, 'ready');
      assert.notEqual(identity.pid, transports[0].pid);
      assert.notEqual(identity.pid, transports[1].pid);
      const direct = new Client({ name: 'http-integration', version: '1.0.0' });
      clients.push(direct);
      await direct.connect(new StreamableHTTPClientTransport(new URL(settings.url + '/mcp'), { requestInit: { headers: { authorization: 'Bearer ' + new RuntimeCredentials(settings).readMcpToken() } } }));
      assert.ok(direct.getInstructions()?.includes('$${<NAME>}'));
      assert.equal(clients[0].getInstructions(), direct.getInstructions());
      assert.equal(clients[1].getInstructions(), direct.getInstructions());
      assert.equal((await direct.listTools()).tools[0].name, 'ghostvault_list_variables');
      assert.equal((await fetch(settings.url + '/mcp', { method: 'POST' })).status, 403);
      const initial = await admin('/api/vault/secret', { key: 'BASE_URL', realValue: 'synthetic-before-value', description: 'Service endpoint' });
      assert.equal(initial.secret.alias, '$${<BASE_URL>}');
      const catalog = await clients[0].callTool({ name: 'ghostvault_list_variables', arguments: {} });
      assert.equal(JSON.stringify(catalog).includes('synthetic-before-value'), false);
      assert.ok(JSON.stringify(catalog).includes('$${<BASE_URL>}'));
      await admin('/api/vault/secret', { key: 'BASE_URL', realValue: 'synthetic-after-value', description: 'Service endpoint' });
      const updated = await clients[1].callTool({ name: 'ghostvault_list_variables', arguments: {} });
      assert.deepEqual(updated, catalog);
      const upstreamUrl = 'http://127.0.0.1:' + (upstream.address() as { port: number }).port;
      await admin('/api/routes', { name: 'Synthetic upstream', prefix: 'fixture', upstreamUrl });
      const proxyResponse = await fetch(settings.url + '/fixture/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: 'synthetic-after-value' }] }) });
      assert.equal(proxyResponse.status, 200);
      const body = await proxyResponse.text();
      assert.equal(body.includes('synthetic-after-value'), true);
      assert.equal(body.includes('synthetic-before-value'), false);
      assert.equal(upstreamBodies.length, 1);
      assert.equal(upstreamBodies[0].includes('synthetic-after-value'), false);
      assert.equal(upstreamBodies[0].includes('$${<BASE_URL>}'), true);
      await clients[0].close();
      await clients[1].close();
      assert.equal((await launcher.status())?.instanceId, identity.instanceId);
      assert.equal(errors.includes('bridge connection failed'), false, errors);
      await direct.close();
      await launcher.stop();
      assert.equal(await launcher.status(), undefined);
      console.log('PASS integration: stdio first start, two bridge clients/one runtime, HTTP auth, initialize instructions, live catalog, stable-token proxy roundtrip, client-independent lifetime');
    } finally {
      await Promise.allSettled(clients.map(client => client.close()));
      await launcher.stop().catch(() => {});
      await new Promise<void>(resolve => upstream.close(() => resolve()));
      rmSync(root, { recursive: true, force: true });
    }
  };
}

await new RuntimeIntegrationTests().run();
