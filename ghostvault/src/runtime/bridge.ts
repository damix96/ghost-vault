import { VaultMcpBridge } from '../mcp/bridge.js';
import { RuntimeSettings } from './settings.js';
import { RuntimeLauncher } from './launcher.js';
import { RuntimeCredentials } from './credentials.js';

export class RuntimeBridge {
  private bridge?: VaultMcpBridge;
  private closing?: Promise<void>;
  private started = false;

  constructor(private settings: RuntimeSettings) {}

  public start = async (): Promise<void> => {
    if (this.started || this.closing) throw new Error('Runtime bridge has already been started or closed');
    this.started = true;
    await new RuntimeLauncher(this.settings).ensure();
    if (this.closing) throw new Error('Runtime bridge startup was cancelled');
    const token = new RuntimeCredentials(this.settings).readMcpToken();
    this.bridge = new VaultMcpBridge({ url: new URL(this.settings.url + '/mcp'), mcpToken: token });
    process.once('SIGTERM', this.finish);
    process.once('SIGINT', this.finish);
    try { await this.bridge.start(); }
    catch (error) { await this.close(); throw error; }
  };

  public close = async (): Promise<void> => {
    this.closing ??= Promise.resolve().then(async () => {
      process.off('SIGTERM', this.finish);
      process.off('SIGINT', this.finish);
      await this.bridge?.close();
    });
    await this.closing;
  };

  private finish = (): void => { void this.close(); };
}
