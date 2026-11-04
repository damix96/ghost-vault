import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { VariableApi } from './proxy/variable-api.js';
import { SseTransformer } from './proxy/sse-transformer.js';
import { SlidingStreamTransformer } from './proxy/sliding-buffer.js';

class MutableVariableTests {
  private db = new VaultDatabase(':memory:');
  private vault = new VaultStore(this.db);

  private updates = (): void => {
    const first = this.vault.setManualSecret('BASE_URL', 'synthetic:/old\\"😀', 'Endpoint');
    const originalForms = first.representations!;
    const before = this.vault.snapshot();
    const revision = this.vault.listVariables().revision;
    for (const value of ['synthetic-new', 'synthetic:/third\\"🙂', ' exact whitespace\r\n ']) {
      const current = this.vault.setManualSecret('BASE_URL', value, 'Endpoint');
      assert.equal(current.alias, first.alias);
      assert.equal(current.createdAt, first.createdAt);
      assert.equal(this.vault.unmaskInboundText(first.alias), value);
      assert.equal(this.vault.maskOutboundText(value), first.alias);
      assert.equal(this.vault.maskOutboundText(first.realValue), first.realValue);
      assert.equal(this.vault.listVariables().revision, revision);
      assert.deepEqual(current.representations!.map(form => form.alias), originalForms.map(form => form.alias));
      for (const form of current.representations!) {
        assert.equal(this.vault.unmaskInboundText(form.alias), form.value);
        assert.equal(this.vault.unmaskInboundText(this.vault.maskOutboundText(form.value)), form.value);
      }
      assert.equal(this.db.getVersions().length, 0);
    }
    assert.equal(before.unmaskInboundText(first.alias), first.realValue);
    assert.throws(() => this.vault.setManualSecret('base_url', 'synthetic-lowercase'));
    assert.throws(() => this.vault.setManualSecret(' BASE_URL ', 'synthetic-trim'));
    assert.throws(() => this.vault.setManualSecret('EMPTY', ''));
  };

  private rollback = (): void => {
    const first = this.vault.setManualSecret('ATOMIC', 'synthetic-old');
    const before = this.vault.snapshot();
    const rows = this.db.getSecrets();
    const catalog = this.vault.listVariables();
    const persist = this.db.upsertSecret;
    this.db.upsertSecret = row => { persist(row); throw new Error('synthetic failure after write'); };
    try {
      assert.throws(() => this.vault.setManualSecret('ATOMIC', 'synthetic:/new"'), /after write/);
      assert.throws(() => this.vault.renameManualSecret('ATOMIC', 'ATOMIC_RENAMED'), /after write/);
      assert.throws(() => this.vault.setManualSecret('ATOMIC_CREATED', 'synthetic-created'), /after write/);
    } finally { this.db.upsertSecret = persist; }
    assert.equal(this.vault.unmaskInboundText(first.alias), before.unmaskInboundText(first.alias));
    assert.deepEqual(this.db.getSecrets(), rows);
    assert.deepEqual(this.vault.listVariables(), catalog);
    assert.equal(this.db.aliases.owner('$${<ATOMIC_RENAMED>}'), undefined);
    assert.equal(this.db.manualBindings.has('ATOMIC_RENAMED'), false);
    assert.equal(this.db.aliases.owner('$${<ATOMIC_CREATED>}'), undefined);
    const remove = this.db.deleteSecret;
    this.db.deleteSecret = key => { remove(key); throw new Error('synthetic delete failure'); };
    try { assert.throws(() => this.vault.renameManualSecret('ATOMIC', 'ATOMIC_RENAMED'), /delete failure/); }
    finally { this.db.deleteSecret = remove; }
    assert.deepEqual(this.db.getSecrets(), rows);
    assert.deepEqual(this.vault.listVariables(), catalog);
    assert.equal(this.db.aliases.owner('$${<ATOMIC_RENAMED>}'), undefined);
  };

  private catalog = (): void => {
    const hidden = this.vault.setManualSecret('HIDDEN', 'synthetic-hidden');
    hidden.maskInAi = false;
    const automatic = this.vault.registerAutoDetectedSecret('synthetic-auto-only', 'catalog');
    const current = this.vault.listVariables();
    assert.ok(current.variables.every(variable => variable.source === 'fixed'));
    assert.ok(!JSON.stringify(current).includes('synthetic'));
    assert.ok(!current.variables.some(variable => variable.name === 'HIDDEN'));
    assert.deepEqual(current.variables.map(variable => variable.name), current.variables.map(variable => variable.name).sort());
    const included = this.vault.listVariables({ includeAutomatic: true });
    assert.ok(included.variables.some(variable => variable.name === automatic.key && variable.source === 'automatic'));
    const filtered = this.vault.listVariables({ names: ['BASE_URL', 'BASE_URL', 'UNKNOWN'] });
    assert.equal(filtered.revision, current.revision);
    assert.deepEqual(filtered.variables.map(variable => variable.name), ['BASE_URL']);
    assert.deepEqual(this.vault.listVariables({ names: [] }).variables, []);
    const before = current.revision;
    this.vault.setManualSecret('BASE_URL', 'synthetic-description-value', 'Changed endpoint');
    assert.notEqual(this.vault.listVariables().revision, before);
    assert.deepEqual(Object.keys(filtered.variables[0]).sort(), ['description', 'name', 'source', 'token']);
  };

  private streams = (): void => {
    const first = this.vault.setManualSecret('STREAM', 'synthetic:/stream-old');
    const before = this.vault.snapshot();
    const firstSse = new SseTransformer(before, 32, () => {});
    const event = (content: string): string => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content } }] }) + '\n\n';
    let output = firstSse.push(event(first.alias.slice(0, 7)));
    const updated = this.vault.setManualSecret('STREAM', 'synthetic:/stream-new');
    output += firstSse.push(event(first.alias.slice(7)) + 'data: [DONE]\n\n');
    assert.ok(output.includes(first.realValue));
    assert.ok(!output.includes(updated.realValue));
    const next = new SseTransformer(this.vault.snapshot(), 32, () => {});
    assert.ok(next.push(event(first.alias) + 'data: [DONE]\n\n').includes(updated.realValue));
    for (const form of updated.representations!) {
      for (let offset = 0; offset <= form.alias.length; offset++) {
        const stream = new SlidingStreamTransformer(this.vault.getInboundReplacements());
        assert.equal(stream.push(form.alias.slice(0, offset)) + stream.push(form.alias.slice(offset)) + stream.flush(), form.value);
      }
    }
    assert.equal(this.vault.unmaskInboundText('$${<UNKNOWN>}'), '$${<UNKNOWN>}');
    assert.equal(this.vault.unmaskInboundText('$${<STREAM'), '$${<STREAM');
    this.vault.renameManualSecret('STREAM', 'STREAM_RENAMED');
    assert.equal(this.vault.unmaskInboundText(first.alias), first.alias);
    assert.equal(before.unmaskInboundText(first.alias), first.realValue);
    const renaming = this.vault.setManualSecret('RENAME_STREAM', 'synthetic-renaming');
    const duringRename = new SseTransformer(this.vault.snapshot(), 32, () => {});
    let renamedOutput = duringRename.push(event(renaming.alias.slice(0, 9)));
    const renamed = this.vault.renameManualSecret('RENAME_STREAM', 'RENAMED_STREAM')!;
    renamedOutput += duringRename.push(event(renaming.alias.slice(9)) + 'data: [DONE]\n\n');
    assert.ok(renamedOutput.includes(renaming.realValue));
    assert.ok(!renamedOutput.includes(renaming.alias));
    const afterRename = new SseTransformer(this.vault.snapshot(), 32, () => {});
    const freshOutput = afterRename.push(event(renaming.alias + '|' + renamed.alias) + 'data: [DONE]\n\n');
    assert.ok(freshOutput.includes(renaming.alias));
    assert.ok(freshOutput.includes(renamed.realValue));
    assert.ok(!freshOutput.includes(renamed.alias));
  };

  private api = async (): Promise<void> => {
    const app = Fastify();
    new VariableApi(app, this.vault).register();
    try {
      const created = await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key: 'API', realValue: 'synthetic:/api', description: 'API description' } });
      assert.equal(created.statusCode, 200);
      const rename = (key: string, name: string) => app.inject({ method: 'PATCH', url: '/api/vault/secret/' + key, payload: { name } });
      assert.equal((await rename('API', 'lower')).statusCode, 400);
      assert.equal((await rename('API', ' API ')).statusCode, 400);
      assert.equal((await rename('MISSING', 'NEW_NAME')).statusCode, 404);
      assert.equal((await rename('API', 'BASE_URL')).statusCode, 409);
      assert.equal((await rename('API', 'API__GV_URL')).statusCode, 409);
      assert.equal((await rename('API', 'API')).json().secret.alias, '$${<API>}');
      const renamed = await rename('API', 'API_RENAMED');
      assert.equal(renamed.statusCode, 200);
      assert.equal(renamed.json().secret.realValue, created.json().secret.realValue);
      assert.equal(renamed.json().secret.description, 'API description');
      assert.equal(renamed.json().secret.createdAt, created.json().secret.createdAt);
      assert.equal(renamed.json().secret.alias, '$${<API_RENAMED>}');
      assert.equal(this.vault.unmaskInboundText('$${<API>}'), '$${<API>}');
      assert.equal(this.vault.maskOutboundText('synthetic:/api'), '$${<API_RENAMED>}');
      const returned = await rename('API_RENAMED', 'API');
      assert.equal(returned.statusCode, 200);
      assert.equal(returned.json().secret.alias, '$${<API>}');
      assert.equal(this.vault.unmaskInboundText('$${<API_RENAMED>}'), '$${<API_RENAMED>}');
      assert.equal((await rename('API', 'API_RENAMED')).statusCode, 200);
      const deleted = await app.inject({ method: 'DELETE', url: '/api/vault/secret/API_RENAMED' });
      assert.equal(deleted.statusCode, 200);
      assert.equal(this.vault.unmaskInboundText('$${<API_RENAMED>}'), '$${<API_RENAMED>}');
      assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key: 'API', realValue: 'synthetic-reuse-original' } })).statusCode, 200);
      assert.equal((await app.inject({ method: 'POST', url: '/api/vault/secret', payload: { key: 'API_RENAMED', realValue: 'synthetic-reuse-renamed' } })).statusCode, 200);
      assert.equal(this.vault.unmaskInboundText('$${<API>}'), 'synthetic-reuse-original');
      assert.equal(this.vault.unmaskInboundText('$${<API_RENAMED>}'), 'synthetic-reuse-renamed');
    } finally { await app.close(); }
  };

  public run = async (): Promise<void> => {
    try {
      this.updates(); this.rollback(); this.catalog(); this.streams(); await this.api();
      console.log('PASS mutable variables: stable tokens and encodings, rollback, catalog, split streams, rename API and manual name reuse');
    } finally { this.db.close(); }
  };
}

new MutableVariableTests().run().catch(error => { console.error(error); process.exitCode = 1; });
