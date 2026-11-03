import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { catalogInputShape, catalogSchema, VaultCatalogProvider } from './catalog-schema.js';
import { VAULT_CATALOG_DESCRIPTION, VAULT_MCP_INSTRUCTIONS } from './instructions.js';

export class VaultCatalogServer {
  public readonly mcp: McpServer;

  constructor(private vault: VaultCatalogProvider, version: string) {
    this.mcp = new McpServer({ name: 'ghostvault', version }, { instructions: VAULT_MCP_INSTRUCTIONS });
    this.mcp.registerTool('ghostvault_list_variables', {
      title: 'List GhostVault variables',
      description: VAULT_CATALOG_DESCRIPTION,
      inputSchema: catalogInputShape,
      outputSchema: catalogSchema.shape,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, this.listVariables);
  }

  public connect = async (transport: Transport): Promise<void> => {
    await this.mcp.connect(transport);
    const receive = transport.onmessage;
    transport.onmessage = (message, extra) => {
      if ('method' in message && message.method === 'tools/call' && message.params && message.params.arguments === undefined) {
        receive?.({ ...message, params: { ...message.params, arguments: {} } }, extra);
      } else receive?.(message, extra);
    };
  };

  private listVariables = async (input: { includeAutomatic: boolean; names?: string[] }): Promise<CallToolResult> => {
    try {
      const catalog = catalogSchema.parse(this.vault.listVariables(input));
      return { content: [{ type: 'text', text: JSON.stringify(catalog) }], structuredContent: catalog };
    } catch {
      return { isError: true, content: [{ type: 'text', text: 'Vault catalog is temporarily unavailable. Retry the catalog request.' }] };
    }
  };
}
