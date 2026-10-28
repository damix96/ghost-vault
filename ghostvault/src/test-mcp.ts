import fs from 'node:fs';
import path from 'node:path';
import { GhostVaultMcpServer } from './mcp/hooks-server.js';

export class McpTestRunner {
  private testHooksDir = path.resolve(process.cwd(), 'temp-mcp-hooks');
  private mcpServer: GhostVaultMcpServer;

  constructor() {
    this.mcpServer = new GhostVaultMcpServer({
      hooksDir: this.testHooksDir,
    });
  }

  public run = async (): Promise<void> => {
    fs.mkdirSync(this.testHooksDir, { recursive: true });
    const serverInstance = this.mcpServer.getMcpServer();

    const tools: Record<string, any> = {};
    const serverInternal = serverInstance as any;
    if (serverInternal._registeredTools) {
      for (const [name, toolDef] of Object.entries(serverInternal._registeredTools)) {
        tools[name] = (toolDef as any).handler;
      }
    }

    if (!tools['ghostvault_get_last_context'] || !tools['ghostvault_save_hook'] ||
        !tools['ghostvault_list_hooks'] || !tools['ghostvault_test_hook'] ||
        !tools['ghostvault_toggle_hook'] || !tools['ghostvault_delete_hook']) {
      throw new Error('Not all MCP tools registered: ' + Object.keys(tools).join(', '));
    }

    const lastCtxRes = await tools['ghostvault_get_last_context']({});
    const lastCtxJson = JSON.parse(lastCtxRes.content[0].text);
    if (!lastCtxJson) throw new Error('ghostvault_get_last_context failed');

    const saveRes = await tools['ghostvault_save_hook']({
      name: 'test_mcp_hook',
      code: 'export default { beforeOutboundRequest: ctx => ctx };',
    });
    const saveJson = JSON.parse(saveRes.content[0].text);
    if (!saveJson.success) throw new Error('ghostvault_save_hook failed: ' + saveRes.content[0].text);

    const listRes = await tools['ghostvault_list_hooks']({});
    const listJson = JSON.parse(listRes.content[0].text);
    if (!Array.isArray(listJson) || !listJson.some(h => h.name === 'test_mcp_hook')) {
      throw new Error('ghostvault_list_hooks failed: ' + listRes.content[0].text);
    }

    const testRes = await tools['ghostvault_test_hook']({
      code: 'ctx => ({ ...ctx, mcpTested: true })',
      stage: 'beforeOutboundRequest',
    });
    const testJson = JSON.parse(testRes.content[0].text);
    if (!testJson.success || !testJson.output?.mcpTested) {
      throw new Error('ghostvault_test_hook failed: ' + testRes.content[0].text);
    }

    const toggleOffRes = await tools['ghostvault_toggle_hook']({
      name: 'test_mcp_hook',
      active: false,
    });
    const toggleOffJson = JSON.parse(toggleOffRes.content[0].text);
    if (!toggleOffJson.success || toggleOffJson.active !== false) {
      throw new Error('ghostvault_toggle_hook off failed: ' + toggleOffRes.content[0].text);
    }

    const toggleOnRes = await tools['ghostvault_toggle_hook']({
      name: 'test_mcp_hook',
      active: true,
    });
    const toggleOnJson = JSON.parse(toggleOnRes.content[0].text);
    if (!toggleOnJson.success || toggleOnJson.active !== true) {
      throw new Error('ghostvault_toggle_hook on failed: ' + toggleOnRes.content[0].text);
    }

    const deleteRes = await tools['ghostvault_delete_hook']({
      name: 'test_mcp_hook',
    });
    const deleteJson = JSON.parse(deleteRes.content[0].text);
    if (!deleteJson.success) {
      throw new Error('ghostvault_delete_hook failed: ' + deleteRes.content[0].text);
    }

    fs.rmSync(this.testHooksDir, { recursive: true, force: true });
    console.log('All MCP hook tools tests passed successfully!');
  };
}

new McpTestRunner().run();
