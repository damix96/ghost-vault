import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { ContextWindow } from '../frontend/context-window.js';
import { ChangeFragments } from '../frontend/change-fragments.js';
import { RestorationFragments } from '../frontend/restoration-fragments.js';
import { UiTestHost } from './ui-test-host.mjs';

class ContextLinesCheck {
  host = new UiTestHost();
  alias = '$${<HOST>}';
  original = 'db.fixture';
  out = '../docs/ux-research/context-lines-continuous-20261104/screenshots';
  snippet = (text, match, cap = 100) => {
    const start = text.indexOf(match);
    const range = ContextWindow.around(text, start, start + match.length, cap);
    return text.slice(range.start, range.end);
  };
  evidence = (text, value, fieldId = 'field-a') => [...text.matchAll(new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))].map((match, index) => {
    const from = Math.max(0, match.index - 96);
    const to = Math.min(text.length, match.index + value.length + 96);
    return { id: fieldId + index, fieldId, source: 'response-field', key: 'HOST', alias: this.alias, value, after: { text: text.slice(from, to), start: match.index - from, end: match.index + value.length - from, contextStart: from, totalLength: text.length } };
  });
  units = () => {
    for (const newline of ['\n', '\r\n']) {
      const text = ['excluded-before', 'one-before', 'left MATCH right', 'one-after', 'excluded-after'].join(newline);
      assert.equal(this.snippet(text, 'MATCH'), ['one-before', 'left MATCH right', 'one-after'].join(newline));
      const multiline = 'MATCH' + newline + 'MIDDLE' + newline + 'END';
      const multi = ['excluded', 'before', multiline, 'after', 'excluded'].join(newline);
      assert.equal(this.snippet(multi, multiline), ['before', multiline, 'after'].join(newline));
      assert.equal(this.snippet(multi, multiline + newline), ['before', multiline, 'after'].join(newline));
      const long = 'x'.repeat(180) + 'MATCH' + 'y'.repeat(180);
      assert.equal(this.snippet(long, 'MATCH'), 'x'.repeat(100) + 'MATCH' + 'y'.repeat(100));
      const capped = RestorationFragments.group(this.evidence(long.replace('MATCH', this.original), this.original))[0].windows[0];
      assert.equal(capped.text, 'x'.repeat(96) + this.original + 'y'.repeat(96));
      const largeMatch = 'A'.repeat(130) + newline + 'B'.repeat(130);
      assert.ok(this.snippet('before' + newline + largeMatch + newline + 'after', largeMatch).includes(largeMatch));
      const restoredMulti = RestorationFragments.group(this.evidence('before' + newline + largeMatch + newline + 'after', largeMatch))[0].windows[0];
      assert.equal(restoredMulti.text.slice(restoredMulti.matches[0].start, restoredMulti.matches[0].end), largeMatch);
      const textResponse = text.replace('MATCH', this.original);
      const group = RestorationFragments.group(this.evidence(textResponse, this.original))[0];
      assert.equal(group.windows[0].text, ['one-before', 'left ' + this.original + ' right', 'one-after'].join(newline));
      assert.equal(group.windows[0].text.slice(group.windows[0].matches[0].start, group.windows[0].matches[0].end), this.original);
    }
    const nearby = 'a HIT b HIT c';
    assert.equal(ChangeFragments.windows(nearby, [{ start: 2, end: 5 }, { start: 8, end: 11 }]).length, 1);
    const same = this.original + ' together ' + this.original;
    const merged = RestorationFragments.group(this.evidence(same, this.original));
    assert.equal(merged.length, 1); assert.equal(merged[0].windows.length, 1); assert.equal(merged[0].windows[0].text, same);
    const separate = RestorationFragments.group([...this.evidence(same, this.original), ...this.evidence(same, this.original, 'field-b')]);
    assert.equal(separate.length, 2);
  };
  run = async () => {
    this.units(); await mkdir(this.out, { recursive: true });
    const stamp = new Date().toISOString();
    await this.host.init(db => db.upsertSecret({ key: 'HOST', real_value: this.original, alias: this.alias, mask_in_ai: 1, description: '', created_at: stamp, updated_at: stamp }));
    this.base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    const routes = await (await fetch(this.base + '/api/routes')).json();
    const requestText = ['Скрытая вводная', 'Контекст перед первым вхождением', 'Адрес ' + this.alias + ' доступен', 'Контекст после первого вхождения', ...Array(12).fill('Пропущенные строки'), 'Контекст перед вторым вхождением', 'Повторный адрес ' + this.alias, 'Контекст после второго вхождения', 'Скрытый хвост'].join('\n');
    const responseText = requestText.replaceAll(this.alias, this.original);
    this.host.server.recordTransaction({ id: 'context-call', sessionId: 'context-session', timestamp: stamp, request: { method: 'POST', url: '/' + routes[0].prefix + '/v1/messages', headers: {}, client: 'Fixture', body: { messages: [{ role: 'user', content: requestText }, { role: 'tool', content: 'Другое поле ' + this.alias }] } }, maskedPrompt: JSON.stringify({ messages: [{ role: 'user', content: requestText }, { role: 'tool', content: 'Другое поле ' + this.alias }] }), response: { status: 200, headers: {}, body: { role: 'assistant', content: responseText }, isStream: false }, responseChanges: { version: 1, status: 'complete', stage: 'restoration', postHookModified: false, items: this.evidence(responseText, this.original) }, interceptedSecrets: [] });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.context = await this.browser.newContext({ viewport: { width: 1440, height: 1080 } });
    await this.host.isolateClipboard(this.context);
    await this.context.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    this.page = await this.context.newPage();
    await this.page.goto(this.base + '/dashboard');
    const response = this.page.locator('.app-final-response');
    await response.locator('.app-restored-value').first().waitFor();
    assert.equal(await response.locator('.app-change-card').count(), 1);
    assert.equal(await response.locator('.app-change-text').count(), 1);
    assert.equal(await response.locator('.app-restored-value').count(), 2);
    assert.equal(await response.locator('.app-fragment-cut').count(), 3);
    assert.doesNotMatch(await response.innerText(), /Пропущенные строки|Скрытая вводная|Скрытый хвост/);
    assert.match(await response.innerText(), /Контекст перед первым вхождением/);
    assert.match(await response.innerText(), /Контекст после второго вхождения/);
    const request = this.page.locator('[data-reading-key="request.messages[0].content"]');
    assert.equal(await request.locator('.app-change-text').count(), 1);
    assert.equal(await request.locator('.app-change-fragment').count(), 1);
    assert.equal(await this.page.locator('.app-request-payload .app-change-card').count(), 2);
    assert.equal(await request.locator('.app-fragment-cut').nth(1).evaluate(node => getComputedStyle(node).display), 'inline');
    await this.page.screenshot({ path: this.out + '/response-continuous.png' });
    await request.scrollIntoViewIfNeeded(); await this.page.screenshot({ path: this.out + '/request-continuous.png' });
    await request.locator('[data-context-toggle]').click();
    assert.equal(await request.locator('.app-change-text').count(), 1);
    assert.match(await request.innerText(), /Скрытая вводная/);
    await request.locator('[data-context-toggle]').click();
    const hint = response.locator('gv-hint').first();
    await hint.locator('[data-hint-only]').click();
    await hint.getByRole('button', { name: 'Копировать исходное', exact: true }).click();
    assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), this.original);
    await this.page.keyboard.press('Escape');
    await hint.locator('[data-hint-only]').click({ modifiers: ['Control'] });
    await this.page.locator('.app-secret-target[data-secret-record="HOST"]').waitFor();
    console.log('PASS LF/CRLF before+match+after, 100/96 caps, multiline intact, adjacent merged, distant same-field continuous ellipsis, distinct fields separate, exact inbound offsets/copy/Ctrl+Click');
  };
  close = async () => { await this.browser?.close(); await this.host.close(); };
}
const check = new ContextLinesCheck();
try { await check.run(); } finally { await check.close(); }
