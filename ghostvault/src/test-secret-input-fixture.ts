import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const child = spawn(process.execPath, [path.resolve('node_modules/tsx/dist/cli.mjs'), path.resolve('src/secret-input/test-browser-fixture.ts')], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
const lines = createInterface({ input: child.stdout });
const exited = new Promise<number | null>(resolve => child.once('exit', resolve));
const timer = setTimeout(() => child.kill(), 10000);
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
try {
  const line = await new Promise<string>((resolve, reject) => {
    lines.once('line', resolve);
    child.once('error', reject);
    child.once('exit', code => reject(new Error('Fixture stopped before ready: ' + code)));
  });
  const fixture = JSON.parse(line) as { origin: string; directory: string; seedNames: string[] };
  assert.match(fixture.origin, /^http:\/\/127\.0\.0\.1:[0-9]+$/);
  assert.deepEqual(fixture.seedNames, ['SEED_ORDINARY', 'SEED_PROTECTED']);
  assert.equal((await fetch(fixture.origin + '/vault-secret/new')).status, 200);
  const response = await fetch(fixture.origin + '/api/secret-input/session', { method: 'POST', headers: { origin: fixture.origin, 'content-type': 'application/json', 'x-ghostvault-input': '1' }, body: '{}' });
  assert.equal(response.status, 200);
  child.stdin.end('close\n');
  assert.equal(await exited, 0);
  assert.equal(stderr, '');
  console.log('Real browser fixture startup/page/API/graceful teardown PASS');
} finally { clearTimeout(timer); lines.close(); if (child.exitCode === null) child.kill(); }
