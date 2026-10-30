import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { SecretEntry } from '../types/index.js';
import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';

export class AliasConflict extends Error {
  statusCode = 409;
  code = 'ALIAS_CONFLICT';
}

export class AliasRegistry {
  constructor(private db: DatabaseSync, public randomSuffix = () => randomBytes(6).toString('hex').toUpperCase()) {
    db.exec('CREATE TABLE IF NOT EXISTS alias_registry (alias_hash TEXT PRIMARY KEY, owner TEXT NOT NULL, form INTEGER NOT NULL, alias TEXT); CREATE INDEX IF NOT EXISTS alias_registry_owner ON alias_registry(owner);');
  }

  private hash = (alias: string): string => createHash('sha256').update(alias).digest('hex');
  private get = (alias: string) => this.db.prepare('SELECT owner, form, alias FROM alias_registry WHERE alias_hash = ?').get(this.hash(alias)) as { owner: string; form: number; alias: string | null } | undefined;

  public transaction = <T>(operation: () => T): T => {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  };

  public owner = (alias: string): string | undefined => this.get(alias)?.owner;

  public forget = (alias: string): void => { this.db.prepare('UPDATE alias_registry SET alias = NULL WHERE owner = ?').run(this.owner(alias) || ''); };

  public reserve = (forms: readonly SecretRepresentation[], owner: string, durable: boolean): void => {
    forms.forEach(({ alias }, form) => {
      const current = this.get(alias);
      if (current && (current.owner !== owner || current.form !== form)) throw new AliasConflict('Метка уже выдана другому секрету. Выберите новое имя.');
      if (!current) this.db.prepare('INSERT INTO alias_registry (alias_hash, owner, form, alias) VALUES (?, ?, ?, ?)').run(this.hash(alias), owner, form, durable ? alias : null);
      else if (durable && !current.alias) this.db.prepare('UPDATE alias_registry SET alias = ? WHERE alias_hash = ?').run(alias, this.hash(alias));
    });
  };

  public load = (secret: SecretEntry): SecretRepresentation[] | undefined => {
    const owner = this.owner(secret.alias);
    if (!owner) return undefined;
    const rows = this.db.prepare('SELECT alias, form FROM alias_registry WHERE owner = ? ORDER BY form').all(owner) as { alias: string | null; form: number }[];
    const forms = new SecretRepresentations([secret]).get(secret);
    if (rows.length !== forms.length || rows.some(row => !row.alias)) throw new AliasConflict('Реестр меток не соответствует сохранённому секрету. Требуется восстановление совместимой копии.');
    return forms.map((entry, index) => ({ value: entry.value, alias: rows[index].alias! }));
  };

  public allocate = (secret: SecretEntry, durable: boolean, save: () => void): SecretRepresentation[] => this.transaction(() => {
    if (this.get(secret.alias)) throw new AliasConflict('Это имя уже использовалось. Выберите новое имя.');
    const owner = randomUUID();
    const forms = new SecretRepresentations([secret]).get(secret).map((entry, index) => {
      let alias = entry.alias;
      let counter = 0;
      while (index > 0 && this.get(alias)) alias = entry.alias.slice(0, -2) + '_' + (++counter) + '>}';
      return { value: entry.value, alias };
    });
    this.reserve(forms, owner, durable);
    save();
    return forms;
  });
}
