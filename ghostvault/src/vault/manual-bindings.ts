import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SecretEntry } from '../types/index.js';
import { AliasConflict, AliasRegistry } from './alias-registry.js';
import { SecretRepresentation } from './secret-representations.js';

interface Binding { format: string; alias: string }

export class ManualBindings {
  constructor(private db: DatabaseSync, private registry: AliasRegistry) {
    db.exec('CREATE TABLE IF NOT EXISTS manual_alias_forms (key TEXT NOT NULL, format TEXT NOT NULL, alias TEXT NOT NULL UNIQUE, PRIMARY KEY (key, format));');
    db.exec('CREATE TABLE IF NOT EXISTS manual_alias_names (name TEXT PRIMARY KEY, owner TEXT NOT NULL);');
  }

  public has = (key: string): boolean => Boolean(this.db.prepare('SELECT 1 FROM manual_alias_forms WHERE key = ? LIMIT 1').get(key));

  public bind = (entry: SecretEntry, allowExisting: boolean, renameOwner?: string, activeAliases: ReadonlySet<string> = new Set()): SecretRepresentation[] => {
    const rows = this.db.prepare('SELECT format, alias FROM manual_alias_forms WHERE key = ?').all(entry.key) as unknown as Binding[];
    const aliases = new Map(rows.map(row => [row.format, row.alias]));
    const previousOwner = this.registry.owner(entry.alias);
    const previousName = this.db.prepare('SELECT owner FROM manual_alias_names WHERE name = ?').get(entry.key) as { owner: string } | undefined;
    if (previousName && previousName.owner !== previousOwner) throw new AliasConflict('История владельца имени не соответствует реестру. Данные сохранены.');
    const reclaim = previousOwner && !allowExisting;
    if (reclaim && (previousName?.owner !== previousOwner || aliases.get('RAW') !== entry.alias || rows.some(row => activeAliases.has(row.alias)))) throw new AliasConflict('Это имя уже использовалось или занято активной переменной. Выберите новое имя.');
    if (previousOwner && allowExisting && !renameOwner && previousName?.owner !== previousOwner && !this.registry.isDurableBase(entry.alias)) throw new AliasConflict('Метка принадлежит другому формату или недоступному автосекрету. Данные сохранены.');
    const owner = renameOwner || (reclaim ? randomUUID() : previousOwner) || randomUUID();
    if (reclaim) this.registry.transferManual(rows.map(row => row.alias), previousOwner, owner);
    this.db.prepare('INSERT INTO manual_alias_names (name, owner) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET owner = excluded.owner').run(entry.key, owner);
    const names: Record<string, string> = { raw: 'RAW', urlEncoded: 'URL', jsonEscaped: 'SLASH', base64: 'BASE64', jsonStringEscaped: 'JSON1', jsonSlashEscaped: 'JSON_SLASH1' };
    const formats = new Map(Object.entries(entry.variants).map(([format, value]) => [names[format] || format, value]));
    return [...formats].map(([format, value]) => {
      let alias = aliases.get(format);
      if (!alias) {
        const base = format === 'RAW' ? entry.alias : entry.alias.slice(0, -2) + '__GV_' + format + '>}';
        alias = base;
        let suffix = 0;
        while (format !== 'RAW' && this.occupied(alias, owner, entry.key)) alias = base.slice(0, -2) + '_' + (++suffix) + '>}';
        this.registry.reserveManual(alias, owner);
        this.db.prepare('INSERT INTO manual_alias_forms (key, format, alias) VALUES (?, ?, ?)').run(entry.key, format, alias);
      } else if (this.registry.owner(alias) !== owner || (format === 'RAW' && alias !== entry.alias)) {
        throw new AliasConflict('Реестр ручных переменных повреждён. Данные сохранены; требуется восстановление совместимой копии.');
      }
      return { alias, value };
    });
  };

  private occupied = (alias: string, owner: string, key: string): boolean => Boolean(
    (this.registry.owner(alias) && this.registry.owner(alias) !== owner) ||
    this.db.prepare('SELECT 1 FROM manual_alias_forms WHERE alias = ? AND key <> ?').get(alias, key)
  );
}
