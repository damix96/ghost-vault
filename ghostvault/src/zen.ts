import path from 'node:path';
import { GhostProxyServer } from './proxy/server.js';
import { RouteRegistry } from './proxy/route-registry.js';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

export class ZenGateway {
  private port = Number(process.env.GHOSTVAULT_PORT ?? 8765);
  private database = new VaultDatabase(path.resolve(process.cwd(), '.cache/zen-live.db'));
  private vault = new VaultStore(this.database);
  private server = new GhostProxyServer(this.vault, { host: '127.0.0.1', port: this.port });

  public start = async (): Promise<void> => {
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('Invalid GHOSTVAULT_PORT');
    await this.server.listen();
    console.log('GhostVault cloud gateway: http://127.0.0.1:' + this.port + '/dashboard');
    console.log('OpenCode provider: ghostvault-zen');
    console.log('Upstream: ' + new RouteRegistry(this.database).getSettings().opencode);
    console.log('Database: .cache/zen-live.db; no mock server.');
  };

  public stop = async (): Promise<void> => {
    await this.server.close();
    this.database.close();
    process.exit(0);
  };
}

const gateway = new ZenGateway();
process.once('SIGINT', gateway.stop);
process.once('SIGTERM', gateway.stop);
gateway.start().catch(error => { console.error(error); process.exit(1); });
