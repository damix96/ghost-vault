import fs from 'node:fs';
import path from 'node:path';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { HookSandbox } from '../telemetry/hook-sandbox.js';
import { HookManager } from '../hooks/manager.js';
import { GhostProxyServer } from '../proxy/server.js';
import { TransactionContext } from '../telemetry/types.js';

export class GhostVaultMcpServer {
  private mcp: McpServer;
  private hooksDir: string;
  private hookSandbox: HookSandbox;
  private hookManager?: HookManager;
  private proxyServer?: GhostProxyServer;
  private gatewayUrl: string;

  constructor(options?: {
    hooksDir?: string;
    hookManager?: HookManager;
    proxyServer?: GhostProxyServer;
    gatewayUrl?: string;
  }) {
    this.hooksDir = options?.hooksDir || path.resolve(process.cwd(), 'hooks');
    this.hookManager = options?.hookManager;
    this.proxyServer = options?.proxyServer;
    this.gatewayUrl = options?.gatewayUrl || 'http://127.0.0.1:8765';
    this.hookSandbox = new HookSandbox(this.hookManager);
    fs.mkdirSync(this.hooksDir, { recursive: true });

    this.mcp = new McpServer({
      name: 'ghostvault-hooks',
      version: '0.1.0',
    });
    this.registerTools();
  }

  public getMcpServer = (): McpServer => this.mcp;

  public startStdio = async (): Promise<void> => {
    const transport = new StdioServerTransport();
    await this.mcp.connect(transport);
  };

  private fetchLastContext = async (): Promise<TransactionContext | null> => {
    if (this.proxyServer) {
      return this.proxyServer.getLastTransactionContext();
    }
    try {
      const res = await fetch(this.gatewayUrl + '/api/hooks/context');
      if (res.ok) return (await res.json()) as TransactionContext;
    } catch {}
    return null;
  };

  private registerTools = (): void => {
    this.mcp.tool(
      'ghostvault_get_last_context',
      {},
      async () => {
        const ctx = await this.fetchLastContext();
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(ctx || { message: 'No transaction recorded yet' }, null, 2),
          }],
        };
      }
    );

    this.mcp.tool(
      'ghostvault_list_hooks',
      {},
      async () => {
        const files = fs.existsSync(this.hooksDir) ? fs.readdirSync(this.hooksDir) : [];
        const hooksList = files.map(file => {
          const isActive = !file.endsWith('.disabled');
          const ext = path.extname(file.replace('.disabled', ''));
          const name = path.basename(file, file.endsWith('.disabled') ? ext + '.disabled' : ext);
          return {
            name,
            file,
            active: isActive,
            path: path.join(this.hooksDir, file),
          };
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(hooksList, null, 2),
          }],
        };
      }
    );

    this.mcp.tool(
      'ghostvault_test_hook',
      {
        code: z.string(),
        stage: z.string(),
        customContext: z.record(z.string(), z.any()).optional(),
      },
      async ({ code, stage, customContext }) => {
        const lastTx = await this.fetchLastContext();
        const result = await this.hookSandbox.executeDryRun(
          { hookCode: code, stage, customContext },
          lastTx
        );
        return {
          content: [{
            type: 'text',
            text: JSON.stringify(result, null, 2),
          }],
        };
      }
    );

    this.mcp.tool(
      'ghostvault_save_hook',
      {
        name: z.string(),
        code: z.string(),
      },
      async ({ name, code }) => {
        const sanitized = name.replace(/[^a-zA-Z0-9_-]/g, '');
        const filename = sanitized.endsWith('.js') ? sanitized : sanitized + '.js';
        const targetPath = path.join(this.hooksDir, filename);
        fs.writeFileSync(targetPath, code, 'utf8');
        if (this.hookManager) await this.hookManager.loadHooksFromDir(this.hooksDir);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, message: 'Hook saved: ' + filename, path: targetPath }),
          }],
        };
      }
    );

    this.mcp.tool(
      'ghostvault_toggle_hook',
      {
        name: z.string(),
        active: z.boolean(),
      },
      async ({ name, active }) => {
        const files = fs.readdirSync(this.hooksDir);
        const target = files.find(f => f.startsWith(name));
        if (!target) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Hook not found' }) }] };
        }
        const currentPath = path.join(this.hooksDir, target);
        let newPath = currentPath;
        if (active && target.endsWith('.disabled')) {
          newPath = currentPath.slice(0, -'.disabled'.length);
          fs.renameSync(currentPath, newPath);
        } else if (!active && !target.endsWith('.disabled')) {
          newPath = currentPath + '.disabled';
          fs.renameSync(currentPath, newPath);
        }
        if (this.hookManager) await this.hookManager.loadHooksFromDir(this.hooksDir);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, active, file: path.basename(newPath) }),
          }],
        };
      }
    );

    this.mcp.tool(
      'ghostvault_delete_hook',
      {
        name: z.string(),
      },
      async ({ name }) => {
        const files = fs.readdirSync(this.hooksDir);
        const target = files.find(f => f.startsWith(name));
        if (!target) {
          return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'Hook not found' }) }] };
        }
        fs.unlinkSync(path.join(this.hooksDir, target));
        if (this.hookManager) await this.hookManager.loadHooksFromDir(this.hooksDir);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, deleted: target }),
          }],
        };
      }
    );
  };
}
