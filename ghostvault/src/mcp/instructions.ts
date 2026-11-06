export const VAULT_MCP_INSTRUCTIONS = [
  'GhostVault keeps secret values local while the language model uses symbolic variable tokens.',
  'Authorization tokens, passwords, service addresses and other values needed for a task may already be in the Vault.',
  'Call ghostvault_list_variables when you need to discover a suitable variable. Do not invent names or request original values.',
  'The catalog returns names, descriptions and sources only; fixed/manual variables are the default. Request includeAutomatic: true only when automatic variables are needed.',
  'To use a variable, wrap its exact returned name with syntax $${<NAME>} (NAME uses uppercase letters, digits and underscores). The catalog omits this redundant token field and never returns the stored value.',
  'In explanations about a variable or its spelling, write its bare NAME. A complete $${<NAME>} token in your response is substituted even inside quotes or code blocks; never claim that the client will see the same literal token that you see.',
  'When those outputs pass through the GhostVault proxy, it substitutes local values before delivery to the client. The MCP catalog alone does not substitute tokens in clients that bypass that proxy.',
  'A catalog is a snapshot: variables may be added, removed, renamed or changed outside this session. Refresh the catalog if a suitable name is missing, a name is unknown or no longer recognized, or the snapshot may be stale.',
  'Changing a value preserves its name and token; subsequent proxy requests use the current value, not a historical value. Renaming may invalidate the old name.',
  'You do not need to refresh before every reuse of a known variable merely because its value could have changed.',
  'When the secret input tools are available, use ghostvault_request_secret_input with operation new or update and the required names to ask the human for local browser input. Never include secret values in MCP arguments, chat or URLs.',
  'The browser submits values directly to the local Vault; MCP receives request state and metadata only. A launch attempt is not proof the human saw the page. Check ghostvault_secret_input_status after human action, or cancel a pending request with ghostvault_cancel_secret_input; do not poll or wait indefinitely.',
].join(' ');

export const VAULT_CATALOG_DESCRIPTION = 'Discover available Vault variables without exposing original or encoded values. ' + VAULT_MCP_INSTRUCTIONS;
