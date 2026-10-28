import { SecretEntry } from '../types/index.js';
import { VaultDatabase } from './sqlite-db.js';
import { TextReplacer } from './text-replacer.js';
import { SecretRepresentations } from './secret-representations.js';

export class VaultStore {
  private db: VaultDatabase;
  private manualSecrets = new Map<string, SecretEntry>();
  private autoSecrets = new Map<string, SecretEntry>();
  private representations?: SecretRepresentations;

  constructor(db?: VaultDatabase) {
    this.db = db ?? new VaultDatabase();
    this.loadFromDb();
  }

  public getDatabase = (): VaultDatabase => this.db;

  public static computeVariants = SecretRepresentations.variants;

  private loadFromDb = (): void => {
    const manualRows = this.db.getSecrets();
    for (const r of manualRows) {
      this.manualSecrets.set(r.key, {
        key: r.key,
        realValue: r.real_value,
        alias: r.alias,
        maskInAi: Boolean(r.mask_in_ai),
        description: r.description,
        variants: VaultStore.computeVariants(r.real_value),
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      });
    }
    const autoRows = this.db.getAutoSecrets().filter(r => r.key !== 'AUTO_IP_IDL7' && r.real_value !== '10.200.1');
    for (const r of autoRows) {
      this.autoSecrets.set(r.key, {
        key: r.key,
        realValue: r.real_value,
        alias: r.alias,
        maskInAi: true,
        variants: VaultStore.computeVariants(r.real_value),
        createdAt: r.first_seen_at,
        updatedAt: r.last_seen_at,
      });
    }
  };

  public setManualSecret = (key: string, realValue: string, description?: string): SecretEntry => {
    const alias = '$${<' + key + '>}';
    const now = new Date().toISOString();
    const entry: SecretEntry = {
      key,
      realValue,
      alias,
      maskInAi: true,
      description,
      variants: VaultStore.computeVariants(realValue),
      createdAt: now,
      updatedAt: now,
    };
    this.manualSecrets.set(key, entry);
    this.db.upsertSecret({
      key,
      real_value: realValue,
      alias,
      mask_in_ai: 1,
      description: description || '',
      created_at: now,
      updated_at: now,
    });
    this.autoSecrets.delete(key);
    this.db.deleteAutoSecret(key);
    this.representations = undefined;
    return entry;
  };

  public setAutoSecret = (key: string, realValue: string, description?: string): SecretEntry => {
    const alias = '$${<' + key + '>}';
    const now = new Date().toISOString();
    const entry: SecretEntry = {
      key,
      realValue,
      alias,
      maskInAi: true,
      description,
      variants: VaultStore.computeVariants(realValue),
      createdAt: now,
      updatedAt: now,
    };
    this.autoSecrets.set(key, entry);
    this.representations = undefined;
    this.db.upsertAutoSecret({
      key,
      real_value: realValue,
      alias,
      hit_count: 1,
      first_seen_at: now,
      last_seen_at: now,
    });
    return entry;
  };

  public registerAutoDetectedSecret = (realValue: string, type: string): SecretEntry => {
    for (const s of this.manualSecrets.values()) {
      if (s.realValue === realValue) return s;
    }
    for (const a of this.autoSecrets.values()) {
      if (a.realValue === realValue) {
        const now = new Date().toISOString();
        const existingRow = this.db.getAutoSecrets().find(r => r.key === a.key);
        const hitCount = (existingRow?.hit_count || 1) + 1;
        this.db.upsertAutoSecret({
          key: a.key,
          real_value: a.realValue,
          alias: a.alias,
          hit_count: hitCount,
          first_seen_at: a.createdAt,
          last_seen_at: now,
        });
        a.updatedAt = now;
        return a;
      }
    }
    const safeType = type.toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
    const key = 'AUTO_' + safeType + '_' + suffix;
    return this.setAutoSecret(key, realValue, 'Auto-detected ' + type);
  };

  public getManualSecrets = (): SecretEntry[] => [...this.manualSecrets.values()];

  public getAutoSecrets = (): SecretEntry[] => [...this.autoSecrets.values()];

  public promote = (key: string): SecretEntry | null => {
    const auto = this.autoSecrets.get(key);
    if (!auto) return null;
    this.autoSecrets.delete(key);
    this.db.deleteAutoSecret(key);
    const now = new Date().toISOString();
    const manual: SecretEntry = {
      ...auto,
      updatedAt: now,
    };
    this.representations = undefined;
    this.manualSecrets.set(key, manual);
    this.db.upsertSecret({
      key,
      real_value: auto.realValue,
      alias: auto.alias,
      mask_in_ai: 1,
      description: auto.description || 'Promoted from auto-secret',
      created_at: auto.createdAt,
      updated_at: now,
    });
    return manual;
  };

  public deleteSecret = (key: string): boolean => {
    this.representations = undefined;
    this.db.deleteSecret(key);
    this.db.deleteAutoSecret(key);
    const manualDeleted = this.manualSecrets.delete(key);
    const autoDeleted = this.autoSecrets.delete(key);
    return manualDeleted || autoDeleted;
  };

  public getAllActiveSecrets = (): SecretEntry[] =>
    [this.getManualSecrets(), this.getAutoSecrets()].flatMap(secrets =>
      secrets.filter(secret => secret.maskInAi).sort((a, b) => b.realValue.length - a.realValue.length));

  private getRepresentations = (): SecretRepresentations =>
    this.representations ??= new SecretRepresentations(this.getAllActiveSecrets());

  public getSecretRepresentations = (secret: SecretEntry) => this.getRepresentations().get(secret);

  public getInboundReplacements = () => this.getRepresentations().replacements();

  public maskManualText = (text: string): string => TextReplacer.replace(text, this.getManualSecrets(), this.getSecretRepresentations);

  public maskOutboundText = (text: string): string =>
    TextReplacer.replace(this.maskManualText(text), this.getAutoSecrets(), this.getSecretRepresentations);

  public unmaskInboundText = (text: string): string => this.getRepresentations().restore(text);

  public unmaskObject = <T>(obj: T): T => {
    if (typeof obj === 'string') return this.unmaskInboundText(obj) as unknown as T;
    if (Array.isArray(obj)) return obj.map(item => this.unmaskObject(item)) as unknown as T;
    if (obj !== null && typeof obj === 'object') {
      const copy: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(obj)) copy[k] = this.unmaskObject(v);
      return copy as unknown as T;
    }
    return obj;
  };
}
