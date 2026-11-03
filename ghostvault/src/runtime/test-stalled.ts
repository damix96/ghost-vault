import { RuntimeArguments } from './arguments.js';
import { GhostVaultRuntime } from './service.js';

const args = new RuntimeArguments();
const runtime = new GhostVaultRuntime(args.settings, app => ({
  register: () => { app.register(async () => { await new Promise<void>(() => {}); }); },
  close: async () => {},
}));

await runtime.start().catch(() => { process.exitCode = 1; });
