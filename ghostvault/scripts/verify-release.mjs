import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { SecretReleaseVerifier } from './verify-secret-release.mjs';

class ReleaseVerifier {
  execute = async (entry, args, cwd) => {
    const child = spawn(process.execPath, [entry, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], signal: AbortSignal.timeout(20_000) });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.resume();
    const [code] = await once(child, 'exit');
    assert.equal(code, 0);
    return output;
  };

  run = async () => {
    const { values } = parseArgs({ options: { stage: { type: 'string' } } });
    if (!values.stage) throw new Error('Specify --stage');
    const stage = path.resolve(values.stage);
    const entry = path.join(stage, 'dist/runtime/cli.js');
    const manifest = JSON.parse(readFileSync(path.join(stage, 'package.json'), 'utf8'));
    assert.equal(manifest.dependencies['@ghostvault/ui-kit'], undefined);
    assert.ok(readFileSync(path.join(stage, 'README.md'), 'utf8').trim());
    const require = createRequire(path.join(stage, 'package.json'));
    const sdk = relative => import(pathToFileURL(require.resolve('@modelcontextprotocol/sdk/' + relative)).href);
    const [{ Client }, { StdioClientTransport }] = await Promise.all([sdk('client/index.js'), sdk('client/stdio.js')]);
    const root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-release-test-'));
    const probe = createServer();
    await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
    const port = probe.address().port;
    await new Promise(resolve => probe.close(resolve));
    const args = ['--data-dir', path.join(root, 'data'), '--port', String(port)];
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry, 'mcp-bridge', ...args], cwd: root, stderr: 'pipe' });
    const client = new Client({ name: 'release-verifier', version: '1.0.0' });
    let completed = false;
    try {
      await client.connect(transport);
      assert.equal(client.getServerVersion().version, manifest.version);
      assert.ok(client.getInstructions().includes('$${<NAME>}'));
      const tools = await client.listTools();
      assert.equal(tools.tools[0].name, 'ghostvault_list_variables');
      assert.ok((await client.callTool({ name: 'ghostvault_list_variables', arguments: {} })).structuredContent);
      const base = 'http://127.0.0.1:' + port;
      const secrets = new SecretReleaseVerifier(base, client);
      await secrets.run(readFileSync(path.join(stage, 'public/index.html'), 'utf8'));
      const dashboard = await fetch(base + '/index.html');
      assert.equal(dashboard.status, 200);
      assert.equal(await dashboard.text(), readFileSync(path.join(stage, 'public/index.html'), 'utf8'));
      const help = await fetch(base + '/api/client-help');
      assert.equal(help.status, 200);
      const pluginUrl = new URL((await help.json()).zenPlugin);
      assert.equal(pluginUrl.protocol, 'file:');
      const pluginDirectory = realpathSync(fileURLToPath(pluginUrl));
      assert.equal(pluginDirectory, realpathSync(path.join(stage, 'opencode/zen-connection')));
      for (const helper of ['index.mjs', 'native-relay.mjs']) assert.ok(existsSync(path.join(pluginDirectory, helper)));
      const status = JSON.parse(await this.execute(entry, ['status', ...args], root));
      assert.equal(status.state, 'ready');
      assert.equal(status.version, manifest.version);
      const config = path.join(root, 'codex.toml');
      const setup = JSON.parse(await this.execute(entry, ['setup', '--client', 'codex', '--config', config, ...args], root));
      assert.equal(setup.changed, true);
      assert.equal(JSON.parse(await this.execute(entry, ['setup', '--client', 'codex', '--config', config, ...args], root)).changed, false);
      await client.close();
      assert.equal(JSON.parse(await this.execute(entry, ['status', ...args], root)).instanceId, status.instanceId);
      assert.equal(JSON.parse(await this.execute(entry, ['stop', ...args], root)).stopped, true);
      secrets.verifyFiles(path.join(root, 'data', 'vault.db'));
      completed = true;
      console.log(JSON.stringify({ result: 'PASS', stage, node: process.version, version: manifest.version, checks: ['package-readme', 'isolated-installed-sdk', 'stdio-first-start', 'instructions', 'catalog', 'installed-secret-input', 'protected-batch-update', 'secret-status-over-stdio', 'composite-raw-url-proxy', 'standalone-token-preserved', 'restored-secret-not-rescanned', 'protected-public-projections', 'db-wal-canaries', 'built-dashboard', 'client-help-opencode-helpers', 'status', 'idempotent-setup', 'client-independent-lifetime', 'stop'] }));
    } finally {
      await client.close().catch(() => {});
      await this.execute(entry, ['stop', ...args], root).catch(() => {});
      const stopped = await this.execute(entry, ['status', ...args], root).then(output => JSON.parse(output).state === 'stopped', () => false);
      const fixture = realpathSync(root);
      const temporary = realpathSync(os.tmpdir());
      if (completed && stopped && fixture.startsWith(temporary + path.sep) && path.basename(fixture).startsWith('ghostvault-release-test-')) rmSync(fixture, { recursive: true, force: true });
      else {
        console.error('Release verification fixture retained for recovery: ' + fixture);
        console.error('Isolated runtime stopped: ' + stopped);
      }
    }
  };
}

await new ReleaseVerifier().run();
