import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { parse, stringify } from 'smol-toml';
import { RuntimeSettings } from '../runtime/settings.js';

export type ClientKind = 'claude' | 'cursor' | 'codex';
export interface SetupResult { changed: boolean; target?: string; backup?: string; content: string }

export class ClientConfigInstaller {
  constructor(private settings: RuntimeSettings, private entry: string, private executable = process.execPath) {}

  public install = (client: ClientKind, target?: string, dryRun = false): SetupResult => {
    if (!['claude', 'cursor', 'codex'].includes(client)) throw new Error('Supported clients: claude, cursor, codex');
    const existing = target && existsSync(target) ? readFileSync(target, 'utf8') : '';
    const configuration = existing.trim() ? (client === 'codex' ? parse(existing) : JSON.parse(existing)) : {};
    if (!configuration || typeof configuration !== 'object' || Array.isArray(configuration)) throw new Error('Client config must be an object');
    const group = client === 'codex' ? 'mcp_servers' : 'mcpServers';
    const servers = configuration[group] ?? {};
    if (!servers || typeof servers !== 'object' || Array.isArray(servers)) throw new Error('MCP server config must be an object');
    const entry = { command: this.executable, args: [this.entry, 'mcp-bridge', ...this.settings.arguments()] };
    if (isDeepStrictEqual({ ...servers.ghostvault }, entry)) return { changed: false, target, content: existing };
    configuration[group] = { ...servers, ghostvault: entry };
    const content = client === 'codex' ? stringify(configuration) : JSON.stringify(configuration, null, 2) + '\n';
    if (!target || dryRun) return { changed: true, target, content };
    const destination = path.resolve(target);
    mkdirSync(path.dirname(destination), { recursive: true });
    const backup = existing ? destination + '.ghostvault-backup-' + randomUUID() : undefined;
    if (backup) copyFileSync(destination, backup);
    const temporary = destination + '.' + randomUUID() + '.tmp';
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    try { renameSync(temporary, destination); }
    finally { rmSync(temporary, { force: true }); }
    return { changed: true, target: destination, backup, content };
  };
}
