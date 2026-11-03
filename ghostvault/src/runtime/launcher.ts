import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import semver from 'semver';
import { RuntimeClient } from './client.js';
import { RuntimeIdentity } from './identity.js';
import { RuntimeSettings } from './settings.js';

export class RuntimeLauncher {
  private client: RuntimeClient;
  constructor(private settings = new RuntimeSettings(), private entry = fileURLToPath(new URL('./cli.js', import.meta.url))) {
    this.client = new RuntimeClient(settings);
  }

  public status = async (): Promise<RuntimeIdentity | undefined> => (await this.client.inspect())?.identity;

  public ensure = async (force = false, requestedAt = Date.now()): Promise<RuntimeIdentity> => {
    const deadline = Date.now() + this.settings.startupTimeoutMs;
    const stopping = new Set<string>();
    let verificationFailure: Error | undefined;
    let verificationFailedAt: number | undefined;
    while (Date.now() < deadline) {
      let current;
      try { current = await this.client.inspect(); verificationFailure = undefined; verificationFailedAt = undefined; }
      catch (error) {
        verificationFailure = error as Error;
        verificationFailedAt ??= Date.now();
        if (Date.now() - verificationFailedAt > 1200) throw verificationFailure;
        await delay(60);
        continue;
      }
      if (!current) {
        await this.spawn(Math.max(100, deadline - Date.now()));
        continue;
      }
      const identity = current.identity;
      if (!semver.valid(identity.version) || !semver.valid(this.settings.version)) throw new Error('Unsupported GhostVault version');
      const replace = semver.lt(identity.version, this.settings.version) || (force && identity.startedAt < requestedAt);
      if (identity.state === 'ready' && !replace) return identity;
      if (identity.state === 'ready' && replace && !stopping.has(identity.instanceId)) {
        await this.client.shutdown(current);
        stopping.add(identity.instanceId);
      }
      await delay(60);
    }
    throw verificationFailure ?? new Error('GhostVault did not become ready before the startup deadline');
  };

  public stop = async (): Promise<boolean> => {
    const current = await this.client.inspect();
    if (!current) return false;
    await this.client.shutdown(current);
    const deadline = Date.now() + this.settings.startupTimeoutMs;
    while (Date.now() < deadline) {
      const next = await this.client.inspect();
      if (!next || next.identity.instanceId !== current.identity.instanceId) return true;
      await delay(60);
    }
    throw new Error('GhostVault is still draining active requests');
  };

  private spawn = async (timeout: number): Promise<void> => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [this.entry, 'serve', ...this.settings.arguments()], { detached: true, windowsHide: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc'], cwd: this.settings.packageRoot });
    let settled = false;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (child.connected) child.disconnect();
      child.unref();
      error ? reject(error) : resolve();
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('GhostVault startup timed out')); }, timeout);
    child.once('error', () => finish(new Error('Could not launch GhostVault')));
    child.once('exit', code => finish(code === 0 || code === 2 ? undefined : new Error('GhostVault startup failed')));
    child.once('message', message => {
      const result = message as { type?: string; code?: string };
      finish(result.type === 'ready' || result.code === 'EADDRINUSE' ? undefined : new Error('GhostVault startup failed; run serve for diagnostics'));
    });
  });
}
