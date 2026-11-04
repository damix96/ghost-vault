import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class BothSidesCheck {
  host = new UiTestHost();
  out = '../docs/ux-research/both-sides-change-view-20261104/screenshots';
  alias = '$${<HOST>}';
  original = 'db.internal.fixture';
  received = [];
  errors = [];
  prose = 'Проверка окружения завершена. Все зависимости доступны, параметры соединения согласованы. ';
  upstream = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    this.received.push(body);
    if (request.url.includes('mode=stream')) {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'STREAM_FULL_START ' + this.prose.repeat(15) + 'Адрес ' + this.alias.slice(0, 5) } }] }) + '\n\n');
      await new Promise(resolve => { this.releaseStream = resolve; });
      response.end('data: ' + JSON.stringify({ choices: [{ delta: { content: this.alias.slice(5) + ' доступен. ' + this.prose.repeat(15) + 'STREAM_FULL_END' } }] }) + '\n\ndata: [DONE]\n\n');
      return;
    }
    response.writeHead(200, { 'content-type': 'application/json' });
    const content = (request.url.includes('mode=none') || request.url.includes('mode=plain')) ? 'NO_CHANGE_FULL_START ' + this.prose.repeat(30) + this.original + ' NO_CHANGE_FULL_END' : 'FULL_RESPONSE_START ' + this.prose.repeat(15) + 'Буквальное значение ' + this.original + '. Проверен ' + this.alias + ', затем повторно ' + this.alias + '. ' + this.prose.repeat(15) + 'FULL_RESPONSE_END';
    const message = request.url.includes('mode=tool') ? { role: 'assistant', tool_calls: [{ id: 'call-fixture', type: 'function', function: { name: 'inspect', arguments: JSON.stringify({ host: this.alias, command: 'connect' }) } }] } : { role: 'assistant', content };
    response.end(JSON.stringify({ choices: [{ message }] }));
  });
  proxy = async (session, mode = 'json') => {
    const content = mode === 'plain' ? 'Обычный запрос без секретов.' : 'FULL_REQUEST_START ' + this.prose.repeat(15) + 'Проверь ' + this.original + ' и ещё раз ' + this.original + '. ' + this.prose.repeat(15) + 'FULL_REQUEST_END';
    const messages = [{ role: 'user', content }];
    if (mode === 'tool') messages.push({ role: 'assistant', tool_calls: [{ id: 'previous-call', type: 'function', function: { name: 'inspect', arguments: JSON.stringify({ host: this.original }) } }] }, { role: 'tool', tool_call_id: 'previous-call', content: 'HOST                  STATUS\n' + this.original + '   ready\nChecks passed.' });
    const response = await fetch(this.base + '/opencode/v1/chat/completions?mode=' + mode, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': session }, body: JSON.stringify({ model: 'fixture', stream: mode === 'stream', messages }) });
    assert.equal(response.status, 200);
    return response.text();
  };
  shot = async name => { await this.page.waitForTimeout(150); await this.page.screenshot({ path: this.out + '/' + name + '.png' }); };
  select = async session => {
    await this.page.evaluate(() => window.app.overview.refresh());
    await this.page.locator('[data-session-id="' + session + '"]').click();
    await this.page.waitForFunction(id => window.app.overview.step?.sessionId === id, session);
  };
  run = async () => {
    await mkdir(this.out, { recursive: true });
    this.upstream.listen(0, '127.0.0.1'); await once(this.upstream, 'listening');
    const stamp = new Date().toISOString();
    await this.host.init(db => db.upsertSecret({ key: 'HOST', real_value: this.original, alias: this.alias, mask_in_ai: 1, description: 'Fixture', created_at: stamp, updated_at: stamp }), { targetApiBase: 'http://127.0.0.1:' + this.upstream.address().port });
    this.base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    await fetch(this.base + '/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visible: ['opencode'], selected: 'opencode' }) });
    await this.proxy('both-sides');
    assert.ok(this.received[0].includes(this.alias)); assert.ok(!this.received[0].includes(this.original));
    const records = await (await fetch(this.base + '/api/sessions/both-sides')).json();
    assert.equal(records[0].responseChanges.status, 'complete');
    assert.equal(records[0].responseChanges.items.length, 2);
    assert.ok(records[0].responseChanges.items[0].after.totalLength > 2000);
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await this.host.isolateClipboard(this.context);
    await this.context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    this.page = await this.context.newPage(); this.page.setDefaultTimeout(10000);
    this.page.on('pageerror', error => this.errors.push(error.message));
    await this.page.goto(this.base + '/dashboard');
    await this.page.locator('.app-restored-value').first().waitFor();
    await this.defaults(); await this.copy(); await this.explicit(); await this.streaming(); await this.none(); await this.tools();
    assert.deepEqual(this.errors, []);
    console.log('PASS: real local proxy request masking/response restoration, overlapping evidence merge, literal original not highlighted, changes on both sides, no full streaming DOM, full/JSON/RAW explicit, both orders/anchor/navigation/copy/Ctrl+Click, desktop rail clear');
  };
  defaults = async () => {
    assert.equal(await this.page.locator('[data-content-mode="changes"]').getAttribute('aria-pressed'), 'true');
    assert.equal(await this.page.locator('#messageOrder').inputValue(), 'newest');
    const text = await this.page.locator('#overviewConversation').innerText();
    assert.doesNotMatch(text, /FULL_RESPONSE_START|FULL_RESPONSE_END|FULL_REQUEST_START|FULL_REQUEST_END|Ответ приложению|Сохранённый ответ после восстановления/);
    assert.equal(await this.page.locator('.app-final-response .app-change-card').count(), 1);
    assert.equal(await this.page.locator('.app-restored-value').count(), 2);
    assert.equal(await this.page.locator('.app-request-payload .app-change-fragment').count(), 1);
    await this.shot('changes-both-sides');
    for (const width of [1280, 1440, 1920]) {
      await this.page.setViewportSize({ width, height: 1000 });
      assert.equal(await this.page.evaluate(() => { const rail = document.querySelector('.app-timeline-navigation').getBoundingClientRect(); return [...document.querySelectorAll('.app-chat,.app-call-secrets')].every(node => node.getBoundingClientRect().right < rail.left); }), true);
    }
    await this.page.setViewportSize({ width: 1440, height: 1000 });
    await this.page.locator('#messageOrder').selectOption('oldest');
    assert.equal(await this.page.locator('.app-chat > section').last().getAttribute('data-reading-target-id'), 'response');
    await this.page.getByRole('button', { name: 'Самое новое сообщение', exact: true }).click();
    assert.ok((await this.page.evaluate(() => document.activeElement.dataset.readingKey)).startsWith('response'));
    const before = await this.page.locator('.app-final-response').evaluate(node => node.getBoundingClientRect().top);
    await this.page.evaluate(() => window.app.overview.renderConversation(true)); await this.page.waitForTimeout(100);
    assert.ok(Math.abs(await this.page.locator('.app-final-response').evaluate(node => node.getBoundingClientRect().top) - before) < 3);
    await this.page.locator('#messageOrder').selectOption('newest');
    const toggle = this.page.locator('.app-request-payload [data-context-toggle]');
    await toggle.click();
    assert.equal(await this.page.locator('.app-request-payload .app-change-fragment').count(), 1);
    assert.match(await this.page.locator('.app-request-payload .app-change-text').innerText(), /FULL_REQUEST_START/);
    await toggle.click();
    assert.doesNotMatch(await this.page.locator('.app-request-payload .app-change-text').innerText(), /FULL_REQUEST_START/);
  };
  copy = async () => {
    const hint = this.page.locator('.app-restored-value gv-hint').first();
    await hint.locator('[data-hint-only]').click();
    assert.match(await hint.locator('.panel').innerText(), /От модели/);
    assert.match(await hint.locator('.panel').innerText(), /Приложению/);
    await hint.getByRole('button', { name: 'Копировать исходное', exact: true }).click();
    assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), this.original);
    await hint.getByRole('button', { name: 'Копировать подстановку', exact: true }).click();
    assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), this.alias);
    await this.shot('restoration-hint'); await this.page.keyboard.press('Escape');
    await hint.locator('[data-hint-only]').click({ modifiers: ['Control'] });
    await this.page.locator('.app-secret-target[data-secret-record="HOST"]').waitFor();
    await this.page.locator('#navOverviewBtn').click();
  };
  explicit = async () => {
    await this.page.getByRole('button', { name: 'Полный текст', exact: true }).click();
    assert.match(await this.page.locator('.app-final-response').innerText(), /FULL_RESPONSE_START/);
    await this.shot('full-role-separation');
    await this.page.locator('#interfaceMode').check();
    await this.page.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.match(await this.page.locator('.app-final-response').innerText(), /choices/);
    await this.page.locator('[data-detail-id="response.full"]').locator('summary').click();
    await this.shot('explicit-response-json');
    await this.page.getByRole('button', { name: 'Места замен', exact: true }).click();
    assert.equal(await this.page.locator('[data-detail-id="response.full"]').count(), 0);
    assert.doesNotMatch(await this.page.locator('.app-final-response').innerText(), /FULL_RESPONSE_START/);
    await this.page.locator('#interfaceMode').uncheck();
  };
  streaming = async () => {
    const request = this.proxy('streaming', 'stream');
    await this.page.waitForFunction(() => window.app.overview.sessions.some(row => row.id === 'streaming'));
    await this.select('streaming');
    await this.page.waitForFunction(() => window.app.overview.step?.state === 'active');
    assert.match(await this.page.locator('.app-final-response').innerText(), /Ответ поступает/);
    assert.doesNotMatch(await this.page.locator('body').innerText(), /STREAM_FULL_START|STREAM_FULL_END/);
    assert.equal(await this.page.locator('#overviewStream').isVisible(), false);
    await this.shot('stream-status-only');
    this.releaseStream(); await request;
    await this.page.waitForFunction(() => window.app.overview.step?.state === 'complete');
    await this.page.locator('.app-restored-value').first().waitFor();
    assert.equal(await this.page.locator('.app-restored-value').count(), 1);
    assert.doesNotMatch(await this.page.locator('.app-final-response').innerText(), /STREAM_FULL_START|STREAM_FULL_END/);
    await this.shot('stream-restored-fragment');
    await this.page.getByRole('button', { name: 'Полный текст', exact: true }).click();
    await this.page.locator('#interfaceMode').check();
    await this.page.locator('[data-detail-id="response.full"]').locator('summary').click();
    assert.match(await this.page.locator('[data-detail-id="response.full"]').innerText(), /STREAM_FULL_START/);
    await this.shot('stream-explicit-raw');
    await this.page.getByRole('button', { name: 'Места замен', exact: true }).click();
    await this.page.locator('#interfaceMode').uncheck();
  };
  none = async () => {
    await this.proxy('no-restorations', 'none'); await this.select('no-restorations');
    assert.match(await this.page.locator('.app-final-response').innerText(), /В этом ответе восстановлений не было/);
    assert.equal(await this.page.locator('.app-restored-value').count(), 0);
    assert.doesNotMatch(await this.page.locator('.app-final-response').innerText(), /NO_CHANGE_FULL_START/);
    await this.shot('no-restorations');
    await this.page.locator('.app-final-response').getByRole('button', { name: 'Показать полный текст', exact: true }).click();
    assert.match(await this.page.locator('.app-final-response').innerText(), /NO_CHANGE_FULL_START/);
  };
  tools = async () => {
    await this.proxy('tool-call', 'tool'); await this.select('tool-call');
    await this.page.getByRole('button', { name: 'Места замен', exact: true }).click();
    await this.page.locator('.app-final-response [data-content-kind="code"] .app-restored-value').waitFor();
    assert.match(await this.page.locator('.app-final-response .app-change-text').first().evaluate(node => getComputedStyle(node).fontFamily), /Consolas|monospace/);
    await this.shot('tool-arguments');
    await this.page.locator('.app-request-payload [data-content-kind="code"]').last().scrollIntoViewIfNeeded();
    await this.shot('tool-result-label');
    await this.proxy('no-changes', 'plain'); await this.select('no-changes');
    assert.match(await this.page.locator('.app-request-payload').innerText(), /подстановок нет/);
    assert.match(await this.page.locator('.app-final-response').innerText(), /восстановлений не было/);
    await this.shot('neither-side-changes');
  };
  close = async () => { this.releaseStream?.(); await this.browser?.close(); await this.host.close(); this.upstream.closeAllConnections(); await new Promise(resolve => this.upstream.close(resolve)); };
}
const check = new BothSidesCheck();
try { await check.run(); } finally { await check.close(); }
