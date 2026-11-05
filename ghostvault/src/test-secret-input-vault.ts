import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import Fastify from 'fastify';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';
import { VaultMcpEndpoint } from './mcp/endpoint.js';
import { SecretInputBrowser } from './secret-input/browser-launcher.js';
import { SecretStorageError } from './security/secret-provider.js';
import { SecretInputView } from './secret-input/schema.js';

class SecretInputVaultTests {
  private directory: string;
  private db: VaultDatabase;
  private vault: VaultStore;
  private proxy: GhostProxyServer;
  private endpoint: VaultMcpEndpoint;
  private token = randomUUID();
  private launches: string[] = [];
  private clients: Client[] = [];
  private address = '';
  private transcript: unknown[] = [];
  private first = 'synthetic-native-first-秘密';
  private second = 'synthetic-native-second-value';
  private replacement = 'synthetic-native-updated-value';

  constructor() {
    const root = path.resolve('.cache/secret-intake-fixtures');
    mkdirSync(root, { recursive: true });
    this.directory = mkdtempSync(path.join(root, 'vault-'));
    this.db = new VaultDatabase(path.join(this.directory, 'vault.db'));
    this.vault = new VaultStore(this.db);
    this.proxy = new GhostProxyServer(this.vault, { host: '127.0.0.1', port: 0 }, undefined, new SecretInputBrowser('win32', async command => { this.launches.push(command.env.GHOSTVAULT_INPUT_URL!); return true; }));
    this.endpoint = new VaultMcpEndpoint(this.proxy.getApp(), this.vault, { version: '0.2.0-test', mcpToken: this.token });
    this.endpoint.register();
  }

  private post = async (route: string, body: unknown, token?: string) => {
    const response = await fetch(this.address + route, { method: 'POST', headers: { origin: this.address, 'content-type': 'application/json', 'x-ghostvault-input': '1', ...(token ? { authorization: 'Intake ' + token } : {}) }, body: JSON.stringify(body) });
    const data = await response.json() as any;
    return { status: response.status, data };
  };
  private call = async (index: number, name: string, args: Record<string, unknown>) => {
    const result = await this.clients[index].callTool({ name, arguments: args });
    this.transcript.push(result);
    return result;
  };
  private form = async (operation: 'new' | 'update', names: string[]) => {
    const result = await this.call(0, 'ghostvault_request_secret_input', { operation, names, idempotencyKey: randomUUID() });
    assert.equal(result.isError, undefined);
    const view = result.structuredContent as SecretInputView;
    const session = await this.post('/api/secret-input/session', { requestId: view.requestId });
    assert.equal(session.status, 200);
    return { id: view.requestId, token: session.data.formToken as string };
  };
  private submit = (form: { id: string; token: string }, values: Array<{ name: string; value: string }>, submissionId = randomUUID()) => this.post('/api/secret-input/requests/' + form.id + '/submit', { submissionId, values }, form.token);

  private createAndUpdate = async (): Promise<void> => {
    const form = await this.form('new', ['FIRST', 'SECOND']);
    assert.equal(new URL(this.launches[0]).origin, this.address);
    const values = [{ name: 'FIRST', value: this.first }, { name: 'SECOND', value: this.second }];
    const submissionId = randomUUID();
    const submitted = await this.submit(form, values, submissionId);
    assert.equal(submitted.status, 200);
    assert.equal(submitted.data.state, 'completed');
    assert.equal(this.vault.unmaskInboundText('$${<FIRST>}'), this.first);
    const revisions = this.vault.captureSecretTargets(['FIRST', 'SECOND']);
    assert.deepEqual((await this.submit(form, values, submissionId)).data, submitted.data);
    assert.deepEqual(this.vault.captureSecretTargets(['FIRST', 'SECOND']), revisions);
    assert.equal(((await this.call(1, 'ghostvault_secret_input_status', { requestId: form.id })).structuredContent as SecretInputView).state, 'completed');
    const before = await this.call(1, 'ghostvault_list_variables', {});
    const update = await this.form('update', ['FIRST']);
    assert.equal((await this.submit(update, [{ name: 'FIRST', value: this.replacement }])).status, 200);
    const after = await this.call(1, 'ghostvault_list_variables', {});
    assert.deepEqual(after.structuredContent, before.structuredContent);
    assert.equal(this.vault.unmaskInboundText('$${<FIRST>}'), this.replacement);
    this.vault.setManualSecret('ORDINARY', 'synthetic-ordinary-old');
    const conversion = await this.form('update', ['ORDINARY']);
    assert.equal((await this.submit(conversion, [{ name: 'ORDINARY', value: 'synthetic-protected-converted' }])).status, 200);
    assert.equal(this.vault.getManualSecrets().find(entry => entry.key === 'ORDINARY')?.isSecret, true);
  };

  private conflict = async (): Promise<void> => {
    const form = await this.form('update', ['FIRST', 'SECOND']);
    this.vault.setManualSecret('FIRST', 'synthetic-concurrent-value', undefined, true);
    const response = await this.submit(form, [{ name: 'FIRST', value: 'not-saved-first' }, { name: 'SECOND', value: 'not-saved-second' }]);
    assert.equal(response.status, 409);
    assert.equal(response.data.error.code, 'REVISION_CONFLICT');
    assert.equal(response.data.request.state, 'failed');
    assert.equal(this.vault.unmaskInboundText('$${<SECOND>}'), this.second);
    this.vault.setAutoSecret('AUTO_OWNED', 'synthetic-runtime-auto');
    const collision = await this.form('new', ['AUTO_OWNED', 'NEW_VALID']);
    const failed = await this.submit(collision, [{ name: 'AUTO_OWNED', value: 'not-saved-auto' }, { name: 'NEW_VALID', value: 'not-saved-valid' }]);
    assert.equal(failed.status, 409);
    assert.equal(failed.data.error.code, 'NAME_CONFLICT');
    assert.equal(this.vault.getManualSecrets().some(entry => entry.key === 'NEW_VALID'), false);
  };

  private proxyFlow = async (): Promise<void> => {
    const upstream = Fastify();
    let seen = '';
    upstream.post('/v1/chat/completions', async request => { seen = JSON.stringify(request.body); return { choices: [{ message: { role: 'assistant', content: '$${<SECOND>}' } }] }; });
    const target = await upstream.listen({ host: '127.0.0.1', port: 0 });
    try {
      assert.equal((await this.post('/api/routes', { name: 'Synthetic', prefix: 'fixture', upstreamUrl: target })).status, 201);
      const response = await fetch(this.address + '/fixture/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'synthetic', messages: [{ role: 'user', content: this.second }] }) });
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.equal(seen.includes(this.second), false);
      assert.equal(seen.includes('$${<SECOND>}'), true);
      assert.equal(body.includes(this.second), true);
      for (const route of ['/api/vault', '/api/export', '/api/hooks/context', '/api/sessions']) {
        const publicResponse = await fetch(this.address + route);
        assert.equal(publicResponse.status, 200);
        const text = await publicResponse.text();
        for (const secret of [this.first, this.second, this.replacement]) assert.equal(text.includes(secret), false, route);
      }
    } finally { await upstream.close(); }
  };

  public run = async (): Promise<void> => {
    this.address = await this.proxy.listen();
    try {
      for (let index = 0; index < 2; index++) {
        const client = new Client({ name: 'real-vault-' + index, version: 'test' });
        this.clients.push(client);
        await client.connect(new StreamableHTTPClientTransport(new URL('/mcp', this.address), { requestInit: { headers: { authorization: 'Bearer ' + this.token } } }));
      }
      await this.createAndUpdate();
      await this.conflict();
      await this.proxyFlow();
      for (const secret of [this.first, this.second, this.replacement]) for (const variant of Object.values(VaultStore.computeVariants(secret))) assert.equal(JSON.stringify(this.transcript).includes(variant), false);
    } finally {
      await Promise.all(this.clients.map(client => client.close()));
      await this.endpoint.close();
      await this.proxy.close();
      this.db.close();
    }
    const reopened = new VaultDatabase(path.join(this.directory, 'vault.db'));
    try {
      const vault = new VaultStore(reopened);
      assert.equal(vault.unmaskInboundText('$${<SECOND>}'), this.second);
      assert.equal(vault.unmaskInboundText('$${<FIRST>}'), 'synthetic-concurrent-value');
      for (const name of ['vault.db', 'vault.db-wal']) if (existsSync(path.join(this.directory, name))) {
        const bytes = readFileSync(path.join(this.directory, name));
        for (const value of [this.first, this.second, this.replacement]) assert.equal(bytes.includes(Buffer.from(value)), false);
      }
    } finally { reopened.close(); }
    const unavailableDb = new VaultDatabase(':memory:', { id: 'windows-dpapi', encrypt: () => { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }, decrypt: () => { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); } });
    const unavailable = new GhostProxyServer(new VaultStore(unavailableDb), { host: '127.0.0.1', port: 0 });
    try {
      this.address = await unavailable.listen();
      const session = await this.post('/api/secret-input/session', {});
      const created = await this.post('/api/secret-input/requests', { operation: 'new', names: ['UNAVAILABLE'], idempotencyKey: randomUUID() }, session.data.formToken);
      const failed = await this.submit({ id: created.data.requestId, token: session.data.formToken }, [{ name: 'UNAVAILABLE', value: 'synthetic-unavailable' }]);
      assert.equal(failed.status, 503);
      assert.equal(failed.data.error.code, 'PROVIDER_UNAVAILABLE');
      assert.equal(unavailable.getVault().getManualSecrets().length, 0);
    } finally { await unavailable.close(); unavailableDb.close(); }
    console.log('Real protected DB/HTTP/MCP/two clients/CAS/atomicity/proxy/restart/provider PASS');
  };
}

await new SecretInputVaultTests().run();
