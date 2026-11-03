import path from 'node:path';
import { RuntimeCli } from './runtime/cli.js';
import { RuntimeLauncher } from './runtime/launcher.js';
import { RuntimeOptions, RuntimeSettings } from './runtime/settings.js';

export class ZenGateway {
  private launcher: RuntimeLauncher;

  constructor(options: RuntimeOptions = {}) {
    const databasePath = options.databasePath ?? (options.dataDir || process.env.GHOSTVAULT_DATA_DIR ? undefined : process.env.GHOSTVAULT_DB_PATH ?? path.resolve(process.cwd(), '.cache/zen-live.db'));
    this.launcher = new RuntimeLauncher(new RuntimeSettings({ ...options, databasePath }));
  }

  public start = async (): Promise<void> => { console.log(JSON.stringify(await this.launcher.ensure())); };
  public stop = async (): Promise<void> => { await this.launcher.stop(); };
}

if (RuntimeCli.isMain(import.meta.url)) {
  const args = process.argv.slice(2);
  const explicitData = args.includes('--data-dir') || args.some(arg => arg.startsWith('--data-dir=')) || process.env.GHOSTVAULT_DATA_DIR;
  const databasePath = explicitData ? undefined : process.env.GHOSTVAULT_DB_PATH ?? path.resolve(process.cwd(), '.cache/zen-live.db');
  RuntimeCli.main(args, { databasePath });
}
