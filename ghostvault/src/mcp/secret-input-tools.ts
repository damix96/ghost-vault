import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { SecretInputManager } from '../secret-input/manager.js';
import { SecretInputError } from '../secret-input/errors.js';
import { inputIdSchema, inputRequestSchema, inputViewSchema, SecretInputView } from '../secret-input/schema.js';

export interface McpSecretInput { manager: SecretInputManager; origin: string }

export class SecretInputTools {
  constructor(private server: McpServer, private input: McpSecretInput) {}

  public register = (): void => {
    this.server.registerTool('ghostvault_request_secret_input', {
      title: 'Request local secret input',
      description: 'Ask the human to create or update named secrets in a local browser form. Supply names only, never secret values. Reuse idempotencyKey when retrying the same request. Returns promptly with metadata; launch attempted does not prove a visible form. Human input expires after ten minutes. Do not ask the human to paste values into chat or MCP.',
      inputSchema: inputRequestSchema,
      outputSchema: inputViewSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => this.result(() => this.input.manager.request(args, this.input.origin)));
    this.server.registerTool('ghostvault_secret_input_status', {
      title: 'Check local secret input',
      description: 'Read metadata for a local human input request. Never returns entered values. Check after human action; do not wait or poll indefinitely. Unknown requests may belong to an earlier runtime. A completed value change preserves the existing name and token.',
      inputSchema: inputIdSchema,
      outputSchema: inputViewSchema,
      annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => this.result(() => this.input.manager.status(args.requestId)));
    this.server.registerTool('ghostvault_cancel_secret_input', {
      title: 'Cancel local secret input',
      description: 'Cancel a pending human input request without changing the Vault. A batch already committing cannot be cancelled; check its actual final status.',
      inputSchema: inputIdSchema,
      outputSchema: inputViewSchema,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, args => this.result(() => this.input.manager.cancel(args.requestId)));
  };

  private result = async (action: () => SecretInputView | Promise<SecretInputView>): Promise<CallToolResult> => {
    try {
      const view = inputViewSchema.parse(await action());
      return { content: [{ type: 'text', text: JSON.stringify(view) }], structuredContent: view, ...(view.state === 'failed' ? { isError: true } : {}) };
    } catch (error) {
      return { isError: true, content: [{ type: 'text', text: JSON.stringify({ error: SecretInputError.safe(error).public() }) }] };
    }
  };
}
