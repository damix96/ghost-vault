import { DatabaseSync, SQLInputValue } from 'node:sqlite';
import { TextDecoder } from 'node:util';

export class SqliteText {
  public static columns = (names: readonly string[]): string => names.map(name => 'CAST(' + name + ' AS BLOB) AS ' + name).join(', ');
  public static secretColumns = SqliteText.columns(['key', 'real_value', 'alias', 'description', 'created_at', 'updated_at', 'protected_value', 'write_revision']) + ', mask_in_ai, is_secret';
  private decoder: TextDecoder;

  constructor(private db: DatabaseSync) {
    const encoding = this.db.prepare('PRAGMA encoding').get()!.encoding as string;
    this.decoder = new TextDecoder(encoding, { fatal: true, ignoreBOM: true });
  }

  private decode = <T>(row: Record<string, unknown>): T => Object.fromEntries(Object.entries(row).map(([key, value]) => [key, value instanceof Uint8Array ? this.decoder.decode(value) : value])) as T;

  public all = <T>(sql: string, ...parameters: SQLInputValue[]): T[] => this.db.prepare(sql).all(...parameters).map(row => this.decode<T>(row));
}
