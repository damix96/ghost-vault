import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { SecretProxyVerifier } from './verify-secret-proxy.mjs';

export class SecretReleaseVerifier {
  constructor(base, client) {
    this.base = base;
    this.client = client;
    this.prefix = 'RELEASE_' + randomUUID().replaceAll('-', '_').toUpperCase();
    this.names = ['FIRST', 'SECOND', 'ORDINARY'].map(suffix => this.prefix + '_' + suffix);
    this.values = ['first-秘密\r\nline', 'second', 'ordinary-before', 'replacement'].map(value => 'synthetic-secret-release-' + randomUUID() + '-' + value);
  }

  token = name => '$${<' + name + '>}';
  json = async (route, body, token) => {
    const response = await fetch(this.base + route, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { origin: this.base, 'content-type': 'application/json', 'x-ghostvault-input': '1', ...(token ? { authorization: 'Intake ' + token } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(5000),
    });
    return { status: response.status, body: await response.json() };
  };

  hidden = value => {
    const text = JSON.stringify(value);
    for (const secret of this.values) for (const form of [secret, JSON.stringify(secret).slice(1, -1), encodeURIComponent(secret), Buffer.from(secret).toString('base64')]) assert.equal(text.includes(form), false, 'Protected value appeared in release control output');
  };

  submit = async (operation, names, values) => {
    const session = await this.json('/api/secret-input/session', {});
    assert.equal(session.status, 200);
    assert.equal(typeof session.body.formToken, 'string');
    const created = await this.json('/api/secret-input/requests', { operation, names, idempotencyKey: randomUUID() }, session.body.formToken);
    assert.equal(created.status, 200);
    const completed = await this.json('/api/secret-input/requests/' + created.body.requestId + '/submit', { submissionId: randomUUID(), values: names.map((name, index) => ({ name, value: values[index] })) }, session.body.formToken);
    assert.equal(completed.status, 200);
    assert.equal(completed.body.state, 'completed');
    assert.deepEqual(completed.body.result, names.map(name => ({ name, token: this.token(name) })));
    const observed = await this.client.callTool({ name: 'ghostvault_secret_input_status', arguments: { requestId: created.body.requestId } });
    assert.equal(observed.isError, undefined);
    assert.equal(observed.structuredContent.state, 'completed');
    this.hidden([created.body, completed.body, observed]);
    assert.equal(JSON.stringify(observed).includes(session.body.formToken), false);
  };

  run = async html => {
    const tools = (await this.client.listTools()).tools.map(tool => tool.name);
    for (const name of ['ghostvault_request_secret_input', 'ghostvault_secret_input_status', 'ghostvault_cancel_secret_input']) assert.ok(tools.includes(name), 'Installed secret input tool absent');
    for (const route of ['/vault-secret/new', '/vault-secret/update?secrets=' + this.names[0]]) {
      const page = await fetch(this.base + route, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      assert.equal(page.status, 200);
      assert.equal(page.headers.get('cache-control'), 'no-store');
      assert.equal(await page.text(), html);
    }
    await this.submit('new', this.names.slice(0, 2), this.values.slice(0, 2));
    const duplicate = await this.json('/api/vault/secret', { key: this.names[0], realValue: 'synthetic-not-written', isSecret: true, operation: 'create' });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'SECRET_ALREADY_EXISTS');
    const ordinary = await this.json('/api/vault/secret', { key: this.names[2], realValue: this.values[2] });
    assert.equal(ordinary.status, 200);
    await this.submit('update', [this.names[0], this.names[2]], [this.values[3], this.values[3]]);
    const catalog = await this.client.callTool({ name: 'ghostvault_list_variables', arguments: { names: this.names } });
    assert.equal(catalog.isError, undefined);
    assert.equal(catalog.structuredContent.variables.length, this.names.length);
    for (const item of catalog.structuredContent.variables) assert.equal(item.token, this.token(item.name));
    this.hidden(catalog);
    await new SecretProxyVerifier(this).run();
    for (const route of ['/api/vault', '/api/export?group=secrets', '/api/sessions']) {
      const response = await this.json(route);
      assert.equal(response.status, 200);
      this.hidden(response.body);
    }
  };

  verifyFiles = file => {
    assert.ok(existsSync(file), 'Installed runtime did not create the isolated vault database');
    for (const candidate of [file, file + '-wal']) if (existsSync(candidate)) {
      const bytes = readFileSync(candidate);
      for (const value of this.values) for (const form of [value, JSON.stringify(value).slice(1, -1), encodeURIComponent(value), Buffer.from(value).toString('base64')]) assert.equal(bytes.includes(Buffer.from(form)), false, 'Synthetic protected canary remained in installed DB/WAL');
    }
  };
}
