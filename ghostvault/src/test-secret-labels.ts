import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import Fastify from 'fastify';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { LabelTemplate } from './vault/label-template.js';
import { PatternEngine } from './vault/pattern-engine.js';
import { PatternEditorApi } from './proxy/pattern-editor-api.js';
import { RulePreviewApi } from './proxy/rule-preview-api.js';
import { SlidingStreamTransformer } from './proxy/sliding-buffer.js';
import { SseTransformer } from './proxy/sse-transformer.js';
import { RuntimeSessions } from './proxy/runtime-sessions.js';
import { GhostProxyServer } from './proxy/server.js';
import { HookManager } from './hooks/manager.js';

class SecretLabelTests {
  private directory = mkdtempSync(join(tmpdir(), 'ghostvault-label-tests-'));
  private path = join(this.directory, 'vault.db');
  private db = new VaultDatabase(this.path);
  private vault = new VaultStore(this.db);

  private templates = (): void => {
    const pattern = '(?<protocol>postgres):(?<optional>x)?(?<empty>)(.+)';
    const match = [...'postgres:synthetic'.matchAll(new RegExp(pattern, 'gi'))][0];
    LabelTemplate.validate(pattern, 'DB_HUB_$protocol_$1');
    assert.equal(LabelTemplate.prefix('uri', 'DB_HUB_$protocol_$1', match), 'DB_HUB_POSTGRES_POSTGRES');
    assert.equal(LabelTemplate.prefix('uri', '${optional}_${empty}_$4_$$', match), 'NA__SYNTHETIC__');
    assert.equal(LabelTemplate.prefix('uri', '$1', /(.+)/.exec('пароль / a:b')!), '_________A_B');
    assert.equal(LabelTemplate.prefix('uri', '$1', /(.+)/.exec('$1')!), '_1');
    assert.equal(LabelTemplate.prefix('uri', '$1', /(a)+/.exec('aaa')!), 'A');
    LabelTemplate.validate('(?<group_name>x)', '${group_name}');
    for (const template of ['$0', '$99', '$unknown', '${missing}', '$', '${', '']) assert.throws(() => LabelTemplate.validate(pattern, template));
    assert.equal(LabelTemplate.prefix('uri', 'a'.repeat(200)).length, 96);
    const engine = new PatternEngine(this.db);
    for (const row of engine.getPatterns()) engine.deletePattern(row.id);
    const rule = engine.addPattern('template', '(?<protocol>postgres):([^ ]+)', 'uri', 'DB_HUB_$protocol_$1')!;
    engine.scanAndAutoDetect('postgres:synthetic-db', (value, type, prefix) => this.vault.registerAutoDetectedSecret(value, type, prefix));
    const entry = this.vault.findByValue('postgres:synthetic-db')!;
    assert.match(entry.key, /^DB_HUB_POSTGRES_POSTGRES_[A-F0-9]{12}$/);
    assert.equal(this.vault.unmaskInboundText(this.vault.maskOutboundText('postgres:synthetic-db')), 'postgres:synthetic-db');
    engine.updatePattern(rule.id, { ...rule, label_template: 'CHANGED_$1' });
    engine.scanAndAutoDetect('postgres:synthetic-db', (value, type, prefix) => this.vault.registerAutoDetectedSecret(value, type, prefix));
    assert.equal(this.vault.findByValue('postgres:synthetic-db')!.alias, entry.alias);
  };

  private allocation = (): void => {
    const random = this.db.aliases.randomSuffix;
    this.db.aliases.randomSuffix = () => 'AAAAAAAAAAAA';
    const first = this.vault.registerAutoDetectedSecret('synthetic-first', 'collision');
    assert.throws(() => this.vault.registerAutoDetectedSecret('synthetic-second', 'collision'), /уникальную/);
    assert.equal(this.vault.unmaskInboundText(first.alias), first.realValue);
    let calls = 0;
    this.db.aliases.randomSuffix = () => calls++ ? 'BBBBBBBBBBBB' : 'AAAAAAAAAAAA';
    const second = this.vault.registerAutoDetectedSecret('synthetic-second', 'collision');
    assert.notEqual(second.alias, first.alias);
    assert.equal(calls, 2);
    assert.throws(() => this.vault.setManualSecret(first.key, 'synthetic-other'), /автосекрету/);
    const manual = this.vault.setManualSecret('RESERVED', 'synthetic:/reserved');
    const encoded = this.vault.getSecretRepresentations(manual).find(form => form.value === encodeURIComponent(manual.realValue))!;
    assert.throws(() => this.vault.setManualSecret(encoded.alias.slice(4, -2), 'synthetic-collision'), /использовалось/);
    assert.equal(this.vault.unmaskInboundText(encoded.alias), encodeURIComponent(manual.realValue));
    this.vault.setManualSecret('PREFIX__GV_URL', 'synthetic-reserved-alias');
    const prefixed = this.vault.setManualSecret('PREFIX', 'synthetic:/prefix');
    assert.notEqual(this.vault.getSecretRepresentations(prefixed).find(form => form.value === encodeURIComponent(prefixed.realValue))!.alias, '$${<PREFIX__GV_URL>}');
    this.db.aliases.randomSuffix = random;
    const persist = this.db.upsertSecret;
    this.db.upsertSecret = () => { throw new Error('synthetic database failure'); };
    assert.throws(() => this.vault.setManualSecret('DB_FAILURE', 'synthetic-db-failure'), /database failure/);
    assert.equal(this.db.aliases.owner('$${<DB_FAILURE>}'), undefined);
    assert.equal(this.vault.getManualSecrets().some(entry => entry.key === 'DB_FAILURE'), false);
    this.db.upsertSecret = persist;
  };

  private versionsAndStreams = (): void => {
    const first = this.vault.setManualSecret('EDITABLE', 'synthetic:/original\\quote"😀');
    first.maskInAi = false;
    const same = this.vault.setManualSecret('EDITABLE', first.realValue, 'edited description');
    assert.equal(same.maskInAi, false);
    assert.equal(same.alias, first.alias);
    const before = this.vault.snapshot();
    const sse = new SseTransformer(this.vault, 32, () => {});
    const second = this.vault.setManualSecret('EDITABLE', 'synthetic-new-value');
    assert.equal(second.maskInAi, false);
    assert.equal(second.retainedVersions, 1);
    assert.notEqual(second.alias, first.alias);
    assert.equal(this.vault.unmaskInboundText(first.alias), first.realValue);
    assert.equal(this.vault.maskOutboundText(first.realValue), first.realValue);
    this.vault.deleteSecret('EDITABLE');
    assert.equal(this.vault.unmaskInboundText(first.alias), first.alias);
    assert.equal(before.unmaskInboundText(first.alias), first.realValue);
    const wire = sse.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: first.alias } }] }) + '\n\ndata: [DONE]\n\n');
    assert.ok(wire.includes(JSON.stringify(first.realValue).slice(1, -1)));
    const args = new SseTransformer(before, 32, () => {});
    const argument = JSON.stringify({ credential: first.alias });
    const firstArgument = args.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call', type: 'function', function: { name: 'synthetic', arguments: argument.slice(0, 8) } }] } }] }) + '\n\n');
    const finalArgument = args.push('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: argument.slice(8) } }] }, finish_reason: 'tool_calls' }] }) + '\n\ndata: [DONE]\n\n');
    assert.ok(!(firstArgument + finalArgument).includes(first.alias));
    assert.ok((firstArgument + finalArgument).includes('synthetic:/original'));
    assert.throws(() => this.vault.setManualSecret('EDITABLE', 'synthetic-reuse'), /использовалось/);
    const roundtrip = this.vault.setManualSecret('ROUNDTRIP', 'synthetic:/\\"😀');
    for (const form of this.vault.getSecretRepresentations(roundtrip)) {
      assert.equal(this.vault.unmaskInboundText(this.vault.maskOutboundText(form.value)), form.value);
      for (let offset = 0; offset <= form.alias.length; offset++) {
        const transformer = new SlidingStreamTransformer(this.vault.getInboundReplacements());
        assert.equal(transformer.push(form.alias.slice(0, offset)) + transformer.push(form.alias.slice(offset)) + transformer.flush(), form.value);
      }
    }
  };

  private api = async (): Promise<void> => {
    const app = Fastify();
    const engine = new PatternEngine(this.db);
    new PatternEditorApi(app, engine).register();
    const runtime = new RuntimeSessions();
    new RulePreviewApi(app, runtime, this.vault).register();
    try {
      const input = { name: 'api-template', pattern: '(?<protocol>redis):([^ ]+)', type: 'uri', label_template: 'DB_$protocol_$2' };
      const created = await app.inject({ method: 'POST', url: '/api/patterns', payload: input });
      assert.equal(created.statusCode, 200);
      const current = created.json().pattern;
      assert.equal(current.label_template, input.label_template);
      const updated = await app.inject({ method: 'PUT', url: '/api/patterns/' + current.id, payload: { ...current, label_template: 'NEW_$1', baseline: current } });
      assert.equal(updated.statusCode, 200);
      assert.equal((await app.inject({ method: 'PUT', url: '/api/patterns/' + current.id, payload: { ...current, baseline: current } })).statusCode, 409);
      assert.equal((await app.inject({ method: 'POST', url: '/api/patterns', payload: { ...input, label_template: '$missing' } })).statusCode, 400);
      runtime.record({ id: 'preview-tx', sessionId: 'preview', request: { client: 'synthetic', method: 'POST', url: '/v1/chat/completions', headers: {}, body: { messages: [{ role: 'user', content: 'redis:synthetic' }] } }, interceptedSecrets: [], timestamp: new Date().toISOString() });
      const previewInput = { ...input, snapshot: new Date(Date.now() + 1000).toISOString() };
      const preview = await app.inject({ method: 'POST', url: '/api/pattern-preview', payload: previewInput });
      assert.equal(preview.statusCode, 200);
      assert.match(preview.json().results[0].alias, /^\$\$\{<DB_REDIS_SYNTHETIC_[A-F0-9]{12}>\}$/);
      assert.equal(preview.json().results[0].existing, false);
      const entry = this.vault.registerAutoDetectedSecret('redis:synthetic', 'uri');
      const repeated = await app.inject({ method: 'POST', url: '/api/pattern-preview', payload: previewInput });
      assert.equal(repeated.json().results[0].alias, entry.alias);
      assert.equal(repeated.json().results[0].existing, true);
    } finally { await app.close(); }
  };

  private restart = (): void => {
    const ephemeral = this.vault.registerAutoDetectedSecret('synthetic-ephemeral', 'restart');
    const raw = new DatabaseSync(this.path);
    assert.equal((raw.prepare('SELECT COUNT(*) AS count FROM auto_secrets').get() as { count: number }).count, 0);
    const persisted = JSON.stringify(raw.prepare('SELECT * FROM alias_registry').all());
    assert.ok(!persisted.includes('synthetic-ephemeral'));
    assert.ok(!persisted.includes(ephemeral.alias));
    raw.close();
    const child = spawnSync(process.execPath, ['--input-type=module', '-e', "import {VaultDatabase} from './dist/vault/sqlite-db.js'; import {VaultStore} from './dist/vault/store.js'; const db=new VaultDatabase(process.argv[1]); try { new VaultStore(db); process.exitCode=9; } catch { process.stdout.write('LOCKED'); } finally { db.close(); }", this.path], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(child.status, 0);
    assert.equal(child.stdout, 'LOCKED');
    const crashPath = join(this.directory, 'crash.db');
    const crash = spawnSync(process.execPath, ['--input-type=module', '-e', "import {VaultDatabase} from './dist/vault/sqlite-db.js'; import {VaultStore} from './dist/vault/store.js'; const db=new VaultDatabase(process.argv[1]); new VaultStore(db).registerAutoDetectedSecret('synthetic-crash','crash'); process.exit(0);", crashPath], { cwd: process.cwd(), encoding: 'utf8' });
    assert.equal(crash.status, 0);
    const recovered = new VaultDatabase(crashPath);
    assert.equal(new VaultStore(recovered).getAutoSecrets().length, 0);
    recovered.close();
    const durable = this.vault.setManualSecret('DURABLE_VERSION', 'synthetic-old-durable');
    const latest = this.vault.setManualSecret('DURABLE_VERSION', 'synthetic-new-durable');
    this.db.close();
    this.db = new VaultDatabase(this.path);
    this.db.upsertAutoSecret({ key: 'LEGACY', real_value: 'synthetic-legacy', alias: '$${<LEGACY>}', hit_count: 2, first_seen_at: '', last_seen_at: '' });
    this.vault = new VaultStore(this.db);
    assert.equal(this.vault.unmaskInboundText(ephemeral.alias), ephemeral.alias);
    assert.throws(() => this.vault.setAutoSecret(ephemeral.key, 'synthetic-rebound'), /использовалось/);
    assert.equal(this.vault.unmaskInboundText(durable.alias), durable.realValue);
    assert.equal(this.vault.unmaskInboundText(latest.alias), latest.realValue);
    assert.equal(this.vault.getAutoSecrets()[0].storage, 'legacy');
    assert.equal(this.vault.unmaskInboundText('$${<LEGACY>}'), 'synthetic-legacy');
    this.vault.registerAutoDetectedSecret('synthetic-legacy', 'ignored');
    assert.equal(this.db.getAutoSecrets()[0].hit_count, 2);
    const promoted = this.vault.registerAutoDetectedSecret('synthetic-promoted', 'promote');
    this.vault.promote(promoted.key);
    this.db.close();
    this.db = new VaultDatabase(this.path);
    this.vault = new VaultStore(this.db);
    assert.equal(this.vault.unmaskInboundText(promoted.alias), promoted.realValue);
  };

  private gateway = async (): Promise<void> => {
    const db = new VaultDatabase(':memory:');
    const vault = new VaultStore(db);
    const originalFetch = globalThis.fetch;
    let sent = 0;
    globalThis.fetch = async (_url, init) => {
      sent++;
      const content = JSON.parse(String(init?.body)).messages[0].content;
      return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { headers: { 'content-type': 'application/json' } });
    };
    const hooks = new HookManager([{ afterOutboundMask: body => { vault.deleteSecret('SNAPSHOT'); return body; } }]);
    const server = new GhostProxyServer(vault, { targetApiBase: 'http://127.0.0.1:1' }, hooks);
    globalThis.fetch = originalFetch;
    try {
      const entry = vault.setManualSecret('SNAPSHOT', 'synthetic-snapshot');
      const response = await server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', payload: { messages: [{ role: 'user', content: entry.realValue }] } });
      assert.equal(response.statusCode, 200);
      assert.equal(response.json().choices[0].message.content, entry.realValue);
      assert.equal(vault.unmaskInboundText(entry.alias), entry.alias);
      assert.equal(sent, 1);
      vault.setManualSecret('DISPLAY', 'synthetic:/old-display');
      const version = vault.setManualSecret('DISPLAY', 'synthetic:/new-display');
      const form = version.representations!.find(item => item.value === encodeURIComponent(version.realValue))!;
      assert.ok(form.alias.startsWith(version.alias.slice(0, -2) + '__GV_'));
      const encoded = await server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', payload: { messages: [{ role: 'user', content: form.value }] } });
      assert.equal(encoded.json().choices[0].message.content, form.value);
      const captured = server.getLastTransactionContext()!.interceptedSecrets.find(secret => secret.key === 'DISPLAY')!;
      assert.deepEqual(captured.representations, version.representations);
      assert.ok(server.getLastTransactionContext()!.maskedPrompt!.includes(form.alias));
      const publicVault = await server.getApp().inject({ method: 'GET', url: '/api/vault' });
      assert.deepEqual(publicVault.json().manual.find((secret: { key: string }) => secret.key === 'DISPLAY').representations, version.representations);
      const exported = await server.getApp().inject({ method: 'GET', url: '/api/export?group=secrets&id=DISPLAY' });
      assert.deepEqual(exported.json().data.secrets[0].representations, version.representations);
      assert.equal(exported.json().data.secrets[0].versions[0].representations[0].alias, '$${<DISPLAY>}');
      assert.equal(sent, 2);
      const engine = server.getPatternEngine();
      for (const pattern of engine.getPatterns()) engine.deletePattern(pattern.id);
      engine.addPattern('allocation-failure', 'synthetic-fail-[a-z]+', 'fail');
      db.aliases.randomSuffix = () => 'CCCCCCCCCCCC';
      vault.registerAutoDetectedSecret('synthetic-fail-first', 'fail');
      const failure = await server.getApp().inject({ method: 'POST', url: '/v1/chat/completions', payload: { messages: [{ role: 'user', content: 'synthetic-fail-second' }] } });
      assert.equal(failure.statusCode, 503);
      assert.equal(sent, 2);
    } finally { globalThis.fetch = originalFetch; await server.close(); db.close(); }
  };

  private migration = (): void => {
    const path = join(this.directory, 'legacy-schema.db');
    const legacy = new DatabaseSync(path);
    legacy.exec('CREATE TABLE patterns (id TEXT PRIMARY KEY, name TEXT, pattern TEXT, type TEXT, enabled INTEGER, created_at TEXT);');
    legacy.prepare('INSERT INTO patterns VALUES (?, ?, ?, ?, ?, ?)').run('legacy', 'legacy', '(synthetic)', 'custom', 1, '');
    legacy.close();
    const migrated = new VaultDatabase(path);
    assert.equal(migrated.getPatterns()[0].label_template, null);
    const migratedStore = new VaultStore(migrated);
    new PatternEngine(migrated).scanAndAutoDetect('synthetic', (value, type, prefix) => migratedStore.registerAutoDetectedSecret(value, type, prefix));
    assert.match(migratedStore.getAutoSecrets()[0].alias, /^\$\$\{<AUTO_CUSTOM_[A-F0-9]{12}>\}$/);
    migrated.close();
    const conflicting = new VaultDatabase(':memory:');
    conflicting.upsertSecret({ key: 'CONFLICT', real_value: 'synthetic-manual', alias: '$${<CONFLICT>}', mask_in_ai: 1, description: '', created_at: '', updated_at: '' });
    conflicting.upsertAutoSecret({ key: 'CONFLICT', real_value: 'synthetic-legacy', alias: '$${<CONFLICT>}', hit_count: 1, first_seen_at: '', last_seen_at: '' });
    assert.throws(() => new VaultStore(conflicting), /конфликт/);
    assert.equal(conflicting.getSecrets()[0].real_value, 'synthetic-manual');
    assert.equal(conflicting.getAutoSecrets()[0].real_value, 'synthetic-legacy');
    assert.equal(conflicting.aliases.owner('$${<CONFLICT>}'), undefined);
    conflicting.close();
  };

  public run = async (): Promise<void> => {
    try {
      this.templates();
      this.allocation();
      this.versionsAndStreams();
      await this.api();
      this.restart();
      await this.gateway();
      this.migration();
      console.log('PASS secret labels: templates, API/preview/baseline, collisions/retries, rollback, versions, chunks, lock, restart, legacy, promotion');
    } finally { this.db.close(); rmSync(this.directory, { recursive: true, force: true }); }
  };
}

new SecretLabelTests().run().catch(error => { console.error(error); process.exitCode = 1; });
