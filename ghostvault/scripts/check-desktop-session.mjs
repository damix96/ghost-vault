import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class DesktopSessionCheck {
  host = new UiTestHost();
  out = '../docs/ux-research/desktop-session-refinement-20261031/screenshots';
  errors = [];
  long = 'Начало поля. ' + 'Сохраняем читаемый контекст сообщения. '.repeat(25) + '$${<DB_HOST>}' + ' Продолжение исходного поля.'.repeat(35);
  run = async () => {
    await mkdir(this.out, { recursive: true });
    const stamp = new Date().toISOString();
    await this.host.init(db => db.upsertSecret({ key: 'DB_HOST', real_value: 'db.internal.example', alias: '$${<DB_HOST>}', mask_in_ai: 1, description: 'Основная база', created_at: stamp, updated_at: stamp }));
    this.base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    const routes = await (await fetch(this.base + '/api/routes')).json();
    this.messages = [
      { role: 'system', content: 'Работайте с $${<DB_HOST>} только в локальном окружении.' },
      { role: 'user', content: 'Проверь $${<DB_HOST>} и буквальный пример $${<UNKNOWN>}.' },
      { role: 'assistant', tool_calls: [{ id: 'call-1', type: 'function', function: { name: 'inspect', arguments: '{"host":"$${<DB_HOST>}"}' } }] },
      { role: 'tool', tool_call_id: 'call-1', content: 'HOST                     STATUS\n$${<DB_HOST>}            ready\n' + 'row                      ok\n'.repeat(20) },
      { role: 'assistant', content: 'Проверка $${<DB_HOST>} завершена.' },
      { role: 'user', content: this.long },
    ];
    this.host.database.upsertSession('desktop-session-fixture', 'Ignored display name');
    this.host.database.saveTransaction({ id: 'desktop-tx', session_id: 'desktop-session-fixture', client: 'Desktop fixture', method: 'POST', url: '/' + routes[0].prefix + '/v1/chat/completions', status: 200, latency_ms: 120, prompt_text: JSON.stringify({ messages: this.messages, stream: false, max_tokens: 500 }), masked_prompt: JSON.stringify({ messages: this.messages, stream: false, max_tokens: 500 }), model_response: JSON.stringify({ role: 'assistant', content: 'Готово. Проверена база db.internal.example.' }), intercepted_secrets: JSON.stringify([{ key: 'DB_HOST', alias: '$${<DB_HOST>}', realValue: 'db.internal.example' }]), timestamp: stamp });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await this.host.isolateClipboard(this.context);
    await this.context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    this.page = await this.context.newPage();
    this.page.on('pageerror', error => this.errors.push(error.message));
    this.page.setDefaultTimeout(10000);
    await this.page.goto(this.base + '/dashboard');
    await this.page.locator('.app-change-card').first().waitFor();
    await this.modes(); await this.contextExpansion(); await this.ordering(); await this.hints(); await this.forms();
    assert.deepEqual(this.errors, []);
    console.log('PASS desktop: modes/persistence, both orders/tool dependency, context in place, technical fields/HTTP, fixed navigation, scroll anchoring, exact copy/Ctrl+Click, forms/typography');
  };
  shot = async name => { await this.page.waitForTimeout(200); await this.page.screenshot({ path: this.out + '/' + name + '.png' }); };
  modes = async () => {
    assert.equal(await this.page.locator('body').getAttribute('data-mode'), 'simple');
    assert.equal(await this.page.locator('#messageOrder').inputValue(), 'newest');
    assert.equal(await this.page.locator('.app-technical:visible').count(), 0);
    assert.match(await this.page.locator('.app-latest-call').innerText(), /HTTP 200/);
    await this.shot('simple-newest');
    await this.page.locator('#interfaceMode').check();
    await this.page.locator('.app-change-card code').first().waitFor();
    assert.match(await this.page.locator('.app-change-card code').first().textContent(), /request.messages\[5\].content/);
    await this.page.getByRole('button', { name: 'Полный текст', exact: true }).click();
    await this.page.locator('[data-detail-id="response.full"]').locator('summary').click();
    await this.shot('advanced-response');
    await this.page.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.match(await this.page.locator('.app-request-payload').innerText(), /max_tokens/);
    await this.page.locator('#interfaceMode').uncheck();
    assert.equal(await this.page.locator('.app-technical:visible').count(), 0);
    assert.equal(await this.page.locator('[data-content-mode="full"]').getAttribute('aria-pressed'), 'true');
    await this.page.locator('#interfaceMode').check();
    await this.page.getByRole('button', { name: 'Места замен', exact: true }).click();
  };
  contextExpansion = async () => {
    const card = this.page.locator('[data-reading-key="request.messages[5].content"]');
    await card.locator('[data-context-toggle]').click();
    assert.equal(await card.locator('.app-change-text').count(), 1);
    const actual = await card.locator('.app-change-text').evaluate(node => { const copy = node.cloneNode(true); copy.querySelectorAll('gv-hint').forEach(hint => hint.replaceWith(hint.querySelector('[data-hint-only]').textContent)); return copy.textContent; });
    assert.equal(actual, this.long);
    assert.equal(await this.page.locator('[data-reading-key="request.messages[0].content"] [data-context-toggle]').count(), 0);
    await this.shot('context-expanded');
    await card.locator('[data-context-toggle]').click();
    assert.ok((await card.locator('.app-change-text').textContent()).length < this.long.length);
  };
  ordering = async () => {
    await this.page.getByRole('button', { name: 'Полный текст', exact: true }).click();
    assert.match(await this.page.locator('[data-reading-key="request.messages[2]"] .app-code').first().innerText(), /host/);
    const paths = () => this.page.locator('.app-request-payload > .app-chat-messages > .app-message').evaluateAll(nodes => nodes.map(node => node.dataset.readingKey));
    assert.deepEqual(await paths(), [5, 2, 3, 4, 1, 0].map(index => `request.messages[${index}]`));
    await this.page.locator('#messageOrder').selectOption('oldest');
    assert.deepEqual(await paths(), [0, 1, 2, 3, 4, 5].map(index => `request.messages[${index}]`));
    const target = this.page.locator('[data-reading-key="request.messages[3]"]');
    await target.evaluate(node => node.scrollIntoView({ block: 'start' }));
    await this.page.evaluate(() => scrollBy(0, -100));
    const before = await target.evaluate(node => node.getBoundingClientRect().top);
    await this.page.evaluate(() => window.app.preferences.set('order', 'newest'));
    await this.page.waitForTimeout(200);
    assert.ok(Math.abs(await target.evaluate(node => node.getBoundingClientRect().top) - before) < 3, 'Reading anchor during order switch');
    await this.page.getByRole('button', { name: 'Самое новое сообщение', exact: true }).click();
    assert.equal(await this.page.evaluate(() => document.activeElement.dataset.readingKey), 'response.container');
    await this.page.getByRole('button', { name: 'Самое раннее сообщение', exact: true }).click();
    assert.equal(await this.page.evaluate(() => document.activeElement.dataset.readingKey), 'request.messages[0]');
    await this.page.locator('#messageOrder').selectOption('oldest');
    await this.page.reload();
    await this.page.locator('#messageOrder').waitFor();
    assert.equal(await this.page.locator('#messageOrder').inputValue(), 'oldest');
    assert.deepEqual(await this.page.evaluate(() => JSON.parse(window.app.overview.step.maskedPrompt).messages), this.messages);
    assert.equal(await this.page.locator('body').getAttribute('data-mode'), 'advanced');
    await this.page.getByRole('button', { name: 'Полный текст', exact: true }).click();
    await this.page.evaluate(() => scrollTo(0, 0)); await this.shot('advanced-oldest');
    await this.page.setViewportSize({ width: 1920, height: 1080 }); await this.shot('wide-desktop');
    await this.page.setViewportSize({ width: 1440, height: 1000 });
  };
  hints = async () => {
    await this.page.getByRole('button', { name: 'Места замен', exact: true }).click();
    const token = this.page.locator('.app-change-text [data-secret-key]').first();
    await token.click();
    const hint = this.page.locator('.app-change-text gv-hint').first();
    await hint.getByRole('button', { name: 'Копировать исходное', exact: true }).click();
    assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), 'db.internal.example');
    await this.shot('hint-copy'); await this.page.keyboard.press('Escape');
    await token.click({ modifiers: ['Control'] }); await this.page.locator('.app-secret-target').waitFor();
    assert.equal(await this.page.locator('.app-secret-target').getAttribute('data-secret-record'), 'DB_HOST');
  };
  forms = async () => {
    await this.page.locator('[data-action="secret-edit"]').first().click(); await this.shot('secret-condition'); await this.page.keyboard.press('Escape');
    await this.page.locator('#navRulesBtn').click(); await this.shot('rules-typography');
    await this.page.getByRole('button', { name: 'Добавить правило', exact: true }).click(); await this.shot('rule-condition'); await this.page.keyboard.press('Escape');
    await this.page.locator('#navOverviewBtn').click();
    await this.page.evaluate(() => { window.app.overview.step.response.status = 500; window.app.overview.renderConversation(); window.app.preferences.set('mode', 'simple'); });
    assert.match(await this.page.locator('.app-latest-call').innerText(), /HTTP 500/);
    assert.equal(await this.page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  };
  close = async () => { await this.browser?.close(); await this.host.close(); };
}
const check = new DesktopSessionCheck();
try { await check.run(); } finally { await check.close(); }
