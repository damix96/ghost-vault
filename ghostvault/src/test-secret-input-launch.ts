import assert from 'node:assert/strict';
import { SecretInputBrowser, BrowserCommand } from './secret-input/browser-launcher.js';

const commands: BrowserCommand[] = [];
const launcher = new SecretInputBrowser('win32', async command => { commands.push(command); return true; });
const address = new URL('http://127.0.0.1:12345/vault-secret/update?secrets=ONE,TWO&request=12345678-1234-4234-8234-123456789abc');
assert.equal(await launcher.open(address), 'attempted');
assert.equal(commands.length, 1);
assert.equal(commands[0].env.GHOSTVAULT_INPUT_URL, address.href);
assert.equal(commands[0].args.at(-1), 'Start-Process -FilePath $env:GHOSTVAULT_INPUT_URL -ErrorAction Stop');
assert.ok(!commands[0].args.some(arg => arg.includes(address.href)));
for (const invalid of ['https://evil.example/vault-secret/new', 'file:///vault-secret/new', 'http://127.0.0.1:12345/api/export', 'http://user:password@localhost/vault-secret/new', 'http://localhost/vault-secret/new?secrets=A%26calc', 'http://localhost/vault-secret/new#credential', 'http://localhost/vault-secret/new?url=https://evil.example']) {
  assert.equal(await launcher.open(new URL(invalid)), 'unavailable');
}
assert.equal(commands.length, 1);
assert.equal(await new SecretInputBrowser('win32', async () => { throw new Error('private process detail'); }).open(address), 'unavailable');
assert.equal(await new SecretInputBrowser('darwin', async command => command.file === '/usr/bin/open' && command.args[0] === address.href).open(address), 'attempted');
console.log('Secret input controlled browser launch PASS');
