import { RuntimeArguments } from './arguments.js';
import { RuntimeOptions, RuntimeSettings } from './settings.js';
import { GhostVaultRuntime } from './service.js';
import { RuntimeLauncher } from './launcher.js';
import { SetupCommand } from '../setup/command.js';

export interface RuntimeCommands {
  createRuntime: (settings: RuntimeSettings) => GhostVaultRuntime | Promise<GhostVaultRuntime>;
  startBridge: (settings: RuntimeSettings) => Promise<void>;
}

export class RuntimeCommand {
  constructor(private commands: RuntimeCommands) {}

  public run = async (input = process.argv.slice(2), defaults: RuntimeOptions = {}): Promise<void> => {
    const args = new RuntimeArguments(input, defaults);
    if (args.values.help) {
      console.log('ghostvault [start|ensure-start|status|stop|serve|mcp-bridge|setup] [--port N] [--data-dir PATH] [--db PATH] [-force]\nsetup --client codex|claude|cursor [--config PATH] [--dry-run]\nsetup --autostart [--target PATH] [--apply] [--dry-run]');
      return;
    }
    if (args.command === 'setup') { new SetupCommand().run(args); return; }
    if (args.command === 'serve') { await this.serve(args.settings); return; }
    if (args.command === 'mcp-bridge' || args.command === 'mcp') { await this.commands.startBridge(args.settings); return; }
    const launcher = new RuntimeLauncher(args.settings);
    if (args.command === 'start' || args.command === 'ensure-start') { console.log(JSON.stringify(await launcher.ensure(Boolean(args.values.force), Date.now() - Math.round(process.uptime() * 1000)))); return; }
    if (args.command === 'status') { console.log(JSON.stringify(await launcher.status() ?? { state: 'stopped' })); return; }
    if (args.command === 'stop') { console.log(JSON.stringify({ stopped: await launcher.stop() })); return; }
    throw new Error('Unknown GhostVault command');
  };

  private serve = async (settings: RuntimeSettings): Promise<void> => {
    const runtime = await this.commands.createRuntime(settings);
    const stop = (): void => { void runtime.close().catch(() => { process.exitCode = 1; }); };
    process.once('SIGINT', stop);
    process.once('SIGTERM', stop);
    try {
      const identity = await runtime.start();
      if (process.send) process.send({ type: 'ready' });
      else console.log(JSON.stringify(identity));
    } catch (error) {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      const code = (error as { code?: string }).code;
      if (process.send) process.send({ type: 'error', code });
      else console.error(code === 'EADDRINUSE' ? 'Port already in use' : 'GhostVault startup failed');
      process.exitCode = code === 'EADDRINUSE' ? 2 : 1;
    } finally { if (process.connected) process.disconnect(); }
  };
}
