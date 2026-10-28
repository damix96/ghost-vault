import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';

test('every public export ships JS/types or CSS and local icons', async () => {
  const metadata = JSON.parse(await readFile('package.json', 'utf8'));
  for (const value of Object.values(metadata.exports)) {
    for (const path of typeof value === 'string' ? [value] : Object.values(value)) assert.ok((await readFile(resolve(path))).length > 0);
  }
  assert.equal((await readdir('dist/icons')).filter(name => name.endsWith('.svg')).length, 9);
  assert.equal((await readdir('dist/licenses')).length, 3);
  const css = await readFile('dist/styles.css', 'utf8');
  assert.ok(css.includes('--wa-color-surface-default'));
  assert.ok(css.includes('--gv-surface'));
  assert.ok(css.includes('.flex-wrap'));
  assert.ok(css.includes('.sr-only'));
  assert.equal(/@import\s|https?:\/\/[^*\s]+\.(woff|css)/.test(css), false);
});

test('JS artifact has no CSS imports or eager vendor registration import', async () => {
  const source = await readFile('dist/index.js', 'utf8');
  assert.equal(/^import .*\.css["'];?$/m.test(source), false);
  assert.equal(/^import .*@awesome\.me/m.test(source), false);
  const kit = await import('@ghostvault/ui-kit');
  assert.equal(kit.UI_KIT_VERSION, '0.1.0');
  await assert.rejects(kit.registerKit(), /browser DOM/);
});
