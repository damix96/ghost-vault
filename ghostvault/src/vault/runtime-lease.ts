import { DatabaseSync } from 'node:sqlite';

export class RuntimeLease {
  private connection?: DatabaseSync;
  private claimed = false;

  constructor(private path: string) {}

  public acquire = (): void => {
    if (this.claimed) throw new Error('Один VaultStore на соединение БД: автоматические секреты принадлежат одному процессу.');
    if (this.path !== ':memory:') {
      const connection = new DatabaseSync(this.path + '.runtime-lock');
      try {
        connection.exec('PRAGMA busy_timeout = 0; BEGIN EXCLUSIVE; CREATE TABLE IF NOT EXISTS runtime_lock (id INTEGER);');
        this.connection = connection;
      } catch {
        connection.close();
        throw new Error('Эта БД уже обслуживается другим VaultStore. Общая БД нескольких процессов не поддерживается для секретов в памяти.');
      }
    }
    this.claimed = true;
  };

  public close = (): void => { this.connection?.close(); this.connection = undefined; this.claimed = false; };
}
