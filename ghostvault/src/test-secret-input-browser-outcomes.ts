import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const mode = process.argv[2] || '--provider-unavailable';
assert.ok(['--provider-unavailable', '--cleanup-pending'].includes(mode));
const pending = mode === '--cleanup-pending';
const stage = path.resolve('.cache/secret-vault-ui');
const evidence = path.resolve('.cache/secret-intake-browser');
mkdirSync(evidence, { recursive: true });
const executablePath = ['C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].find(existsSync);
const child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/secret-input/test-browser-fixture.ts'), mode], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines = createInterface({ input: child.stdout });
const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
const timer = setTimeout(() => child.kill(), 60000);
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const browser = await chromium.launch({ executablePath, headless: true });
const context = await browser.newContext({ viewport: { width: 1200, height: 900 } });
const page = await context.newPage();
page.setDefaultTimeout(10000);
const secret = 'synthetic-browser-outcome-value';
let submits = 0;
const responses: Array<Promise<any>> = [];
try {
  const line = await new Promise<string>((resolve, reject) => { lines.once('line', resolve); child.once('error', reject); child.once('exit', code => reject(new Error('Fixture ended before ready: ' + code))); });
  const fixture = JSON.parse(line) as { origin: string };
  await context.route(fixture.origin + '/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith('/api/') || pathname === '/mcp') return route.continue();
    const file = pathname === '/' || pathname.startsWith('/vault-secret/') ? path.join(stage, 'index.html') : path.resolve(stage, '.' + decodeURIComponent(pathname));
    if (!file.startsWith(stage + path.sep) || !existsSync(file)) return route.continue();
    const types: Record<string, string> = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.woff2': 'font/woff2' };
    await route.fulfill({ status: 200, body: readFileSync(file), contentType: types[path.extname(file)] || 'application/octet-stream', headers: { 'cache-control': 'no-store', 'referrer-policy': 'no-referrer' } });
  });
  page.on('request', request => { if (new URL(request.url()).pathname.endsWith('/submit')) submits++; });
  page.on('response', response => { if (new URL(response.url()).pathname.endsWith('/submit')) responses.push(response.json()); });
  await page.goto(fixture.origin + (pending ? '/vault-secret/update?secrets=SEED_ORDINARY' : '/vault-secret/new?secrets=UNAVAILABLE_TEST'));
  await page.locator('#secretInputForm').waitFor({ state: 'visible' });
  await page.locator('gv-field[id$="Value"] input').fill(secret);
  await page.locator('#secretInputForm gv-action[type="submit"]').click();
  await page.locator('#secretInputResult').waitFor({ state: 'visible' });
  await page.getByRole('heading', { name: pending ? 'Секретные значения сохранены' : 'Значения не сохранены', exact: true }).waitFor();
  if (pending) await page.locator('#secretInputCleanupNotice').waitFor({ state: 'visible' });
  else await page.getByRole('link', { name: 'Открыть новую форму', exact: true }).waitFor();
  assert.equal(await page.locator('gv-field[id$="Value"]').count(), 0);
  assert.equal(submits, 1);
  const results = await Promise.all(responses);
  assert.equal(results.length, 1);
  if (pending) {
    assert.equal(results[0].state, 'completed');
    assert.equal(results[0].notice.code, 'SECRET_STORAGE_CLEANUP_PENDING');
    assert.equal(await page.getByRole('link', { name: 'Открыть новую форму', exact: true }).count(), 0);
  } else {
    assert.equal(results[0].request.state, 'failed');
    assert.equal(results[0].error.code, 'PROVIDER_UNAVAILABLE');
  }
  const storage = await page.evaluate('JSON.stringify({local:Object.entries(localStorage),session:Object.entries(sessionStorage)})') as string;
  for (const text of [JSON.stringify(results), storage, await page.locator('body').innerText(), page.url()]) assert.equal(text.includes(secret), false);
  await page.screenshot({ path: path.join(evidence, mode.slice(2) + '.png'), fullPage: true });
  writeFileSync(path.join(evidence, mode.slice(2) + '.json'), JSON.stringify({ passed: true, state: pending ? 'completed_with_notice' : 'failed_with_restart', submitCount: submits, inputsCleared: true, noAutomaticRetry: true }, null, 2));
  console.log('Actual browser ' + mode.slice(2) + ' outcome/clear/no retry PASS');
} finally {
  await context.close();
  await browser.close();
  child.stdin.end('close\n');
  assert.equal(await exited, 0);
  clearTimeout(timer);
  lines.close();
  assert.equal(stderr, '');
}
