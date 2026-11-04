import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';
import { Ui } from '../frontend/ui-components.js';
import { SecretTableView } from '../frontend/secret-table-view.js';

class CopyAlignmentCheck {
  host = new UiTestHost();
  out = '../docs/ux-research/copy-alignment-20261105/screenshots';
  run = async () => {
    await mkdir(this.out, { recursive: true });
    await this.host.init();
    const base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await this.browser.newContext();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await context.addInitScript(() => {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = value => { window.copyPayload = value; return write(value); };
    });
    const page = await context.newPage();
    await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
    await page.goto(base + '/dashboard');
    await page.waitForFunction(() => window.app);
    const value = 'first line / значение\n' + 'long-value-'.repeat(18) + '\nlast line';
    const connection = '<div class="app-connection-identity"><code>http://127.0.0.1:8767/anthropic</code>' + Ui.copy('http://127.0.0.1:8767/anthropic', 'Копировать адрес') + '</div>';
    const rows = SecretTableView.field('Ручное значение', 'short value', 'Копировать значение') + SecretTableView.field('Автоматическое значение', value, 'Копировать значение') + SecretTableView.field('Подстановка', '$${<HOST_ABCDEF>}', 'Копировать подстановку');
    const markup = '<section id="copy-fixture" style="max-width:70rem;margin:2rem auto;padding:2rem"><h2>Копирование — desktop fixture</h2><div class="app-session-identity"><code>session-fixture-123</code>' + Ui.copy('session-fixture-123', 'Копировать ID сессии') + '</div><div class="app-vault-pair">' + connection + rows + '</div>' + Ui.copyCode(JSON.stringify({ value, host: 'localhost' }, null, 2)) + '<div class="app-expression-heading"><span>Регулярное выражение</span>' + Ui.copy('host=(.+)', 'Копировать выражение') + '</div><gv-hint label="$${&lt;HOST_ABCDEF&gt;}" copy-value="' + value.replaceAll('"', '&quot;') + '" secret-key="HOST"><button data-hint-only>Исходящая подсказка</button></gv-hint> <gv-hint direction="inbound" label="$${&lt;HOST_ABCDEF&gt;}" copy-value="' + value + '" secret-key="HOST"><button data-hint-only>Входящая подсказка</button></gv-hint></section>';
    await page.locator('.app-content').evaluate((node, html) => node.insertAdjacentHTML('afterbegin', html), markup);
    for (const width of [1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1080 });
      if (!process.env.COPY_BEFORE) for (const row of await page.locator('#copy-fixture .app-value-content, #copy-fixture .app-session-identity, #copy-fixture .app-connection-identity').all()) {
        assert.ok(await row.evaluate(node => {
          const text = node.firstElementChild;
          const box = text.getBoundingClientRect();
          const icon = node.querySelector('gv-copy').shadowRoot.querySelector('gv-icon').getBoundingClientRect();
          return Math.abs(icon.y + icon.height / 2 - box.y - parseFloat(getComputedStyle(text).lineHeight) / 2) < 3 && icon.left >= box.right;
        }));
      }
      await page.screenshot({ path: this.out + '/' + (process.env.COPY_BEFORE ? 'before-' : 'after-') + width + '.png', fullPage: true });
    }
    const copies = page.locator('#copy-fixture gv-copy:visible');
    for (const copy of await copies.all()) {
      const button = copy.locator('button');
      const before = await button.boundingBox();
      const expected = await copy.evaluate(node => node.value);
      await button.focus(); await page.keyboard.press('Enter');
      assert.equal(await page.evaluate(() => window.copyPayload), expected);
      assert.equal((await page.evaluate(() => navigator.clipboard.readText())).replaceAll('\r\n', '\n'), expected.replaceAll('\r\n', '\n'));
      assert.deepEqual(await button.boundingBox(), before);
      if (!process.env.COPY_BEFORE) assert.ok(await copy.locator('gv-icon').evaluate(node => { const a = node.getBoundingClientRect(); const b = node.querySelector('wa-icon').getBoundingClientRect(); return Math.abs(a.y + a.height / 2 - b.y - b.height / 2) < 1; }));
    }
    for (const direction of ['outbound', 'inbound']) {
      const hint = page.locator(direction === 'inbound' ? 'gv-hint[direction="inbound"]' : '#copy-fixture gv-hint:not([direction])');
      await hint.locator(':scope > button').hover();
      await hint.locator('.panel').waitFor({ state: 'visible' });
      await hint.locator(':scope > button').click();
      await page.screenshot({ path: this.out + '/' + (process.env.COPY_BEFORE ? 'before-' : 'after-') + direction + '.png' });
      const copy = hint.locator('gv-copy').first();
      await copy.locator('button').click();
      assert.equal(await page.evaluate(() => window.copyPayload), await copy.evaluate(node => node.value));
      await page.keyboard.press('Escape');
    }
    console.log('PASS exact clipboard, keyboard, success geometry, both hints and desktop widths');
  };
  close = async () => { await this.browser?.close(); await this.host.close(); };
}
const check = new CopyAlignmentCheck();
try { await check.run(); } finally { await check.close(); }
