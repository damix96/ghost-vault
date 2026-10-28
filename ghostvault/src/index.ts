import { GhostProxyServer } from './proxy/server.js';
import { VaultStore } from './vault/store.js';

export { GhostProxyServer, VaultStore };

export class GhostVaultApp {
  private vault = new VaultStore();
  private server: GhostProxyServer;

  constructor() {
    this.server = new GhostProxyServer(this.vault);
  }

  public getVault = (): VaultStore => this.vault;

  public getServer = (): GhostProxyServer => this.server;

  public start = async (): Promise<string> => this.server.listen();
}

const app = new GhostVaultApp();
app.start().then(addr => console.log('GhostVault running at ' + addr));
