export const VAULT_MCP_INSTRUCTIONS = [
  'GhostVault keeps secret values local while the language model uses symbolic variable tokens.',
  'Authorization tokens, passwords, service addresses and other values needed for a task may already be in the Vault.',
  'Call ghostvault_list_variables when you need to discover a suitable variable. Do not invent names or request original values.',
  'The catalog returns names, exact tokens, descriptions and sources only; fixed/manual variables are the default. Request includeAutomatic: true only when automatic variables are needed.',
  'Copy the exact returned token, with syntax $${<NAME>} (NAME uses uppercase letters, digits and underscores), into your response or tool arguments.',
  'When those outputs pass through the GhostVault proxy, it substitutes local values before delivery to the client. The MCP catalog alone does not substitute tokens in clients that bypass that proxy.',
  'A catalog is a snapshot: variables may be added, removed, renamed or changed outside this session. Refresh the catalog if a suitable name is missing, a name is unknown or no longer recognized, or the snapshot may be stale.',
  'Changing a value preserves its name and token; subsequent proxy requests use the current value, not a historical value. Renaming may invalidate the old name.',
  'You do not need to refresh before every reuse of a known variable merely because its value could have changed.',
].join(' ');

export const VAULT_CATALOG_DESCRIPTION = 'Discover available Vault variables without exposing original or encoded values. ' + VAULT_MCP_INSTRUCTIONS;
