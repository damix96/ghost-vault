import { fileURLToPath } from 'node:url';
import { appendFileSync } from 'node:fs';
import path from 'node:path';
import { RuntimeArguments } from './arguments.js';
import { RuntimeSettings } from './settings.js';
import { GhostVaultRuntime } from './service.js';
import { RuntimeLauncher } from './launcher.js';

class RuntimeFixture {
  public run = async (): Promise<void> => {
    const args = [...process.argv.slice(2)];
    const versionIndex = args.indexOf('--fixture-version');
    const version = versionIndex < 0 ? undefined : args.splice(versionIndex, 2)[1];
    const parsed = new RuntimeArguments(args);
    const settings = new RuntimeSettings({ dataDir: parsed.settings.dataDir, databasePath: parsed.settings.databasePath, port: parsed.settings.port, version, startupTimeoutMs: 8000 });
    if (parsed.command === 'serve') {
      const runtime = new GhostVaultRuntime(settings, app => ({ register: () => { app.get('/fixture', async () => ({ ready: true })); }, close: async () => {} }));
      process.once('SIGTERM', () => { void runtime.close(); });
      process.once('SIGINT', () => { void runtime.close(); });
      try {
        const identity = await runtime.start();
        if (process.send) process.send({ type: 'ready' });
        else console.log(JSON.stringify(identity));
      } catch (error) {
        const code = (error as { code?: string }).code;
        if (code !== 'EADDRINUSE') appendFileSync(path.join(settings.dataDir, 'fixture-errors.log'), JSON.stringify({ code, error: (error as Error).message }) + '\n');
        process.send?.({ type: 'error', code });
        process.exitCode = code === 'EADDRINUSE' ? 2 : 1;
      } finally { if (process.connected) process.disconnect(); }
      return;
    }
    const launcher = new RuntimeLauncher(settings, fileURLToPath(import.meta.url));
    if (parsed.command === 'stop') console.log(JSON.stringify({ stopped: await launcher.stop() }));
    else console.log(JSON.stringify(await launcher.ensure(Boolean(parsed.values.force), Date.now() - Math.round(process.uptime() * 1000))));
  };
}

await new RuntimeFixture().run().catch(error => { console.error((error as Error).message); process.exitCode = 1; });
