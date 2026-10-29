import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class SecretNavigationCheck {
  host = new UiTestHost();
  key = 'lower <ключ>.[x]"&';
  autoKey = 'auto_ключ.[x]';

  run = async () => {
    const stamp = new Date().toISOString();
    this.alias = '$${<' + this.key + '>}';
    this.autoAlias = '$${<' + this.autoKey + '>}';
    await this.host.init(database => {
    database.upsertSecret({ key: this.key, real_value: 'value / encoded', alias: this.alias, mask_in_ai: 1, description: '', created_at: stamp, updated_at: stamp });
    database.upsertAutoSecret({ key: this.autoKey, real_value: 'automatic value', alias: this.autoAlias, hit_count: 1, first_seen_at: stamp, last_seen_at: stamp });
    });
    const base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await this.browser.newContext();
    await this.host.isolateClipboard(context);
    this.page = await context.newPage();
    this.page.setDefaultTimeout(10000);
    const errors = [];
    this.page.on('pageerror', error => errors.push(error.message));
    await this.page.goto(base + '/dashboard');
    await this.page.waitForFunction(() => window.app?.manualSecrets.length);
    await this.show(this.alias);
    const token = this.page.locator('.app-change-text [data-secret-key]').first();
    await token.hover();
    assert.equal(await token.evaluate(node => getComputedStyle(node).cursor), 'help');
    await this.page.keyboard.down('Control');
    assert.equal(await token.evaluate(node => getComputedStyle(node).cursor), 'pointer');
    await this.page.keyboard.up('Control');
    assert.equal(await token.evaluate(node => getComputedStyle(node).cursor), 'help');
    await token.click();
    const hint = this.page.locator('.app-change-text gv-hint').first();
    assert.equal(await hint.evaluate(node => node.readState().pinned), true);
    await hint.getByRole('button', { name: 'Копировать значение', exact: true }).click();
    assert.equal(await this.page.evaluate(() => navigator.clipboard.readText()), 'value / encoded');
    await this.page.keyboard.press('Escape');
    await this.page.evaluate(() => { window.app.searchQuery = 'NO_MATCH'; document.getElementById('searchInput').value = 'NO_MATCH'; });
    await token.click({ modifiers: ['Control'] });
    await this.destination(this.key, 'manual');
    assert.equal(await this.page.locator('#searchInput').inputValue(), '');
    await this.show('$${<' + this.key + '__GV_URL>}');
    const encoded = this.page.locator('.app-change-text [data-secret-key]').first();
    assert.equal(await encoded.getAttribute('data-secret-key'), this.key);
    await encoded.focus();
    await this.page.keyboard.press('Control+Enter');
    await this.destination(this.key, 'manual');
    await this.show(this.autoAlias);
    const autoToken = this.page.locator('.app-change-text [data-secret-key]').first();
    await autoToken.click();
    const panelToken = this.page.locator('.app-change-text gv-hint .title [data-secret-key]');
    await panelToken.click({ modifiers: ['Control'] });
    await this.destination(this.autoKey, 'auto');
    await this.page.keyboard.down('Control');
    await this.page.evaluate(() => window.dispatchEvent(new Event('blur')));
    assert.equal(await this.page.evaluate(() => document.documentElement.classList.contains('app-secret-control')), false);
    await this.page.keyboard.up('Control');
    await this.show(this.alias);
    await this.page.evaluate(() => {
      const node = document.querySelector('.app-change-text');
      const range = document.createRange();
      range.selectNodeContents(node);
      getSelection().removeAllRanges();
      getSelection().addRange(range);
      node.querySelector('[data-secret-key]').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    assert.equal(await this.page.evaluate(() => window.app.activeMainTab), 'overview');
    await this.page.evaluate(() => getSelection().removeAllRanges());
    await fetch(base + '/api/vault/secret/' + encodeURIComponent(this.key), { method: 'DELETE' });
    await this.page.locator('.app-change-text [data-secret-key]').first().click({ modifiers: ['Control'] });
    await this.page.waitForFunction(() => document.getElementById('toast').message.includes('больше не сохранён'));
    assert.equal(await this.page.evaluate(() => window.app.activeMainTab), 'overview');
    await this.show('$${<unknown-key>}');
    assert.equal(await this.page.locator('.app-change-text [data-secret-key]').count(), 0);
    assert.deepEqual(errors, []);
    console.log('PASS: Ctrl stationary cursor/release/blur, exact Unicode key, encoded alias, manual/auto, clear search, scroll/focus/highlight, hint navigation/copy, ordinary pin, selection, deleted/unknown');
  };

  show = async alias => this.page.evaluate(alias => {
    window.app.switchMainTab('overview');
    window.app.overview.step = { timestamp: new Date().toISOString(), maskedPrompt: JSON.stringify({ messages: [{ role: 'user', content: 'Before ' + alias + ' after' }] }), response: { body: 'reply', status: 200 } };
    window.app.overview.renderConversation();
  }, alias);

  destination = async (key, category) => {
    await this.page.waitForFunction(({ key, category }) => window.app.activeMainTab === 'secrets' && window.app.secretsSubTab === category && document.activeElement?.dataset.secretRecord === key, { key, category });
    const target = this.page.locator('.app-secret-target');
    assert.equal(await target.count(), 1);
    assert.equal(await target.getAttribute('data-secret-record'), key);
    assert.equal(await target.isVisible(), true);
    await this.page.waitForFunction(() => {
      const box = document.querySelector('.app-secret-target')?.getBoundingClientRect();
      return box && box.top >= 0 && box.top < innerHeight;
    });
  };

  close = async () => { await this.browser?.close(); await this.host.close(); };
}

const check = new SecretNavigationCheck();
try { await check.run(); } finally { await check.close(); }

