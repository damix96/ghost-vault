import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

export class SecretProxyVerifier {
  constructor(vault) {
    this.vault = vault;
    this.received = [];
  }

  receive = async (request, response) => {
    try {
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      const content = body.messages[0].content;
      assert.equal(typeof content, 'string');
      this.received.push(content);
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ id: 'release-composite', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }] }));
    } catch {
      response.writeHead(500, { 'content-type': 'application/json' });
      response.end('{}');
    }
  };

  run = async () => {
    const publicName = this.vault.prefix + '_PUBLIC';
    const compositeName = this.vault.prefix + '_COMPOSITE';
    const publicToken = this.vault.token(publicName);
    const publicValue = 'ordinary-release-' + randomUUID();
    const compositeValue = 'synthetic-composite-' + randomUUID() + publicToken + '-ending';
    this.vault.values.push(compositeValue);
    const ordinary = await this.vault.json('/api/vault/secret', { key: publicName, realValue: publicValue });
    assert.equal(ordinary.status, 200);
    await this.vault.submit('new', [compositeName], [compositeValue]);
    const upstream = createServer(this.receive);
    await new Promise((resolve, reject) => {
      upstream.once('error', reject);
      upstream.listen(0, '127.0.0.1', resolve);
    });
    try {
      const prefix = 'release-' + randomUUID();
      const route = await this.vault.json('/api/routes', { name: 'Installed composite check', prefix, upstreamUrl: 'http://127.0.0.1:' + upstream.address().port });
      assert.equal(route.status, 201);
      const cases = [
        { input: 'solo ' + publicToken + ' composite ' + compositeValue, masked: 'solo ' + publicToken + ' composite ' + this.vault.token(compositeName), restored: 'solo ' + publicValue + ' composite ' + compositeValue },
        { input: 'encoded ' + encodeURIComponent(compositeValue), masked: 'encoded ' + this.vault.token(compositeName + '__GV_URL'), restored: 'encoded ' + encodeURIComponent(compositeValue) },
      ];
      for (const [index, fixture] of cases.entries()) {
        const reply = await this.vault.json('/' + prefix + '/v1/chat/completions', { model: 'release-fixture', messages: [{ role: 'user', content: fixture.input }] });
        assert.equal(reply.status, 200);
        assert.equal(this.received[index], fixture.masked, 'Installed outbound composite masking failed');
        assert.equal(reply.body.choices[0].message.content, fixture.restored, 'Installed restoration rescanned emitted secret content');
      }
      assert.equal(this.received.length, cases.length);
    } finally {
      await new Promise((resolve, reject) => {
        upstream.close(error => error ? reject(error) : resolve());
        upstream.closeAllConnections();
      });
    }
  };
}
