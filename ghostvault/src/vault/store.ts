import { SecretEntry } from '../types/index.js';
import { VaultDatabase, SecretRow } from './sqlite-db.js';
import { TextReplacer } from './text-replacer.js';
import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';
import { AliasConflict } from './alias-registry.js';
import { LabelTemplate } from './label-template.js';
import { randomUUID } from 'node:crypto';

export class VaultStore {
  private db: VaultDatabase;
  private manualSecrets = new Map<string, SecretEntry>();
  private autoSecrets = new Map<string, SecretEntry>();
  private archived: SecretEntry[] = [];
  private forms = new Map<string, readonly SecretRepresentation[]>();

  constructor(db?: VaultDatabase) {
    this.db = db ?? new VaultDatabase();
    this.db.claimRuntime();
    this.loadFromDb();
  }

  public getDatabase = (): VaultDatabase => this.db;
  public static computeVariants = SecretRepresentations.variants;

  private fromRow = (row: SecretRow): SecretEntry => ({ key: row.key, realValue: row.real_value, alias: row.alias, maskInAi: Boolean(row.mask_in_ai), description: row.description, variants: VaultStore.computeVariants(row.real_value), createdAt: row.created_at, updatedAt: row.updated_at, storage: 'manual' });

  private loadFromDb = (): void => {
    for (const row of this.db.getSecrets()) this.manualSecrets.set(row.key, this.fromRow(row));
    for (const row of this.db.getAutoSecrets()) {
      if (this.manualSecrets.has(row.key)) throw new AliasConflict('Legacy manual/auto конфликт ключа. Данные сохранены; требуется разрешить конфликт перед запуском.');
      this.autoSecrets.set(row.key, { key: row.key, realValue: row.real_value, alias: row.alias, maskInAi: true, variants: VaultStore.computeVariants(row.real_value), createdAt: row.first_seen_at, updatedAt: row.last_seen_at, storage: 'legacy', hitCount: row.hit_count });
    }
    this.archived = this.db.getVersions().map(this.fromRow);
    const entries = [...this.getAllActiveSecrets(), ...this.getManualSecrets().filter(entry => !entry.maskInAi), ...this.archived];
    if (new Set(entries.map(entry => entry.alias)).size !== entries.length) throw new AliasConflict('В сохранённых данных совпадают метки. Данные не удалены; требуется разрешить конфликт перед запуском.');
    const legacy = new SecretRepresentations(entries);
    this.db.aliases.transaction(() => {
      for (const entry of entries) {
        const stored = this.db.aliases.load(entry);
        const forms = stored || legacy.get(entry);
        if (!stored) this.db.aliases.reserve(forms, randomUUID(), true);
        this.forms.set(entry.alias, forms);
        entry.representations = forms;
      }
    });
    for (const entry of this.manualSecrets.values()) entry.retainedVersions = this.archived.filter(version => version.key === entry.key).length;
  };

  private entry = (key: string, realValue: string, description?: string): SecretEntry => {
    if (!/^[A-Z0-9_]+$/.test(key)) throw Object.assign(new Error('Имя должно содержать только A–Z, 0–9 и _. '), { statusCode: 400 });
    const now = new Date().toISOString();
    return { key, realValue, alias: '$${<' + key + '>}', maskInAi: true, description, variants: VaultStore.computeVariants(realValue), createdAt: now, updatedAt: now };
  };

  private persist = (entry: SecretEntry): void => this.db.upsertSecret({ key: entry.key, real_value: entry.realValue, alias: entry.alias, mask_in_ai: Number(entry.maskInAi), description: entry.description || '', created_at: entry.createdAt, updated_at: entry.updatedAt });

  public setManualSecret = (key: string, realValue: string, description?: string): SecretEntry => {
    if (this.autoSecrets.has(key)) throw new AliasConflict('Имя принадлежит автосекрету. Сначала закрепите его.');
    const current = this.manualSecrets.get(key);
    const entry: SecretEntry = { ...this.entry(key, realValue, description), storage: 'manual' as const, maskInAi: current?.maskInAi ?? true, createdAt: current?.createdAt || new Date().toISOString(), retainedVersions: current?.retainedVersions || 0 };
    if (current?.realValue === realValue) {
      entry.alias = current.alias;
      entry.representations = this.getSecretRepresentations(current);
      this.db.aliases.transaction(() => this.persist(entry));
    } else {
      if (current) entry.retainedVersions = (entry.retainedVersions || 0) + 1;
      let allocated: readonly SecretRepresentation[] | undefined;
      for (let attempt = 0; attempt < (current ? 16 : 1); attempt++) {
        if (current) entry.alias = '$${<' + key + '_V_' + this.db.aliases.randomSuffix() + '>}';
        try {
          allocated = this.db.aliases.allocate(entry, true, () => { if (current) this.db.archiveSecret(key); this.persist(entry); });
          break;
        } catch (error) { if (!(error instanceof AliasConflict) || !current || attempt === 15) throw error; }
      }
      this.forms.set(entry.alias, allocated!);
      entry.representations = allocated!;
      if (current) this.archived.push(current);
    }
    this.manualSecrets.set(key, entry);
    return entry;
  };

  public setAutoSecret = (key: string, realValue: string, description?: string): SecretEntry => {
    const entry: SecretEntry = { ...this.entry(key, realValue, description), storage: 'memory' as const, hitCount: 1 };
    const forms = this.db.aliases.allocate(entry, false, () => {});
    this.forms.set(entry.alias, forms);
    entry.representations = forms;
    this.autoSecrets.set(key, entry);
    return entry;
  };

  public findByValue = (value: string): SecretEntry | undefined => [...this.manualSecrets.values(), ...this.autoSecrets.values()].find(entry => entry.realValue === value);

  public previewLabel = (value: string, prefix: string) => {
    const existing = this.findByValue(value);
    return { labelPrefix: prefix, alias: existing?.alias || '$${<' + prefix + '_' + this.db.aliases.randomSuffix() + '>}', existing: Boolean(existing), labelNotice: existing ? 'Для этого значения уже выдана метка; шаблон её не изменит.' : 'Содержимое групп в метке видно провайдеру. Суффикс предварительный: при обнаружении будет выдан новый.' };
  };

  public registerAutoDetectedSecret = (realValue: string, type: string, prefix = LabelTemplate.prefix(type)): SecretEntry => {
    const existing = this.findByValue(realValue);
    if (existing) {
      if (existing.storage !== 'manual') { existing.hitCount = (existing.hitCount || 1) + 1; existing.updatedAt = new Date().toISOString(); }
      return existing;
    }
    for (let attempt = 0; attempt < 16; attempt++) {
      try { return this.setAutoSecret(prefix + '_' + this.db.aliases.randomSuffix(), realValue, 'Auto-detected ' + type); }
      catch (error) { if (!(error instanceof AliasConflict)) throw error; }
    }
    throw Object.assign(new Error('Не удалось выделить уникальную метку. Запрос не отправлен.'), { statusCode: 503, code: 'ALIAS_ALLOCATION_EXHAUSTED' });
  };

  public getManualSecrets = (): SecretEntry[] => [...this.manualSecrets.values()];
  public getAutoSecrets = (): SecretEntry[] => [...this.autoSecrets.values()];
  public getRetention = () => ({ auto: 'process', legacyCount: this.getAutoSecrets().filter(entry => entry.storage === 'legacy').length, notice: 'Новые автосекреты хранятся в памяти до остановки процесса. Старые сохранённые автосекреты, ручные значения, история и файлы экспорта могут содержать оригиналы на диске.' });

  public promote = (key: string): SecretEntry | null => {
    const auto = this.autoSecrets.get(key);
    if (!auto) return null;
    const manual = { ...auto, storage: 'manual' as const, retainedVersions: 0, updatedAt: new Date().toISOString() };
    this.db.aliases.transaction(() => {
      this.db.aliases.reserve(this.getSecretRepresentations(auto), this.db.aliases.owner(auto.alias)!, true);
      this.persist(manual);
      this.db.deleteAutoSecret(key);
    });
    this.autoSecrets.delete(key);
    this.manualSecrets.set(key, manual);
    return manual;
  };

  public deleteSecret = (key: string): boolean => {
    const entry = this.manualSecrets.get(key) || this.autoSecrets.get(key);
    if (!entry) return false;
    this.db.aliases.transaction(() => {
      this.db.deleteSecret(key); this.db.deleteAutoSecret(key); this.db.deleteVersions(key);
      for (const removed of [entry, ...this.archived.filter(version => version.key === key)]) this.db.aliases.forget(removed.alias);
    });
    for (const removed of [entry, ...this.archived.filter(version => version.key === key)]) this.forms.delete(removed.alias);
    this.archived = this.archived.filter(version => version.key !== key);
    this.manualSecrets.delete(key);
    this.autoSecrets.delete(key);
    return true;
  };

  public getAllActiveSecrets = (): SecretEntry[] => [this.getManualSecrets(), this.getAutoSecrets()].flatMap(secrets => secrets.filter(secret => secret.maskInAi).sort((a, b) => b.realValue.length - a.realValue.length));
  public getSecretRepresentations = (secret: Pick<SecretEntry, 'alias'>): readonly SecretRepresentation[] => this.forms.get(secret.alias) || [];
  public getInboundReplacements = () => [...this.forms.values()].flatMap(forms => forms.map(({ alias, value }) => ({ from: alias, to: value })));
  public maskManualText = (text: string): string => TextReplacer.replace(text, this.getManualSecrets(), this.getSecretRepresentations);
  public maskOutboundText = (text: string): string => TextReplacer.replace(this.maskManualText(text), this.getAutoSecrets(), this.getSecretRepresentations);
  public snapshot = () => {
    const replacements = this.getInboundReplacements();
    const inbound = new Map(replacements.map(({ from, to }) => [from, to]));
    return { getInboundReplacements: () => replacements, unmaskInboundText: (text: string) => text.replace(/\$\$\{<[A-Z0-9_]+>\}/g, alias => inbound.get(alias) ?? alias) };
  };
  public unmaskInboundText = (text: string): string => {
    const inbound = new Map(this.getInboundReplacements().map(({ from, to }) => [from, to]));
    return text.replace(/\$\$\{<[A-Z0-9_]+>\}/g, alias => inbound.get(alias) ?? alias);
  };
  public unmaskObject = <T>(obj: T): T => {
    if (typeof obj === 'string') return this.unmaskInboundText(obj) as T;
    if (Array.isArray(obj)) return obj.map(item => this.unmaskObject(item)) as T;
    if (obj !== null && typeof obj === 'object') return Object.fromEntries(Object.entries(obj).map(([key, value]) => [key, this.unmaskObject(value)])) as T;
    return obj;
  };
}
