import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';
import { PatternEngine } from '../dist/vault/pattern-engine.js';

class RuleEditorCheck {
  host = new UiTestHost();
  request = async (path, options = {}) => fetch(this.base + path, { ...options, headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' } });
  edit = async id => {
    const actions = this.page.locator('[data-action="rule-edit"]');
    const index = await actions.evaluateAll((nodes, id) => nodes.findIndex(node => JSON.parse(node.dataset.args)[0] === id), id);
    assert.ok(index >= 0);
    await actions.nth(index).getByRole('button').click();
  };

  run = async () => {
    await this.host.init();
    this.base = await this.host.app.listen({ port: 0, host: '127.0.0.1' });
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    this.page = await this.browser.newPage();
    this.page.setDefaultTimeout(10000);
    const errors = [];
    this.page.on('pageerror', error => errors.push(error.message));
    await this.page.goto(this.base + '/dashboard#rules');
    await this.page.waitForFunction(() => window.app?.patterns.length);
    const initial = (await (await this.request('/api/patterns')).json()).find(row => row.id === 'pat_private_ip');
    assert.ok(await this.page.locator('.app-rule-expression').count() >= 5);
    assert.ok((await this.page.locator('.app-rule-expression').allTextContents()).includes(initial.pattern));
    await this.edit(initial.id);
    assert.equal(await this.page.locator('#ruleEditorForm [name="name"]').inputValue(), initial.name);
    const regex = this.page.locator('#ruleEditorForm [name="pattern"]');
    await regex.fill('[');
    await this.page.locator('#ruleEditorForm [type="submit"]').click();
    assert.equal(await this.page.locator('#ruleEditorDialog').evaluate(node => node.open), true);
    assert.match(await this.page.locator('#ruleEditorError').evaluate(node => node.message), /Некорректное/);
    await regex.fill('CUSTOM_[A-Z]+');
    await this.page.evaluate(() => window.app.fetchPatterns());
    assert.equal(await regex.inputValue(), 'CUSTOM_[A-Z]+');
    await this.request('/api/patterns/' + initial.id + '/toggle', { method: 'POST', body: '{}' });
    await this.page.locator('#ruleEditorForm [type="submit"]').click();
    await this.page.waitForFunction(() => document.getElementById('ruleEditorError').message.includes('изменилось'));
    assert.equal(await regex.inputValue(), 'CUSTOM_[A-Z]+');
    await this.page.locator('[data-rule-cancel]').click();
    await this.page.evaluate(() => window.app.fetchPatterns());
    await this.edit(initial.id);
    assert.equal(await this.page.locator('#ruleEditorForm [name="enabled"]').isChecked(), false);
    await regex.fill('CUSTOM_[A-Z]+');
    await this.page.locator('#ruleEditorForm [name="name"]').fill('My private rule');
    await this.page.locator('#ruleEditorForm [name="type"]').fill('billing');
    await this.page.locator('#ruleEditorForm [type="submit"]').click();
    await this.page.waitForFunction(() => !document.getElementById('ruleEditorDialog').open);
    const saved = (await (await this.request('/api/patterns')).json()).find(row => row.id === initial.id);
    assert.equal(saved.pattern, 'CUSTOM_[A-Z]+');
    assert.equal(saved.name, 'My private rule');
    assert.equal(saved.type, 'billing');
    assert.equal(saved.enabled, 0);
    assert.equal(saved.created_at, initial.created_at);
    new PatternEngine(this.host.database);
    assert.equal(this.host.database.getPatterns().find(row => row.id === initial.id).pattern, saved.pattern);
    await this.page.waitForFunction(id => document.activeElement?.closest('[data-action="rule-edit"]') && JSON.parse(document.activeElement.closest('[data-action="rule-edit"]').dataset.args)[0] === id, initial.id);
    assert.equal(new URL(this.page.url()).hash, '#rules');
    await this.edit('pat_any_ip');
    assert.match(await this.page.locator('#ruleRegexHelp').innerText(), /IPv4\/IPv6/);
    await regex.fill('DRAFT_KEPT');
    await this.page.keyboard.press('Escape');
    await this.edit('pat_any_ip');
    assert.equal(await regex.inputValue(), 'DRAFT_KEPT');
    await this.request('/api/patterns/pat_any_ip', { method: 'DELETE' });
    await this.page.evaluate(() => window.app.fetchPatterns());
    assert.equal(await this.page.locator('#ruleEditorForm [type="submit"]').isDisabled(), true);
    assert.equal(await regex.inputValue(), 'DRAFT_KEPT');
    const bad = await this.request('/api/patterns/' + initial.id, { method: 'PUT', body: JSON.stringify({ ...saved, pattern: '[', baseline: saved }) });
    assert.equal(bad.status, 400);
    assert.equal(this.host.database.getPatterns().find(row => row.id === initial.id).pattern, saved.pattern);
    assert.deepEqual(errors, []);
    console.log('PASS: built-in regex visible/editable, validation preserves draft, refresh isolation, optimistic conflict, field/ID/timestamp preservation, restart persistence, focus/page, retained draft, deleted rule, any-IP semantics');
  };

  close = async () => { await this.browser?.close(); await this.host.close(); };
}

const check = new RuleEditorCheck();
try { await check.run(); } finally { await check.close(); }
