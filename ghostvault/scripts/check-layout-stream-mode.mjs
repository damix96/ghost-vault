import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class LayoutStreamCheck {
  host = new UiTestHost();
  out = '../docs/ux-research/layout-stream-mode-20261104/screenshots';
  responses = new Map();
  errors = [];
  upstream = createServer(async (request, response) => {
    for await (const chunk of request) void chunk;
    response.writeHead(200, { 'content-type': 'text/event-stream' });
    response.flushHeaders();
    this.responses.set(new URL(request.url, 'http://localhost').searchParams.get('fixture'), response);
  });
  write = async (id, text) => {
    await new Promise(resolve => setTimeout(resolve, 300));
    this.responses.get(id).write('data: ' + JSON.stringify({ choices: [{ delta: { content: text + ' Промежуточный текст ответа.'.repeat(80) } }] }) + '\n\n');
  };

  end = id => this.responses.get(id).end('data: [DONE]\n\n');
  request = async id => {
    const response = await fetch(this.base + '/opencode/v1/chat/completions?fixture=' + id, { method: 'POST', headers: { 'content-type': 'application/json', 'x-session-id': id }, body: JSON.stringify({ model: 'fixture', stream: true, messages: [{ role: 'user', content: 'Проверка потока без секретов.' }] }) });
    return response.text();
  };
  shot = async name => { await this.page.waitForTimeout(100); await this.page.screenshot({ path: this.out + '/' + name + '.png' }); };
  geometry = async phase => {
    for (const width of [1280, 1440, 1920, 2560]) {
      await this.page.setViewportSize({ width, height: 1080 });
      const result = await this.page.evaluate(() => {
        const box = document.querySelector('.app-content').getBoundingClientRect();
        const rail = document.querySelector('.app-timeline-navigation')?.getBoundingClientRect();
        return { gap: Math.abs(box.left - (document.documentElement.clientWidth - box.right)), clear: !rail || [...document.querySelectorAll('.app-chat,.app-call-secrets')].every(node => node.getBoundingClientRect().right < rail.left), fits: document.documentElement.scrollWidth <= innerWidth };
      });
      assert.ok(result.gap < 1, phase + ' centered ' + width + ' ' + JSON.stringify(result));
      assert.ok(result.clear && result.fits, phase + ' rail ' + width);
      await this.shot(phase + '-' + width);
    }
    await this.page.setViewportSize({ width: 1920, height: 1080 });
  };
  select = async id => {
    await this.page.waitForFunction(id => window.app.overview.sessions.some(session => session.id === id), id);
    await this.page.locator('[data-session-id="' + id + '"]').click();
    await this.page.waitForFunction(id => window.app.overview.step?.sessionId === id, id);
  };
  run = async () => {
    await mkdir(this.out, { recursive: true });
    this.upstream.listen(0, '127.0.0.1'); await once(this.upstream, 'listening');
    await this.host.init(() => {}, { targetApiBase: 'http://127.0.0.1:' + this.upstream.address().port });
    this.base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    await fetch(this.base + '/api/workspace', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ visible: ['opencode', 'anthropic'], selected: 'opencode' }) });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.page = await this.browser.newPage({ viewport: { width: 1920, height: 1080 } });
    this.page.setDefaultTimeout(10000);
    await this.page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    this.page.on('pageerror', error => this.errors.push(error.message));
    await this.page.goto(this.base + '/dashboard');
    await this.page.waitForFunction(() => window.app?.overview.live && !window.app.overview.refreshing);
    await this.geometry('empty');
    const first = this.request('first');
    await this.select('first');
    await this.write('first', 'FIRST_STREAM_TEXT\nПроверяем немедленное переключение режима.\n');
    await this.page.waitForFunction(() => window.app.overview.stream.current?.text.includes('FIRST_STREAM_TEXT'));
    assert.equal(await this.page.locator('#overviewStream').isVisible(), false);
    assert.doesNotMatch(await this.page.locator('body').innerText(), /FIRST_STREAM_TEXT/);
    await this.page.locator('#interfaceMode').check();
    assert.match(await this.page.locator('#overviewStreamText').innerText(), /FIRST_STREAM_TEXT/);
    assert.equal(await this.page.locator('#overviewStream').count(), 1);
    assert.equal(await this.page.locator('[data-content-mode="changes"]').getAttribute('aria-pressed'), 'true');
    await this.geometry('advanced');
    await this.page.locator('#interfaceMode').uncheck();
    assert.equal(await this.page.locator('#overviewStreamText').textContent(), '');
    assert.match(await this.page.locator('.app-final-response').innerText(), /Ответ поступает/);
    await this.shot('simple-status');
    await this.page.locator('#interfaceMode').check();
    assert.match(await this.page.locator('#overviewStreamText').innerText(), /FIRST_STREAM_TEXT/);
    await this.page.evaluate(() => window.app.connections.select('anthropic'));
    assert.equal(await this.page.locator('#overviewStream').count(), 0);
    await this.page.evaluate(() => window.app.connections.select('opencode'));
    await this.page.waitForFunction(() => window.app.overview.step?.sessionId === 'first');
    assert.doesNotMatch(await this.page.locator('body').innerText(), /FIRST_STREAM_TEXT/);
    await this.write('first', 'AFTER_ROUTE_CHANGE\n');
    await this.page.waitForFunction(() => document.getElementById('overviewStreamText')?.textContent.includes('AFTER_ROUTE_CHANGE'));
    await this.page.evaluate(() => { window.app.overview.setLive(false); });
    assert.equal(await this.page.locator('#overviewStreamText').textContent(), '');
    await this.page.evaluate(() => window.app.overview.setLive(true));
    await this.page.waitForFunction(() => !window.app.overview.refreshing);
    assert.doesNotMatch(await this.page.locator('body').innerText(), /AFTER_ROUTE_CHANGE/);
    await this.write('first', 'AFTER_RECONNECT\n');
    await this.page.waitForFunction(() => document.getElementById('overviewStreamText')?.textContent.includes('AFTER_RECONNECT'));
    this.end('first'); await first;
    await this.page.waitForFunction(() => window.app.overview.step?.state === 'complete');
    assert.equal(await this.page.locator('#overviewStream').count(), 0);
    assert.doesNotMatch(await this.page.locator('.app-final-response').innerText(), /FIRST_STREAM_TEXT/);
    const second = this.request('second'); await this.select('second');
    await this.write('second', 'SECOND_STREAM_TEXT');
    await this.page.waitForFunction(() => document.getElementById('overviewStreamText')?.textContent.includes('SECOND_STREAM_TEXT'));
    await this.select('first'); assert.doesNotMatch(await this.page.locator('body').innerText(), /SECOND_STREAM_TEXT/);
    await this.select('second'); assert.equal(await this.page.locator('#overviewStreamText').textContent(), '');
    await this.write('second', ' FRESH');
    await this.page.waitForFunction(() => document.getElementById('overviewStreamText')?.textContent.includes('FRESH'));
    await this.page.getByRole('button', { name: 'JSON', exact: true }).click();
    assert.equal(await this.page.locator('#overviewStream').count(), 1);
    assert.equal(await this.page.locator('[data-detail-id="response.full"]').count(), 0);
    this.end('second'); await second;
    await this.page.waitForFunction(() => window.app.overview.step?.state === 'complete');
    assert.equal(await this.page.locator('[data-content-mode="json"]').getAttribute('aria-pressed'), 'true');
    assert.match(await this.page.locator('.app-final-response').innerText(), /SECOND_STREAM_TEXT/);
    const third = this.request('third'); await this.select('third');
    await this.write('third', 'CLEAR_ME');
    await this.page.waitForFunction(() => document.getElementById('overviewStreamText')?.textContent.includes('CLEAR_ME'));
    await fetch(this.base + '/api/sessions', { method: 'DELETE' });
    await this.page.waitForFunction(() => window.app.overview.step === null);
    assert.equal(await this.page.evaluate(() => window.app.overview.stream.current), null);
    assert.doesNotMatch(await this.page.locator('body').innerText(), /CLEAR_ME/);
    this.end('third'); await third;
    assert.deepEqual(this.errors, []);
    console.log('PASS: desktop empty/filled centered+rail 1280/1440/1920/2560; live advanced/simple immediate toggle; one stream area; route/session/reconnect/clear/completion no stale text; changes default and JSON choice preserved');
  };
  close = async () => { for (const response of this.responses.values()) response.end(); await this.browser?.close(); await this.host.close(); this.upstream.closeAllConnections(); await new Promise(resolve => this.upstream.close(resolve)); };
}
const check = new LayoutStreamCheck();
try { await check.run(); } finally { await check.close(); }
