import { fileURLToPath } from 'node:url';
import { RuntimeArguments } from '../runtime/arguments.js';
import { AutostartInstaller } from './autostart.js';
import { ClientConfigInstaller, ClientKind } from './config.js';

export class SetupCommand {
  public run = (args: RuntimeArguments): void => {
    const entry = fileURLToPath(new URL('../runtime/cli.js', import.meta.url));
    if (args.values.autostart) {
      const result = new AutostartInstaller(args.settings, entry).install({ target: args.values.target, apply: Boolean(args.values.apply && !args.values['dry-run']) });
      console.log(JSON.stringify(result));
      return;
    }
    const client = args.values.client ?? 'codex';
    if (!['claude', 'cursor', 'codex'].includes(client)) throw new Error('Supported clients: claude, cursor, codex');
    const result = new ClientConfigInstaller(args.settings, entry).install(client as ClientKind, args.values.config, Boolean(args.values['dry-run']));
    if (!args.values.config) console.log(result.content);
    else console.log(JSON.stringify({ target: result.target, changed: result.changed, backup: result.backup, dryRun: Boolean(args.values['dry-run']), client }));
  };
}
