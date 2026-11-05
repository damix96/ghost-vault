import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { SecretProtection } from '../security/secret-protection.js';
import { SecretProvider, SecretStorageNotice } from '../security/secret-provider.js';
import { SecretRow } from './database-types.js';
import { ProtectedDiagnostics } from './protected-diagnostics.js';
import { SecretRepresentation } from './secret-representations.js';
import { SqliteText } from './sqlite-text.js';

export class ProtectedStorage {
  private protection: SecretProtection;
  private text: SqliteText;
  public get cleanupPending(): boolean {
    const mode = this.pendingMode();
    return Boolean(mode);
  }

  constructor(private db: DatabaseSync, provider?: SecretProvider) {
    this.text = new SqliteText(db);
    this.db.exec('PRAGMA secure_delete = ON;');
    for (const table of ['secrets', 'secret_versions']) this.schema(table);
    const existing = this.db.prepare("SELECT value FROM settings WHERE key = 'secret_vault_id'").get() as { value: string } | undefined;
    const id = existing?.value || randomUUID();
    if (!existing) this.db.prepare("INSERT INTO settings(key, value) VALUES ('secret_vault_id', ?)").run(id);
    const protectedRows = this.db.prepare('SELECT 1 FROM secrets WHERE is_secret = 1 UNION ALL SELECT 1 FROM secret_versions WHERE is_secret = 1 LIMIT 1').get();
    this.protection = new SecretProtection(id, provider, process.platform, Boolean(protectedRows));
  }

  private schema = (table: string): void => {
    const columns = new Set(this.db.prepare('PRAGMA table_info(' + table + ')').all().map(row => row.name));
    for (const [name, type] of [['is_secret', 'INTEGER NOT NULL DEFAULT 0'], ['protected_value', "TEXT NOT NULL DEFAULT ''"], ['write_revision', "TEXT NOT NULL DEFAULT ''"]]) {
      if (!columns.has(name)) this.db.exec('ALTER TABLE ' + table + ' ADD COLUMN ' + name + ' ' + type);
    }
    for (const action of ['INSERT', 'UPDATE']) this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_protected_${action.toLowerCase()} BEFORE ${action} ON ${table} WHEN NEW.is_secret NOT IN (0, 1) OR (NEW.is_secret = 1 AND (COALESCE(NEW.real_value, '') != '' OR NEW.protected_value = '' OR NEW.write_revision = '')) OR (NEW.is_secret = 0 AND NEW.protected_value != '') BEGIN SELECT RAISE(ABORT, 'Invalid protected value storage'); END;`);
    this.db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_prevent_demotion BEFORE UPDATE ON ${table} WHEN OLD.is_secret = 1 AND NEW.is_secret = 0 BEGIN SELECT RAISE(ABORT, 'Protected value cannot be demoted'); END;`);
  };

  public decode = (row: SecretRow): SecretRow => row.is_secret ? { ...row, real_value: this.protection.unprotect(row.protected_value || '') } : row;

  public prepare = (row: SecretRow): SecretRow => ({
    ...row,
    real_value: row.is_secret ? '' : row.real_value,
    protected_value: row.is_secret ? this.protection.protect(row.real_value) : '',
    is_secret: Number(Boolean(row.is_secret)),
    write_revision: randomUUID(),
  });

  public protectArchives = (key: string, relocate: (row: SecretRow, identity: string) => void): void => {
    const rows = this.text.all<SecretRow & { archive_rowid: number }>('SELECT rowid AS archive_rowid, ' + SqliteText.secretColumns + ' FROM secret_versions WHERE key = ?', key);
    for (const row of rows) {
      if (row.is_secret) continue;
      const protectedRow = this.prepare({ ...row, is_secret: 1 });
      this.db.prepare('UPDATE secret_versions SET real_value = ?, is_secret = 1, protected_value = ?, write_revision = ? WHERE rowid = ?').run('', protectedRow.protected_value!, protectedRow.write_revision!, row.archive_rowid);
      relocate(row, protectedRow.write_revision!);
    }
  };

  public sanitizeDiagnostics = (forms: readonly SecretRepresentation[]): void => {
    if (new ProtectedDiagnostics(this.db).sanitize(forms)) this.markPending(true);
  };

  private pendingMode = (): string => (this.db.prepare("SELECT value FROM settings WHERE key = 'secret_storage_cleanup_pending'").get() as { value?: string } | undefined)?.value || '';

  public markPending = (purgeFreePages = false): void => {
    const mode = purgeFreePages || this.pendingMode() === 'purge' ? 'purge' : 'checkpoint';
    this.db.prepare("INSERT OR REPLACE INTO settings(key, value) VALUES ('secret_storage_cleanup_pending', ?)").run(mode);
  };

  public notice = (): SecretStorageNotice | undefined => this.cleanupPending ? { code: 'SECRET_STORAGE_CLEANUP_PENDING', message: 'Защищённые значения сохранены. Очистка прежних открытых копий в текущей базе ещё не подтверждена; повторно отправлять значения не нужно.' } : undefined;

  public clean = (purgeFreePages = false): boolean => {
    if (purgeFreePages) this.markPending(true);
    const pending = this.pendingMode();
    if (!pending) return true;
    const timeout = this.db.prepare('PRAGMA busy_timeout').get() as { timeout: number };
    try {
      this.db.exec('PRAGMA busy_timeout = 0');
      if (pending === 'purge') this.db.exec('VACUUM');
      const result = this.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() as { busy: number };
      if (result.busy) return false;
      this.db.prepare("UPDATE settings SET value = '' WHERE key = 'secret_storage_cleanup_pending'").run();
      return true;
    } catch { return false; }
    finally { try { this.db.exec('PRAGMA busy_timeout = ' + Number(timeout.timeout)); } catch {} }
  };
}
