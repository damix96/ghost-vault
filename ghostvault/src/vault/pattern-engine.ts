import { VaultDatabase, PatternRow } from './sqlite-db.js';
import { AnyIpRule } from './any-ip-rule.js';
import { isIP } from 'node:net';
import { LabelTemplate } from './label-template.js';

const correctIpPattern = '\\b(?:10(?:\\.\\d{1,3}){3}|192\\.168(?:\\.\\d{1,3}){2}|172\\.(?:1[6-9]|2\\d|3[0-1])(?:\\.\\d{1,3}){2})(?::\\d+)?\\b';

export class PatternEngine {
  private db: VaultDatabase;

  constructor(db: VaultDatabase) {
    this.db = db;
    this.initializeDefaultPatterns();
    AnyIpRule.install(db);
  }

  private initializeDefaultPatterns = (): void => {
    const existing = this.db.getPatterns();
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
      new RegExp(pat, 'gi');
      return true;
    } catch {
      return false;
    }
  };

  public getPatterns = (): PatternRow[] => this.db.getPatterns();

  public addPattern = (name: string, pattern: string, type: string = 'custom', label_template: string | null = null): PatternRow | null => {
    if (!PatternEngine.isValidRegex(pattern)) return null;
    LabelTemplate.validate(pattern, label_template);
    const id = 'pat_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    const row: PatternRow = {
      id,
      name,
      pattern,
      type,
      label_template,
      enabled: 1,
      created_at: new Date().toISOString(),
    };
    this.db.upsertPattern(row);
    return row;
  };

  public deletePattern = (id: string): boolean => this.db.deletePattern(id);

  public updatePattern = (id: string, draft: Pick<PatternRow, 'name' | 'pattern' | 'type' | 'enabled' | 'label_template'>): PatternRow | null => {
    const current = this.db.getPatterns().find(row => row.id === id);
    if (!current || !PatternEngine.isValidRegex(draft.pattern)) return null;
    LabelTemplate.validate(draft.pattern, draft.label_template === undefined ? current.label_template : draft.label_template);
    const updated = { ...current, ...draft };
    this.db.upsertPattern(updated);
    return updated;
  };

  public togglePattern = (id: string): PatternRow | null => this.db.togglePattern(id);

  public scanAndAutoDetect = (text: string, onSecretDetected: (match: string, type: string, prefix?: string) => void): void => {
    for (const pat of this.db.getPatterns().filter(p => p.enabled === 1)) {
      LabelTemplate.validate(pat.pattern, pat.label_template);
      const seen = new Set<string>();
      for (const match of text.matchAll(new RegExp(pat.pattern, 'gi'))) {
        const value = match[0].trim();
        if (seen.has(value) || (pat.id === AnyIpRule.id ? !isIP(value) : value.length <= 3)) continue;
        seen.add(value);
        onSecretDetected(value, pat.type, LabelTemplate.prefix(pat.type, pat.label_template, match));
      }
    }
  };
}
