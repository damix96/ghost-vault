import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';
import { RuntimeApplication } from './runtime/application.js';
import { RuntimeCli } from './runtime/cli.js';
import { RuntimeOptions, RuntimeSettings } from './runtime/settings.js';

export { GhostProxyServer, VaultStore };

export class GhostVaultApp {
  private runtime;

  constructor(options: RuntimeOptions = {}) {
    this.runtime = RuntimeApplication.create(new RuntimeSettings(options));
  }

  public getVault = (): VaultStore => this.runtime.getVault();

  public getServer = (): GhostProxyServer => this.runtime.getServer();

  public start = async (): Promise<string> => { await this.runtime.start(); return this.runtime.settings.url; };
  public close = async (): Promise<void> => this.runtime.close();
}

if (RuntimeCli.isMain(import.meta.url)) RuntimeCli.main();
