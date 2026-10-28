import { spawn } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import assert from 'node:assert/strict';

const server = spawn(process.execPath, [resolve('node_modules/vite/bin/vite.js'), 'preview', '--host', '127.0.0.1', '--port', '5178', '--strictPort'], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
const ready = new Promise((done, reject) => {
  const timer = setTimeout(() => reject(new Error('Preview did not start within five seconds')), 5000);
  server.stdout.on('data', chunk => {
    if (!chunk.toString().includes('127.0.0.1:5178')) return;
    clearTimeout(timer);
    done();
  });
  server.once('error', error => { clearTimeout(timer); reject(error); });
  server.once('exit', code => { clearTimeout(timer); reject(new Error(`Preview exited: ${code}`)); });
});

try {
  await ready;
  const base = 'http://127.0.0.1:5178/';
  const response = await fetch(base);
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.ok(html.includes('gv-playground'));
  assert.ok(html.includes('./assets/'));
  for (const directory of ['assets', 'icons']) {
    for (const name of await readdir(resolve('playground-dist', directory))) {
      const asset = await fetch(new URL(`${directory}/${name}`, base));
      assert.equal(asset.status, 200, name);
      const expected = await readFile(resolve('playground-dist', directory, name));
      assert.deepEqual(Buffer.from(await asset.arrayBuffer()), expected, name);
    }
  }
  console.log('HTTP smoke: HTML and every local JS/CSS/SVG asset match the built artifact; no browser interaction run');
} finally {
  server.kill();
}
