import { existsSync, readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

export interface RuntimeOptions {
  dataDir?: string;
  databasePath?: string;
  port?: number;
  version?: string;
  startupTimeoutMs?: number;
}

export class RuntimeSettings {
  public readonly dataDir: string;
  public readonly databasePath: string;
  public readonly port: number;
  public readonly version: string;
  public readonly startupTimeoutMs: number;
  public readonly host = '127.0.0.1';
  public readonly packageRoot: string;
  public readonly url: string;
  public readonly recordPath: string;
  public readonly tokenPath: string;

  constructor(options: RuntimeOptions = {}) {
    this.packageRoot = RuntimeSettings.findPackageRoot();
    this.dataDir = RuntimeSettings.canonicalPath(options.dataDir ?? process.env.GHOSTVAULT_DATA_DIR ?? path.join(os.homedir(), '.ghostvault'));
    this.databasePath = RuntimeSettings.canonicalPath(options.databasePath ?? (options.dataDir ? path.join(this.dataDir, 'vault.db') : process.env.GHOSTVAULT_DB_PATH ?? path.join(this.dataDir, 'vault.db')));
    this.port = options.port ?? Number(process.env.GHOSTVAULT_PORT ?? 8765);
    this.version = options.version ?? JSON.parse(readFileSync(path.join(this.packageRoot, 'package.json'), 'utf8')).version;
    this.startupTimeoutMs = options.startupTimeoutMs ?? 15000;
    if (!Number.isInteger(this.port) || this.port < 1 || this.port > 65535) throw new Error('Invalid GhostVault port');
    if (!Number.isFinite(this.startupTimeoutMs) || this.startupTimeoutMs < 100) throw new Error('Invalid startup timeout');
    if (!semver.valid(this.version)) throw new Error('Invalid GhostVault package version');
    this.url = 'http://' + this.host + ':' + this.port;
    this.recordPath = path.join(this.dataDir, 'runtime-' + this.port + '.json');
    this.tokenPath = path.join(this.dataDir, 'mcp-token');
  }

  public arguments = (): string[] => ['--data-dir', this.dataDir, '--db', this.databasePath, '--port', String(this.port)];
  public matchesDatabasePath = (candidate: string): boolean => RuntimeSettings.canonicalPath(candidate) === RuntimeSettings.canonicalPath(this.databasePath);
  public static installedVersion = (): string => JSON.parse(readFileSync(path.join(RuntimeSettings.findPackageRoot(), 'package.json'), 'utf8')).version;

  private static canonicalPath = (input: string): string => {
    const resolved = path.resolve(input);
    if (existsSync(resolved)) return realpathSync.native(resolved);
    const parent = path.dirname(resolved);
    return parent === resolved ? resolved : path.join(RuntimeSettings.canonicalPath(parent), path.basename(resolved));
  };

  private static findPackageRoot = (): string => {
    let candidate = path.dirname(fileURLToPath(import.meta.url));
    while (true) {
      const manifest = path.join(candidate, 'package.json');
      if (existsSync(manifest) && JSON.parse(readFileSync(manifest, 'utf8')).name === 'ghostvault') return candidate;
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new Error('GhostVault package manifest was not found');
      candidate = parent;
    }
  };
}
