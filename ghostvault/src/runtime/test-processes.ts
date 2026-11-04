import assert from 'node:assert/strict';
import { spawn, ChildProcess } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { RuntimeSettings } from './settings.js';
import { RuntimeClient } from './client.js';
import { RuntimeLauncher } from './launcher.js';

class ProcessTests {
  private root = mkdtempSync(path.join(os.tmpdir(), 'ghostvault-process-'));
  private fixture = fileURLToPath(new URL('./test-fixture.js', import.meta.url));
  private children = new Set<ChildProcess>();
  private settings?: RuntimeSettings;

  private execute = async (args: string[], cwd = this.root): Promise<{ code: number | null; output: string }> => {
    const child = spawn(process.execPath, [this.fixture, ...args], { cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.add(child);
    let output = '';
    child.stdout?.on('data', chunk => { output += chunk; });
    child.stderr?.on('data', chunk => { if (!String(chunk).includes('ExperimentalWarning') && !String(chunk).includes('trace-warnings')) output += chunk; });
    const timer = setTimeout(() => child.kill(), 20000);
    try { const [code] = await once(child, 'exit'); return { code, output }; }
    finally { clearTimeout(timer); this.children.delete(child); }
  };

  private freePort = async (): Promise<number> => {
    const server = createServer();
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    await new Promise<void>(resolve => server.close(() => resolve()));
    return port;
  };

  private foreground = async (version: string): Promise<ChildProcess> => {
    const child = spawn(process.execPath, [this.fixture, 'serve', ...this.settings!.arguments(), '--fixture-version', version], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    this.children.add(child);
    await Promise.race([once(child.stdout!, 'data'), once(child, 'exit').then(() => { throw new Error('Fixture startup failed'); })]);
    return child;
  };

  public run = async (): Promise<void> => {
    this.settings = new RuntimeSettings({ dataDir: path.join(this.root, 'vault'), port: await this.freePort(), startupTimeoutMs: 8000 });
    const settings = this.settings;
    const launcher = new RuntimeLauncher(settings, this.fixture);
    try {
      const races = await Promise.all(Array.from({ length: 6 }, () => this.execute(['start', ...settings.arguments()])));
      for (const result of races) assert.equal(result.code, 0, result.output);
      const ids = races.map(result => JSON.parse(result.output.trim()).instanceId);
      assert.equal(new Set(ids).size, 1);
      const first = (await launcher.status())!;
      assert.equal(first.instanceId, ids[0]);
      const reused = await this.execute(['start', ...settings.arguments()], settings.packageRoot);
      assert.equal(JSON.parse(reused.output.trim()).instanceId, first.instanceId);
      const otherDir = path.join(this.root, 'loser');
      const loser = await this.execute(['start', '--data-dir', otherDir, '--port', String(settings.port)]);
      assert.equal(loser.code, 1);
      assert.match(loser.output, /Port already in use/);
      assert.equal(existsSync(otherDir), false);
      const competingForce = await Promise.all(Array.from({ length: 4 }, () => this.execute(['start', '-force', ...settings.arguments()])));
      for (const result of competingForce) assert.equal(result.code, 0, result.output + (existsSync(path.join(settings.dataDir, 'fixture-errors.log')) ? readFileSync(path.join(settings.dataDir, 'fixture-errors.log'), 'utf8') : ''));
      const forced = (await launcher.status())!;
      assert.notEqual(forced.instanceId, first.instanceId);
      assert.equal(new Set(competingForce.map(result => JSON.parse(result.output.trim()).instanceId)).size, 1);
      process.kill(forced.pid, 'SIGKILL');
      const recovered = await launcher.ensure();
      assert.notEqual(recovered.instanceId, forced.instanceId);
      await launcher.stop();
      const older = await this.foreground('0.0.1');
      const upgraded = await launcher.ensure();
      assert.equal(upgraded.version, settings.version);
      assert.notEqual(upgraded.pid, older.pid);
      await launcher.stop();
      const newer = await this.foreground('9.0.0');
      assert.equal((await launcher.ensure()).pid, newer.pid);
      assert.equal((await launcher.ensure(true)).version, settings.version);
      await launcher.stop();
      const foreign = createServer((_request, response) => { response.setHeader('content-type', 'application/json'); response.end(JSON.stringify({ identity: first, proof: 'not-authentic' })); });
      await new Promise<void>(resolve => foreign.listen(settings.port, '127.0.0.1', resolve));
      try { await assert.rejects(launcher.ensure(true), /Port already in use/); assert.equal(foreign.listening, true); }
      finally { await new Promise<void>(resolve => foreign.close(() => resolve())); }
      console.log('PASS processes: six starts, cwd independence, losing DB untouched, concurrent force, crash recovery, version upgrade/reuse, foreign endpoint');
    } finally {
      await launcher.stop().catch(() => {});
      await Promise.allSettled([...this.children].map(async child => {
        if (child.exitCode !== null || child.signalCode !== null) return;
        const exited = once(child, 'exit');
        child.kill();
        await exited;
      }));
      rmSync(this.root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    }
  };
}

await new ProcessTests().run();
