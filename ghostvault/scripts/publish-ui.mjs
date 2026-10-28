import assert from 'node:assert/strict';
import { cp, mkdir, readFile, readdir, realpath, rename, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const project = await realpath(fileURLToPath(new URL('../../', import.meta.url)));
const publicRoot = join(project, 'ghostvault/public');
const cache = join(project, '.cache');
const insideProject = path => {
  const name = relative(project, path);
  assert.ok(name && !isAbsolute(name) && name !== '..' && !name.startsWith('..' + sep), 'Release path must stay inside the project');
};
const input = process.argv.slice(2);
assert.ok(input.every(arg => !arg.startsWith('--') || arg === '--check'), 'Unknown release option');
const stage = await realpath(resolve(input.find(arg => !arg.startsWith('--')) || join(cache, 'ghostvault-ui-release')));
insideProject(stage);
insideProject(publicRoot);
assert.notEqual(stage, publicRoot, 'Release source cannot be live public output');
assert.equal(await realpath(publicRoot), publicRoot, 'Live output must be the expected project directory');
const html = await readFile(join(stage, 'index.html'), 'utf8');
assert.match(html, /<gv-action/);
assert.doesNotMatch(html, /cdn\.tailwindcss\.com|unpkg\.com\/lucide|fonts\.googleapis\.com/);
const assets = [...html.matchAll(/(?:src|href)="(\/assets\/[^"?#]+)"/g)].map(match => match[1]);
assert.ok(assets.some(path => path.endsWith('.js')) && assets.some(path => path.endsWith('.css')), 'Missing bundled entry assets');
for (const asset of assets) {
  const path = resolve(stage, '.' + asset);
  const name = relative(stage, path);
  assert.ok(name && !isAbsolute(name) && !name.startsWith('..' + sep), 'Asset escapes staged release');
  assert.ok((await stat(path)).isFile(), 'Missing staged asset: ' + basename(path));
}
assert.ok((await stat(join(stage, 'icons'))).isDirectory());
const icons = (await readdir(join(project, 'ui-kit/dist/icons'))).filter(name => name.endsWith('.svg'));
assert.ok(icons.length > 0, 'Kit icon inventory is empty');
for (const icon of icons) assert.ok((await stat(join(stage, 'icons', icon))).isFile(), 'Missing kit icon: ' + icon);
assert.ok((await stat(join(stage, 'licenses'))).isDirectory());
if (input.includes('--check')) {
  console.log('PASS release validation:', stage, 'live public unchanged');
} else {
  const stamp = Date.now() + '-' + process.pid;
  const next = join(cache, 'ghostvault-ui-next-' + stamp);
  const backup = join(cache, 'ghostvault-ui-backup-' + stamp);
  insideProject(next);
  insideProject(backup);
  await mkdir(cache, { recursive: true });
  await cp(stage, next, { recursive: true });
  await rename(publicRoot, backup);
  try { await rename(next, publicRoot); }
  catch (error) {
    await rename(backup, publicRoot);
    throw error;
  }
  console.log('Published UI:', publicRoot);
  console.log('Previous UI backup:', backup);
  console.log('Restart the existing GhostVault process on port 8767 now to register the new static assets.');
}
