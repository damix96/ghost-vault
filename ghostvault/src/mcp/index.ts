import { GhostVaultMcpServer } from './hooks-server.js';

export { GhostVaultMcpServer };

export class GhostVaultMcpRunner {
  private server = new GhostVaultMcpServer();

  public run = async (): Promise<void> => {
    await this.server.startStdio();
  };
}

if (process.argv[1]?.endsWith('mcp/index.js') || process.argv[1]?.endsWith('mcp/index.ts')) {
  new GhostVaultMcpRunner().run();
}
