import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { AliasRegistry } from './alias-registry.js';
import { SecretRow } from './database-types.js';
import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';

export class ArchivedRepresentations {
  constructor(private db: DatabaseSync, private aliases: AliasRegistry) {
    db.exec('CREATE TABLE IF NOT EXISTS archived_alias_snapshots (id TEXT PRIMARY KEY, complete INTEGER NOT NULL); CREATE TABLE IF NOT EXISTS archived_alias_forms (id TEXT NOT NULL, form INTEGER NOT NULL, alias TEXT NOT NULL, PRIMARY KEY(id, form));');
  }

  private id = (row: SecretRow): string => row.write_revision && (row.is_secret || this.db.prepare('SELECT 1 FROM archived_alias_snapshots WHERE id = ?').get(row.write_revision)) ? row.write_revision : createHash('sha256').update(JSON.stringify([row.alias, row.real_value, row.created_at, row.updated_at])).digest('hex');
  private values = (row: SecretRow): string[] => [...new Set(Object.values(SecretRepresentations.variants(row.real_value)))].filter(Boolean);

  public relocate = (row: SecretRow, identity: string): void => {
    const previous = this.id(row);
    this.db.prepare('INSERT INTO archived_alias_snapshots (id, complete) SELECT ?, complete FROM archived_alias_snapshots WHERE id = ?').run(identity, previous);
    this.db.prepare('INSERT INTO archived_alias_forms (id, form, alias) SELECT ?, form, alias FROM archived_alias_forms WHERE id = ?').run(identity, previous);
    const retained = this.db.prepare('SELECT 1 FROM secret_versions WHERE is_secret = 0 AND alias IS ? AND real_value IS ? AND created_at IS ? AND updated_at IS ? LIMIT 1').get(row.alias, row.real_value, row.created_at, row.updated_at);
    if (!retained) {
      this.db.prepare('DELETE FROM archived_alias_forms WHERE id = ?').run(previous);
      this.db.prepare('DELETE FROM archived_alias_snapshots WHERE id = ?').run(previous);
    }
  };

  public capture = (rows: SecretRow[], uncertainAliases: ReadonlySet<string> = new Set()): void => {
    for (const row of rows) {
      const id = this.id(row);
      if (this.db.prepare('SELECT 1 FROM archived_alias_snapshots WHERE id = ?').get(id)) continue;
      const values = this.values(row);
      const entry = { key: row.key, alias: row.alias, realValue: row.real_value, maskInAi: Boolean(row.mask_in_ai), variants: SecretRepresentations.variants(row.real_value), createdAt: row.created_at, updatedAt: row.updated_at };
      const forms = uncertainAliases.has(row.alias) ? [{ alias: row.alias, value: row.real_value }] : this.aliases.loadHistorical(entry);
      const complete = forms.length === values.length && forms.every((form, index) => form.value === values[index]) && new Set(forms.map(form => form.alias)).size === forms.length;
      this.db.prepare('INSERT INTO archived_alias_snapshots (id, complete) VALUES (?, ?)').run(id, Number(complete));
      for (const form of forms) this.db.prepare('INSERT INTO archived_alias_forms (id, form, alias) VALUES (?, ?, ?)').run(id, values.indexOf(form.value), form.alias);
    }
  };

  public get = (row: SecretRow): readonly SecretRepresentation[] => {
    const values = this.values(row);
    const rows = this.db.prepare('SELECT form, alias FROM archived_alias_forms WHERE id = ? AND form > 0 ORDER BY form').all(this.id(row)) as { form: number; alias: string }[];
    return [{ value: row.real_value, alias: row.alias }, ...rows.flatMap(form => values[form.form] !== undefined ? [{ value: values[form.form], alias: form.alias }] : [])];
  };

  public metadata = (row: SecretRow): 'recorded' | 'partial' => {
    const saved = this.db.prepare('SELECT complete FROM archived_alias_snapshots WHERE id = ?').get(this.id(row)) as { complete: number } | undefined;
    const forms = this.db.prepare('SELECT form, alias FROM archived_alias_forms WHERE id = ? ORDER BY form').all(this.id(row)) as { form: number; alias: string }[];
    const complete = saved?.complete && (row.is_secret && !row.real_value || forms.length === this.values(row).length) && forms.every((form, index) => form.form === index && Boolean(form.alias)) && forms[0]?.alias === row.alias;
    return complete ? 'recorded' : 'partial';
  };
}
