import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class RulePreviewCheck {
  host = new UiTestHost();
  snapshot = () => new Date().toISOString();
  preview = body => fetch(this.base + '/api/pattern-preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ snapshot: this.snapshot(), ...body }) });

  seed = (db, id, text) => {
    const stamp = new Date(Date.now() - 1000).toISOString();
    db.upsertSession(id, 'Preview fixture');
    db.saveTransaction({ id: id + '-tx', session_id: id, client: 'Preview fixture', method: 'POST', url: '/' + id + '/chat/completions', status: 200, latency_ms: 1, prompt_text: JSON.stringify({ model: 'METADATA_ONLY', messages: [{ role: 'user', content: text }] }), masked_prompt: '', model_response: '', intercepted_secrets: '[]', timestamp: stamp });
  };

  run = async () => {
    await this.host.init(db => {
      for (let index = 0; index < 10; index++) this.seed(db, 'session-' + index, 'before TOKEN_ONE_' + index + ' middle TOKEN_TWO_' + index + ' after ::1 nope 8.8.8.8' + (index === 0 ? ' ' + 'Z'.repeat(1500) : ''));
    });
    this.host.database.saveTransaction({ id: 'old-tx', session_id: 'session-0', client: 'fixture', method: 'POST', url: '/session-0/chat/completions', status: 200, latency_ms: 1, prompt_text: JSON.stringify({ messages: [{ role: 'user', content: 'OLD_ONLY' }] }), masked_prompt: '', model_response: '', intercepted_secrets: '[]', timestamp: '2020-01-01T00:00:00.000Z' });
    this.base = await this.host.app.listen({ host: '127.0.0.1', port: 0 });
    const before = this.host.database.getPatterns();
    const page = await (await this.preview({ pattern: 'TOKEN_ONE_\\d+' })).json();
    assert.equal(page.total, 10);
    assert.equal(page.scanned, 1);
    assert.equal(page.results.length, 1);
    assert.equal(page.results[0].path, 'request.messages[0].content');
    assert.equal(page.results[0].role, 'user');
    const next = await (await this.preview({ pattern: 'TOKEN_ONE_\\d+', offset: page.next })).json();
    assert.equal(next.scanned, 1);
    const ips = await (await this.preview({ pattern: '::1|nope|8\\.8\\.8\\.8', anyIp: true })).json();
    assert.deepEqual([...new Set(ips.results.map(item => item.value))].sort(), ['8.8.8.8', '::1']);
    assert.equal((await this.preview({ pattern: '[' })).status, 400);
    assert.equal((await (await this.preview({ pattern: 'OLD_ONLY|METADATA_ONLY' })).json()).results.length, 0);
    const long = await (await this.preview({ pattern: 'Z{1500}' })).json();
    assert.equal(long.results[0].value, 'Z'.repeat(1500));
    assert.deepEqual(this.host.database.getPatterns(), before);
    assert.equal(this.host.database.getAutoSecrets().length, 0);
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(10000);
    const errors = [];
    this.page.on('pageerror', error => errors.push(error.message));
    await this.page.goto(this.base + '/dashboard#rules');
    await this.page.locator('[data-action="rule-edit"]').first().getByRole('button').click();
    const regex = this.page.locator('#ruleEditorForm [name="pattern"]');
    await regex.fill('TOKEN_ONE_\\d+');
    await this.page.waitForFunction(() => document.querySelector('#ruleEditorForm .app-preview-status').textContent.includes('10 / 10'));
    assert.equal(await this.page.locator('#ruleEditorForm .app-preview-match').count(), 10);
    assert.match(await this.page.locator('#ruleEditorForm .app-preview-match').first().innerText(), /TOKEN_ONE_0/);
    assert.equal(await this.page.locator('#ruleEditorForm').evaluate(node => getComputedStyle(node).display), 'grid');
    await regex.fill('Z{1500}');
    await this.page.waitForFunction(() => document.querySelector('#ruleEditorForm .app-preview-results gv-value')?.value.length === 1500);
    await regex.fill('[');
    await this.page.waitForFunction(() => document.querySelector('#ruleEditorForm .app-preview-status').textContent.includes('не завершена'));
    assert.equal(await this.page.locator('#ruleEditorForm .app-preview-match').count(), 0);
    let release;
    let ready;
    const started = new Promise(resolve => { ready = resolve; });
    await this.page.route('**/api/pattern-preview', async route => {
      if (route.request().postDataJSON().pattern !== 'STALE_PATTERN') return route.continue();
      ready();
      await new Promise(resolve => { release = resolve; });
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ next: 1, total: 1, scanned: 1, truncated: 0, results: [{ session: 'stale', client: 'stale', value: 'STALE_RESULT', before: '', after: '', path: 'request', endpoint: '/stale' }] }) }).catch(() => {});
    });
    await regex.fill('STALE_PATTERN');
    await started;
    await regex.fill('TOKEN_TWO_\\d+');
    await this.page.waitForFunction(() => document.querySelector('#ruleEditorForm .app-preview-status').textContent.includes('10 / 10'));
    release();
    assert.doesNotMatch(await this.page.locator('#ruleEditorForm .app-preview-results').innerText(), /STALE_RESULT/);
    assert.ok((await this.page.locator('#ruleEditorForm .app-preview-results mark').allTextContents()).every(value => value.startsWith('TOKEN_TWO_')));
    await this.page.locator('[data-rule-cancel]').click();
    await this.page.locator('[data-action="rule-create"]').getByRole('button').click();
    await this.page.locator('#patternRegexInput').getByRole('textbox').fill('TOKEN_ONE_\\d+');
    await this.page.waitForFunction(() => document.querySelector('#patternForm .app-preview-status').textContent.includes('10 / 10'));
    assert.equal(await this.page.locator('#patternForm .app-preview-match').count(), 10);
    await this.page.keyboard.press('Escape');
    const completeText = 'CONTEXT_BEGIN ' + 'x'.repeat(140000) + ' ' + Array.from({ length: 65 }, (_, index) => 'COVER_' + String(index).padStart(3, '0')).join(' ') + ' ' + 'L'.repeat(2000) + ' CONTEXT_END';
    this.seed(this.host.database, 'session-coverage', completeText);
    let coverageOffset = 10;
    let matchOffset = 0;
    const coverage = [];
    do {
      const chunk = await (await this.preview({ pattern: 'COVER_\\d{3}|L{2000}', offset: coverageOffset, matchOffset })).json();
      coverage.push(...chunk.results);
      assert.equal(chunk.contexts['request.messages[0].content'], completeText);
      matchOffset = chunk.matchOffset;
      coverageOffset = chunk.next;
    } while (matchOffset);
    assert.equal(coverage.length, 66);
    assert.equal(coverage[64].value, 'COVER_064');
    assert.equal(coverage[65].value, 'L'.repeat(2000));
    await this.page.locator('[data-action="rule-create"]').getByRole('button').click();
    await this.page.locator('#patternRegexInput').getByRole('textbox').fill('COVER_\\d{3}|L{2000}');
    const more = this.page.locator('#patternForm [data-preview-more]');
    await more.waitFor({ state: 'visible' });
    assert.equal(await this.page.locator('#patternForm .app-preview-match').count(), 60);
    assert.match(await this.page.locator('#patternForm .app-preview-status').innerText(), /не завершена/);
    await more.click();
    await this.page.waitForFunction(() => document.querySelectorAll('#patternForm .app-preview-match').length === 66);
    assert.equal(await this.page.locator('#patternForm .app-preview-match').last().locator('gv-value').evaluate(node => node.value), 'L'.repeat(2000));
    const full = this.page.locator('#patternForm [data-preview-context]').first();
    await full.locator('summary').click();
    assert.equal(await full.locator('pre').textContent(), completeText);
    await this.page.keyboard.press('Escape');
    this.seed(this.host.database, 'aaa-stress', 'a'.repeat(60000) + '!');
    const slow = this.preview({ pattern: '(a+)+$' });
    const healthStart = performance.now();
    const health = await fetch(this.base + '/health');
    assert.equal(health.status, 200);
    assert.ok(performance.now() - healthStart < 750);
    const timedOut = await slow;
    assert.equal(timedOut.status, 408);
    assert.match((await timedOut.json()).error, /1 секунды/);
    assert.deepEqual(this.host.database.getPatterns(), before);
    assert.equal(this.host.database.getAutoSecrets().length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS: full-source >128KiB, 66 matches via continuation/load-more, full long value/context, latest-only/all-session original outbound fields, exact long match, invalid UI status, paginated draft preview, attributed snippets, any-IP semantics, invalid regex, stale response cancellation, create/edit side panels, worker timeout with responsive health, no rule/secret mutation');
  };

  close = async () => { await this.browser?.close(); await this.host.close(); };
}

const check = new RulePreviewCheck();
try { await check.run(); } finally { await check.close(); }
