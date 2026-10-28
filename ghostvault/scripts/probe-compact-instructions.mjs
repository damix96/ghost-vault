import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { chromium } from 'playwright-core';
import { UiTestHost } from './ui-test-host.mjs';

const host = new UiTestHost();
await host.init();
const base = await host.app.listen({ port: 0, host: '127.0.0.1' });
const read = async path => (await fetch(base + path)).json();
for (const [name, prefix, upstreamUrl] of [['Isolated OpenAI', 'synthetic-openai', 'https://api.openai.com/v1'], ['Isolated custom', 'synthetic-custom', 'https://synthetic.invalid/v1']]) {
  const response = await fetch(base + '/api/routes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, prefix, upstreamUrl }) });
  assert.equal(response.status, 201);
}
const paths = ['/api/routes', '/api/vault', '/api/patterns', '/api/sessions'];
const initial = await Promise.all(paths.map(read));
const find = prefix => initial[0].find(route => new URL(route.cliUrl || route.incomingUrl).pathname === '/' + prefix + '/v1');
const routes = ['anthropic', 'openai', 'ollama', 'opencode', 'opencode-go', 'synthetic-openai', 'synthetic-custom'].map(find);
const browser = await chromium.launch({ headless: true, executablePath: process.env.BROWSER_PATH });
const context = await browser.newContext({ viewport: { width: 1440, height: 1080 } });
await host.isolateClipboard(context);
const page = await context.newPage();
page.setDefaultTimeout(8000);
const writes = [];
const external = [];
const errors = [];
const snapshots = {};
page.on('request', request => {
  if (!['GET', 'HEAD'].includes(request.method())) writes.push(request.method() + ' ' + request.url());
  if (!request.url().startsWith(base) && !request.url().startsWith('data:')) external.push(request.url());
});
page.on('pageerror', error => errors.push(error.message));
await page.route('**/*', route => route.request().url().startsWith(base) || route.request().url().startsWith('data:') ? route.continue() : route.abort());
const dialog = page.locator('#connectionSettingsDialog');
const open = async (route, list) => {
  const actions = page.locator(list + ' [data-action="route-open"]');
  const index = (await actions.evaluateAll(nodes => nodes.map(node => JSON.parse(node.dataset.args)[0]))).indexOf(route.id);
  assert.ok(index >= 0);
  const button = actions.nth(index).getByRole('button', { name: 'Как подключить', exact: true });
  await button.click();
  await page.getByRole('dialog', { name: 'Подключить приложение · ' + route.name, exact: true }).waitFor();
};
const close = async () => {
  await dialog.getByRole('button', { name: 'Закрыть инструкцию', exact: true }).click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
};
const expand = heading => dialog.getByRole('button', { name: heading, exact: true }).click();
const copy = async name => {
  await dialog.getByRole('button', { name, exact: true }).click();
  await page.waitForFunction(() => !document.getElementById('connectionCopyStatus').hidden);
  return page.evaluate(() => navigator.clipboard.readText());
};
try {
  await page.goto(base + '/dashboard');
  await page.waitForFunction(() => window.app?.overview.routes.length >= 7);
  assert.equal(await page.getByRole('heading', { name: 'Куда отправлять запросы?', exact: true }).isVisible(), true);
  assert.match(await page.locator('#overviewRoutes .app-route-columns').innerText(), /CLI → VAULT/);
  assert.doesNotMatch(await page.locator('#overviewRoutes').ariaSnapshot(), /Адрес для приложения/);
  assert.equal(await page.locator('#firstRunGuide li').count(), 3);
  assert.equal(await page.getByRole('button', { name: 'Как читать пояснения к кнопкам', exact: true }).count(), 0);
  assert.equal(await page.locator('[data-detail-id="first-run-hints"]').count(), 0);
  assert.equal(await page.locator('#overviewRoutes [data-action="route-open"] gv-hint').count(), 0);
  if (process.env.COMPACT_SCREENSHOT_DIR) await page.screenshot({ path: process.env.COMPACT_SCREENSHOT_DIR + '/first-run.png', fullPage: true });
  assert.equal(await page.locator('#firstRunGuide li').first().innerText(), 'Куда отправлять запросы? Выберите получателя ниже.');
  assert.doesNotMatch(await page.locator('#firstRunGuide').ariaSnapshot(), /сервис модели|HTTP-пример|Console|API key/);
  assert.ok((await page.locator('#firstRunGuide').ariaSnapshot()).split(/\s+/).length < 70);
  for (const list of ['#overviewRoutes', '#connectionsList']) {
    if (list === '#connectionsList') await page.getByRole('button', { name: 'Подключения', exact: true }).click();
    for (const route of routes) {
      await open(route, list);
      const snapshot = await dialog.ariaSnapshot();
      const prefix = new URL(route.cliUrl || route.incomingUrl).pathname.split('/')[1];
      assert.ok(snapshot.split(/\s+/).length < 120, prefix + ' default instruction too long');
      assert.doesNotMatch(snapshot, /Read-Host|throw |ANTHROPIC_API_KEY|Введите ключ|apiKey/);
      assert.doesNotMatch(snapshot, /PowerShell|Python|\$env:|client\.with_options|plugin/);
      assert.equal(await dialog.getByRole('textbox').count(), 0);
      assert.deepEqual(await dialog.locator('gv-details').evaluateAll(nodes => nodes.map(node => node.open)), await dialog.locator('gv-details').evaluateAll(nodes => nodes.map(() => false)));
      if (list === '#overviewRoutes') snapshots[prefix] = snapshot;
      else assert.equal(snapshot, snapshots[prefix]);
      const incoming = route.cliUrl || route.incomingUrl;
      for (const code of await dialog.locator('pre.app-code:visible').all()) assert.ok(await code.evaluate(element => element.clientHeight + 1 >= parseFloat(getComputedStyle(element).lineHeight)), 'Code line must not be clipped');
      if (prefix === 'anthropic') {
        const expected = 'ANTHROPIC_BASE_URL=' + incoming.replace(/\/v1$/, '');
        assert.equal(await copy('Скопировать настройку'), expected);
        assert.equal(await dialog.locator('pre.app-code').first().textContent(), expected);
        await expand('Как задать переменную');
        const example = "$env:ANTHROPIC_BASE_URL = '" + incoming.replace(/\/v1$/, '') + "'\nclaude";
        assert.equal(await copy('Скопировать пример PowerShell'), example);
        assert.equal(await dialog.locator('pre.app-code').nth(1).textContent(), example);
        await writeFile('../.cache/compact-claude-example.ps1', example);
      } else if (['openai', 'ollama'].includes(prefix)) {
        assert.equal(await copy('Скопировать Base URL'), incoming);
        assert.equal(await dialog.locator('pre.app-code').first().textContent(), incoming);
        await expand('Примеры настройки');
        await expand('Python OpenAI SDK');
        const example = 'client = client.with_options(base_url=' + JSON.stringify(incoming) + ')';
        assert.equal(await copy('Скопировать пример Python'), example);
        assert.equal(await dialog.locator('pre.app-code').nth(1).textContent(), example);
        await expand('Проверочный запрос: PowerShell');
        const diagnostic = await copy('Скопировать запрос PowerShell');
        assert.match(diagnostic, /Read-Host 'Model ID/);
        assert.match(diagnostic, /\/models/);
        assert.match(diagnostic, /\/chat\/completions/);
        assert.equal(diagnostic, await dialog.locator('pre.app-code').nth(2).textContent());
        assert.match(await dialog.ariaSnapshot(), /Этот проверочный запрос обращается к модели/);
        await writeFile('../.cache/compact-' + prefix + '-diagnostic.ps1', diagnostic);
      } else if (prefix === 'opencode') {
        assert.equal(await copy('Скопировать Base URL'), incoming);
        assert.equal(await dialog.locator('pre.app-code').first().textContent(), incoming);
        await expand('Пример для одной модели');
        const nativeCopied = await copy('Скопировать настройку модели');
        assert.deepEqual(JSON.parse(nativeCopied), { providers: { opencode: { models: { 'deepseek-v4.1-flash': { settings: { baseURL: incoming } } } } } });
        assert.equal(nativeCopied, await dialog.locator('gv-details[data-detail-id="zen-native.' + route.id + '"] pre.app-code').first().textContent());
        assert.doesNotMatch(nativeCopied, /plugins|apiKey|canonical|package|"model"/);
        assert.equal(await copy('Скопировать команду запуска'), 'opencode --standalone');
        await expand('Отдельное подключение ghostvault-zen');
        const copied = await copy('Скопировать фрагмент plugins');
        const config = JSON.parse(copied);
        assert.deepEqual(Object.keys(config), ['plugins']);
        assert.equal(config.plugins[0].options.baseURL, incoming);
        assert.equal(config.plugins[0].options.nativeTransport, false);
        assert.equal(config.plugins[0].package, 'file:///E:/projects/aegis-gate/ghostvault/opencode/zen-connection');
        assert.equal(copied, await dialog.locator('gv-details[data-detail-id="zen-alias.' + route.id + '"] pre.app-code').first().textContent());
        await expand('Бесплатные модели и relay');
        assert.match(await dialog.ariaSnapshot(), /nativeTransport: false/);
        assert.match(await dialog.ariaSnapshot(), /ghostvault-zen\/big-pickle/);
      } else {
        assert.equal(await dialog.locator('pre.app-code').count(), 0);
        assert.match(snapshot, prefix === 'opencode-go' ? /нет проверенной инструкции/ : /Уточните, из какого приложения/);
      }
      await expand('Адрес CLI → VAULT');
      assert.equal(await copy('Скопировать адрес CLI → VAULT'), prefix === 'anthropic' ? incoming.replace(/\/v1$/, '') : incoming);
      if (process.env.COMPACT_SCREENSHOT_DIR && list === '#overviewRoutes') {
        await close();
        await open(route, list);
        await page.getByRole('dialog').screenshot({ path: process.env.COMPACT_SCREENSHOT_DIR + '/' + prefix + '.png' });
      }
      await close();
    }
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await open(find('ollama'), '#connectionsList');
  assert.equal(await page.locator('#connectionsList .app-mobile-label').first().textContent(), 'CLI → VAULT');
  assert.equal(await dialog.getByRole('button', { name: 'Скопировать Base URL', exact: true }).isVisible(), true);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const action = dialog.locator('gv-action[data-action="route-copy"]').first();
  assert.equal(await action.evaluate(element => element.hintPinButton), false);
  assert.equal(await page.getByRole('button', { name: 'Закрепить подсказку', exact: true }).count(), 0);
  assert.deepEqual(await Promise.all(paths.map(read)), initial);
  const changed = await fetch(base + '/api/routes/' + find('openai').id, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ upstreamUrl: 'https://synthetic.invalid/another-api' }) });
  assert.equal(changed.status, 200);
  await close();
  await page.getByRole('button', { name: 'Обзор', exact: true }).click();
  await page.getByRole('button', { name: 'Обновить страницу', exact: true }).click();
  await page.getByRole('button', { name: 'Подключения', exact: true }).click();
  await open(find('openai'), '#connectionsList');
  const changedSnapshot = await dialog.ariaSnapshot();
  assert.match(changedSnapshot, /Адрес сервиса OpenAI изменён/);
  assert.equal(await dialog.locator('pre.app-code').count(), 0);
  assert.equal(await dialog.getByRole('button', { name: 'Скопировать пример Python', exact: true }).count(), 0);
  snapshots['changed-openai'] = changedSnapshot;
  assert.deepEqual(await Promise.all(paths.slice(1).map(read)), initial.slice(1));
  assert.deepEqual(writes, []);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  const report = { isolated: true, clipboard: 'browser-memory double', fixture_route_creates: 2, fixture_route_updates: 1, same_text_overview_and_catalog: true, all_instruction_cases: snapshots, custom_url_does_not_select_sdk: true, changed_openai_target_has_no_sdk_recipe: true, default_details_closed: true, exact_display_and_copy: true, diagnostics_and_zen_options_preserved: true, first_run_three_short_steps: true, destination_label: 'Куда отправлять запросы?', mobile_primary_visible: true, optional_pin_default_false: true, browser_api_writes: writes, external_requests: external, page_errors: errors, all_memory_api_state_unchanged_before_explicit_target_fixture_update: true, vault_patterns_sessions_unchanged: true, client_commands_executed: false };
  if (process.env.COMPACT_REPORT) await writeFile(process.env.COMPACT_REPORT, JSON.stringify(report, null, 2));
  console.log('PASS compact instructions: all presets/custom, both entry points, exact copy, optional diagnostics/plugin/free modes, unknown/changed target boundaries, no client/cloud/auth execution');
} catch (error) {
  console.error(await page.locator('body').ariaSnapshot());
  throw error;
} finally {
  await browser.close();
  await host.close();
}
