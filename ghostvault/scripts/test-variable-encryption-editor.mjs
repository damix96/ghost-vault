import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

class EncryptionEditorChecks {
  host = new UiTestHost();
  changes = [];
  errors = [];
  original = '  editor-secret-雪\r\nline  ';
  replacement = ' next-secret-Ж\nline ';
  current = () => this.vault.getManualSecrets().find(entry => entry.key === 'CREDENTIAL');
  edit = async () => {
    await this.page.evaluate(() => window.app.openModal('CREDENTIAL'));
    await this.page.locator('#secretForm').waitFor({ state: 'visible' });
    assert.equal(await this.page.locator('#modalEncryptInput').isDisabled(), false);
  };
  close = async () => {
    await this.page.locator('#cancelModalBtn').click();
    await this.page.locator('#secretForm').waitFor({ state: 'hidden' });
  };
  save = async () => {
    const response = this.page.waitForResponse(response => new URL(response.url()).pathname === '/api/vault/secret/CREDENTIAL' && response.request().method() === 'PATCH', { timeout: 5000 });
    await this.page.locator('#secretForm gv-action[type="submit"]').click();
    assert.equal((await response).status(), 200);
    await this.page.locator('#secretForm').waitFor({ state: 'hidden' });
    assert.equal(this.current().alias, this.alias);
    assert.equal(await this.page.locator('#modalValInput').evaluate(field => field.value), '');
  };
  run = async () => {
    await this.host.init();
    this.vault = this.host.server.getVault();
    this.vault.setManualSecret('CREDENTIAL', this.original, 'description', true);
    this.alias = this.current().alias;
    const base = await this.host.server.listen();
    this.browser = await chromium.launch({ executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', headless: true });
    const context = await this.browser.newContext({ reducedMotion: 'reduce' });
    await context.addInitScript(() => localStorage.setItem('ghostvault.hide-encrypted', 'true'));
    await this.host.isolateClipboard(context);
    this.page = await context.newPage();
    this.page.on('pageerror', error => this.errors.push(error.message));
    this.page.on('request', request => { if (request.method() === 'PATCH' && new URL(request.url()).pathname === '/api/vault/secret/CREDENTIAL') this.changes.push(request.postDataJSON()); });
    await this.page.route('**/*', route => new URL(route.request().url()).origin === base ? route.continue() : route.abort());
    await this.page.goto(base + '/dashboard#secrets');
    await this.page.waitForFunction(() => window.app?.manualSecrets.some(entry => entry.key === 'CREDENTIAL'));
    await this.edit();
    assert.equal(await this.page.locator('#modalValInput textarea').inputValue(), '');
    assert.equal(await this.page.locator('#secretStorageNote, #secretSaveEffect').count(), 0);
    await this.page.locator('#modalEncryptInput').uncheck();
    await this.save();
    assert.equal(this.current().isSecret, false);
    assert.equal(this.current().realValue, this.original);
    assert.equal('realValue' in this.changes[0], false);
    await this.edit();
    await this.page.locator('#modalValInput textarea').fill('');
    await this.page.locator('#modalEncryptInput').check();
    await this.save();
    assert.equal(this.current().isSecret, true);
    assert.equal(this.current().realValue, this.original);
    await this.edit();
    await this.page.locator('#modalValInput textarea').fill(this.replacement);
    await this.page.locator('#modalEncryptInput').uncheck();
    await this.save();
    assert.equal(this.current().isSecret, false);
    assert.equal(this.current().realValue, this.replacement);
    assert.equal(this.changes[2].isSecret, false);
    assert.equal(this.changes[2].realValue, this.replacement);
    await this.edit();
    await this.page.locator('#modalEncryptInput').check();
    await this.page.locator('#modalValInput textarea').fill('cancelled-value');
    await this.close();
    assert.equal(await this.page.locator('#modalValInput').evaluate(field => field.value), '');
    assert.equal(this.current().realValue, this.replacement);
    await this.edit();
    await this.page.locator('#modalEncryptInput').check();
    await this.save();
    await this.page.locator('#interfaceSettingsBtn').click();
    await this.page.locator('#hideEncrypted').uncheck();
    await this.page.waitForFunction(() => window.app.manualSecrets.find(entry => entry.key === 'CREDENTIAL')?.realValue !== undefined);
    await this.page.evaluate(() => document.getElementById('interfaceSettings').hide());
    await this.page.locator('#hideEncrypted').waitFor({ state: 'hidden' });
    await this.edit();
    assert.equal(await this.page.locator('#modalValInput textarea').inputValue(), this.replacement);
    await this.page.locator('#modalValInput textarea').fill('');
    await this.page.locator('#modalEncryptInput').uncheck();
    await this.page.route('**/api/vault/secret/CREDENTIAL', async route => {
      const response = await route.fetch();
      assert.equal(response.status(), 200);
      await route.abort('failed');
    }, { times: 1 });
    await this.page.locator('#secretForm gv-action[type="submit"]').click();
    await this.page.waitForFunction(() => window.app.modals.review && !window.app.modals.pending.has('secret'));
    assert.equal(this.current().isSecret, false);
    assert.equal(this.current().realValue, this.replacement);
    await this.page.locator('#secretForm gv-action[type="submit"]').click();
    await this.page.waitForFunction(() => !window.app.modals.pending.has('secret') && document.getElementById('secretFormError').message.includes('Список обновлён'));
    assert.equal(this.changes.length, 5);
    await this.close();
    assert.deepEqual(this.errors, []);
    const directory = new URL('../.cache/encryption-editor/', import.meta.url);
    await mkdir(directory, { recursive: true });
    await writeFile(new URL('result.json', directory), JSON.stringify({ result: 'PASS', runtime: process.version, writes: this.changes.length, pageErrors: this.errors, screenshots: 0, checks: ['hidden original retained on disable', 'reencrypt without value input', 'atomic replace and disable', 'cancel clears input', 'visible original in editor', 'lost response has no write replay', 'stable alias and exact values'] }, null, 2));
    console.log('PASS reversible encryption editor: five writes, exact values, stable token, no replay');
  };
  dispose = async () => { await this.browser?.close(); await this.host.close(); };
}

const test = new EncryptionEditorChecks();
try { await test.run(); } finally { await test.dispose(); }
