import { GhostVaultE2eRunner } from './e2e-runner.js';

export class DemoApp {
  private runner = new GhostVaultE2eRunner();

  public start = async (): Promise<void> => {
    const address = await this.runner.startSandbox();
    console.log('GhostVault isolated Zen mock: ' + address);
    console.log('Provider: ghostvault-test/zen-mock. Database: memory. No external API keys.');
    console.log('Run from e2e-sandbox: opencode run --pure --model ghostvault-test/zen-mock "Fetch test balance"');
  };

  public stop = async (): Promise<void> => {
    await this.runner.close();
    process.exit(0);
  };
}

const demo = new DemoApp();
process.once('SIGINT', demo.stop);
process.once('SIGTERM', demo.stop);
demo.start().catch(error => { console.error(error); process.exit(1); });
