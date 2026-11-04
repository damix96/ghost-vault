import { parseArgs } from 'node:util';
import { RuntimeOptions, RuntimeSettings } from './settings.js';

export class RuntimeArguments {
  public command: string;
  public settings: RuntimeSettings;
  public values: ReturnType<typeof RuntimeArguments.parse>['values'];

  constructor(args = process.argv.slice(2), defaults: RuntimeOptions = {}) {
    const parsed = RuntimeArguments.parse(args);
    this.command = parsed.positionals[0] ?? 'ensure-start';
    if (parsed.positionals.length > 1) throw new Error('Unexpected positional arguments');
    this.values = parsed.values;
    this.settings = new RuntimeSettings({ ...defaults, ...(parsed.values['data-dir'] ? { dataDir: parsed.values['data-dir'] } : {}), ...(parsed.values.db ? { databasePath: parsed.values.db } : {}), ...(parsed.values.port ? { port: Number(parsed.values.port) } : {}) });
  }

  private static parse = (args: string[]) => parseArgs({ args: args.map(arg => arg === '-force' ? '--force' : arg), allowPositionals: true, options: {
    'data-dir': { type: 'string' }, db: { type: 'string' }, port: { type: 'string' }, force: { type: 'boolean' },
    client: { type: 'string' }, config: { type: 'string' }, 'dry-run': { type: 'boolean' }, autostart: { type: 'boolean' },
    apply: { type: 'boolean' }, target: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
}
