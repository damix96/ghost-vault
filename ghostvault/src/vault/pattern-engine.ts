import { VaultDatabase, PatternRow } from './sqlite-db.js';
import { AnyIpRule } from './any-ip-rule.js';
import { isIP } from 'node:net';

const correctIpPattern = '\\b(?:10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})(?::\\d+)?\\b';

export class PatternEngine {
  private db: VaultDatabase;

  constructor(db: VaultDatabase) {
    this.db = db;
    this.initializeDefaultPatterns();
    AnyIpRule.install(db);
    this.cleanupErroneousSecrets();
  }

  private cleanupErroneousSecrets = (): void => {
    this.db.deleteAutoSecret('AUTO_IP_IDL7');
    const autoSecrets = this.db.getAutoSecrets();
    for (const a of autoSecrets) {
      if (a.real_value === '10.200.1') this.db.deleteAutoSecret(a.key);
    }
  };

  private initializeDefaultPatterns = (): void => {
    const existing = this.db.getPatterns();
    const ipPat = existing.find(p => p.id === 'pat_private_ip' || p.name === 'private-ip');
    if (ipPat && ipPat.pattern !== correctIpPattern) {
      this.db.upsertPattern({ ...ipPat, pattern: correctIpPattern });
    }
    if (existing.length > 0) return;
    const defaults: PatternRow[] = [
      {
        id: 'pat_internal_urls',
        name: 'internal-urls',
        pattern: 'https?:\\/\\/[a-zA-Z0-9\\.\\-_]*(?:internal|local|corp|bank)[a-zA-Z0-9\\.\\-_:\\/]*',
        type: 'url',
        enabled: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: 'pat_database_uri',
        name: 'database-uri',
        pattern: '(?:postgres|postgresql|mysql|mongodb|redis):\\/\\/[^\\s"\']+',
        type: 'uri',
        enabled: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: 'pat_private_ip',
        name: 'private-ip',
        pattern: correctIpPattern,
        type: 'ip',
        enabled: 1,
        created_at: new Date().toISOString(),
      },
      {
        id: 'pat_api_keys',
        name: 'api-keys',
        pattern: '(?:sk-[a-zA-Z0-9_-]{20,}|ghp_[a-zA-Z0-9]{20,}|bearer\\s+[a-zA-Z0-9_\\-\\.]+)',
        type: 'token',
        enabled: 1,
        created_at: new Date().toISOString(),
      },
    ];
    defaults.forEach(p => this.db.upsertPattern(p));
  };

  public static isValidRegex = (pat: string): boolean => {
    try {
      new RegExp(pat);
      return true;
    } catch {
      return false;
    }
  };

  public getPatterns = (): PatternRow[] => this.db.getPatterns();

  public addPattern = (name: string, pattern: string, type: string = 'custom'): PatternRow | null => {
    if (!PatternEngine.isValidRegex(pattern)) return null;
    const id = 'pat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const row: PatternRow = {
      id,
      name,
      pattern,
      type,
      enabled: 1,
      created_at: new Date().toISOString(),
    };
    this.db.upsertPattern(row);
    return row;
  };

  public deletePattern = (id: string): boolean => this.db.deletePattern(id);

  public togglePattern = (id: string): PatternRow | null => this.db.togglePattern(id);

  public scanAndAutoDetect = (text: string, onSecretDetected: (match: string, type: string) => void): void => {
    const active = this.db.getPatterns().filter(p => p.enabled === 1);
    for (const pat of active) {
      try {
        const regex = new RegExp(pat.pattern, 'gi');
        const matches = text.match(regex);
        if (matches) {
          const unique = [...new Set(matches.map(m => m.trim()).filter(m => pat.id === AnyIpRule.id ? isIP(m) !== 0 : m.length > 3))];
          unique.forEach(m => onSecretDetected(m, pat.type));
        }
      } catch {
        continue;
      }
    }
  };
}
