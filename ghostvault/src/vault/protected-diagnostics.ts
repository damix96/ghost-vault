import { DatabaseSync } from 'node:sqlite';
import { SecretRepresentation } from './secret-representations.js';
import { SecretRedactor } from './secret-redactor.js';
import { SqliteText } from './sqlite-text.js';

export class ProtectedDiagnostics {
  private columns = ['prompt_text', 'masked_prompt', 'model_response', 'intercepted_secrets', 'url', 'target_url'];
  constructor(private db: DatabaseSync) {}

  private project = (column: string, value: unknown, redactor: SecretRedactor): unknown => {
    if (typeof value !== 'string') return value;
    if (column === 'intercepted_secrets') {
      try {
        const decoded = JSON.parse(value);
        const safe = redactor.redact(decoded);
        return JSON.stringify(decoded) === JSON.stringify(safe) ? value : JSON.stringify(safe);
      } catch {}
    }
    return redactor.redact(value);
  };

  public sanitize = (forms: readonly SecretRepresentation[]): number => {
    if (!forms.length) return 0;
    const redactor = new SecretRedactor();
    redactor.remember(forms);
    const rows = new SqliteText(this.db).all<Record<string, unknown> & { id: string }>('SELECT id, ' + SqliteText.columns(this.columns) + ' FROM transactions');
    const update = this.db.prepare('UPDATE transactions SET ' + this.columns.map(column => column + ' = ?').join(', ') + ' WHERE id = ?');
    let changed = 0;
    for (const row of rows) {
      const values = this.columns.map(column => this.project(column, row[column], redactor));
      if (values.every((value, index) => value === row[this.columns[index]])) continue;
      update.run(...values as (string | number | bigint | null | Uint8Array)[], row.id);
      changed++;
    }
    return changed;
  };
}
