import assert from 'node:assert/strict';
import { readFile, readdir, stat } from 'node:fs/promises';
import { UiTestHost } from './ui-test-host.mjs';
import { fileURLToPath } from 'node:url';

const files = async directory => (await Promise.all((await readdir(directory)).map(async name => {
  const entry = directory + '/' + name;
  return (await stat(entry)).isDirectory() ? files(entry) : [entry];
}))).flat();
const host = new UiTestHost();
await host.init();
const { app, publicRoot } = host;
try {
  const html = await app.inject('/dashboard');
  assert.equal(html.statusCode, 200);
  assert.match(html.body, /<gv-action/);
  assert.doesNotMatch(html.body, /https?:\/\/(?:cdn|unpkg|fonts\.)/);
  const assets = await files(publicRoot);
  const icons = (await readdir(fileURLToPath(new URL('../../ui-kit/dist/icons/', import.meta.url)))).filter(name => name.endsWith('.svg'));
  assert.ok(icons.length > 0, 'Kit icon inventory is empty');
  for (const icon of icons) assert.ok(assets.some(path => path.replaceAll('\\', '/').endsWith('/icons/' + icon)), 'Missing kit icon: ' + icon);
  assert.ok(assets.some(path => path.replaceAll('\\', '/').includes('/licenses/')), 'Missing upstream notices');
  for (const path of assets) {
    const url = '/' + path.slice(publicRoot.length).replaceAll('\\', '/').replace(/^\//, '');
    const response = await app.inject(url);
    assert.equal(response.statusCode, 200, url);
    if (/\.(?:js|css)$/.test(path)) assert.doesNotMatch(await readFile(path, 'utf8'), /(?:cdn\.tailwindcss\.com|unpkg\.com\/lucide|fonts\.googleapis\.com)/);
  }
  console.log(`PASS: production dashboard and ${assets.length} local assets served by existing Fastify registration`);
} finally {
  await host.close();
}
