import { VaultMcpEndpoint } from '../mcp/endpoint.js';
import { GhostVaultRuntime } from './service.js';
import { RuntimeSettings } from './settings.js';

export class RuntimeApplication {
  public static create = (settings = new RuntimeSettings()): GhostVaultRuntime => new GhostVaultRuntime(settings, (app, vault, options) => new VaultMcpEndpoint(app, vault, {
    version: options.version,
    mcpToken: options.mcpToken,
  }));
}
