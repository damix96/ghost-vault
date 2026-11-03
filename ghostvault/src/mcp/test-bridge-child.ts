import { VaultMcpBridge } from './bridge.js';

const bridge = new VaultMcpBridge({
  url: new URL(process.env.MCP_TEST_URL!),
  mcpToken: process.env.MCP_TEST_TOKEN!,
});
process.on('exit', code => process.stderr.write('bridge-exit:' + code));
try {
  await bridge.start();
} catch {
  process.stderr.write('bridge-start-failed');
  process.exitCode = 1;
}
