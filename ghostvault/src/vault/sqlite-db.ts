import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { DefaultRoutes } from './default-routes.js';

export interface SecretRow {
  key: string;
  real_value: string;
  alias: string;
  mask_in_ai: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface AutoSecretRow {
  key: string;
  real_value: string;
  alias: string;
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PatternRow {
  id: string;
  name: string;
  pattern: string;
  type: string;
  enabled: number;
  created_at: string;
}

export interface SessionRow {
  endpoint?: string;
  endpoints?: string;
  id: string;
  client: string;
  first_seen: string;
  last_seen: string;
  tx_count: number;
}

export interface TransactionRow {
  id: string;
  session_id: string;
  client: string;
  method: string;
  url: string;
  status: number;
  latency_ms: number;
  prompt_text: string;
  masked_prompt: string;
  model_response: string;
  intercepted_secrets: string;
  timestamp: string;
  target_provider?: string;
  target_url?: string;
}

export interface RouteRow {
  id: string;
  name: string;
  prefix: string;
  upstream_url: string;
  description: string;
  is_custom: number;
}

export class VaultDatabase {
  private db: DatabaseSync;

  constructor(customPath?: string) {
    const dbPath = customPath || process.env.GHOSTVAULT_DB_PATH || path.join(os.homedir(), '.ghostvault', 'vault.db');
    if (dbPath !== ':memory:') {
      const parentDir = path.dirname(dbPath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.createTables();
  }

  private createTables = (): void => {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS secrets (
        key TEXT PRIMARY KEY,
        real_value TEXT,
        alias TEXT,
        mask_in_ai INTEGER,
        description TEXT,
        created_at TEXT,
        updated_at TEXT
      );
      CREATE TABLE IF NOT EXISTS auto_secrets (
        key TEXT PRIMARY KEY,
        real_value TEXT,
        alias TEXT,
        hit_count INTEGER,
        first_seen_at TEXT,
        last_seen_at TEXT
      );
      CREATE TABLE IF NOT EXISTS patterns (
        id TEXT PRIMARY KEY,
        name TEXT,
        pattern TEXT,
        type TEXT,
        enabled INTEGER,
        created_at TEXT
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        client TEXT,
        first_seen TEXT,
        last_seen TEXT,
        tx_count INTEGER
      );
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        client TEXT,
        method TEXT,
        url TEXT,
        status INTEGER,
        latency_ms INTEGER,
        prompt_text TEXT,
        masked_prompt TEXT,
        model_response TEXT,
        intercepted_secrets TEXT,
        timestamp TEXT,
        target_provider TEXT,
        target_url TEXT
      );
      CREATE INDEX IF NOT EXISTS transactions_session_time ON transactions(session_id, timestamp);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT
      );
      CREATE TABLE IF NOT EXISTS routes (
        id TEXT PRIMARY KEY,
        name TEXT,
        prefix TEXT UNIQUE,
        upstream_url TEXT,
        description TEXT,
        is_custom INTEGER DEFAULT 0
      );
    `);
    try {
      this.db.exec('ALTER TABLE transactions ADD COLUMN target_provider TEXT;');
    } catch {}
    try {
      this.db.exec('ALTER TABLE transactions ADD COLUMN target_url TEXT;');
    } catch {}
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_chat_base', 'https://api.opencode.ai');
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_anthropic_base', 'https://api.anthropic.com');
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_opencode', 'https://api.opencode.ai');
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_anthropic', 'https://api.anthropic.com');
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_openai', 'https://api.openai.com');
    this.db.prepare('INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)').run('upstream_ollama', 'http://127.0.0.1:11434');
    new DefaultRoutes(this.db).initialize();
  };

  public getSecrets = (): SecretRow[] =>
    this.db.prepare('SELECT * FROM secrets ORDER BY created_at DESC').all() as unknown as SecretRow[];

  public upsertSecret = (row: SecretRow): void => {
    this.db.prepare(
      'INSERT OR REPLACE INTO secrets (key, real_value, alias, mask_in_ai, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(row.key, row.real_value, row.alias, row.mask_in_ai, row.description, row.created_at, row.updated_at);
  };

  public deleteSecret = (key: string): boolean =>
    Number(this.db.prepare('DELETE FROM secrets WHERE key = ?').run(key).changes) > 0;

  public getAutoSecrets = (): AutoSecretRow[] =>
    this.db.prepare('SELECT * FROM auto_secrets ORDER BY last_seen_at DESC').all() as unknown as AutoSecretRow[];

  public upsertAutoSecret = (row: AutoSecretRow): void => {
    this.db.prepare(
      'INSERT OR REPLACE INTO auto_secrets (key, real_value, alias, hit_count, first_seen_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row.key, row.real_value, row.alias, row.hit_count, row.first_seen_at, row.last_seen_at);
  };

  public deleteAutoSecret = (key: string): boolean =>
    Number(this.db.prepare('DELETE FROM auto_secrets WHERE key = ?').run(key).changes) > 0;

  public getPatterns = (): PatternRow[] =>
    this.db.prepare('SELECT * FROM patterns ORDER BY created_at ASC').all() as unknown as PatternRow[];

  public upsertPattern = (row: PatternRow): void => {
    this.db.prepare(
      'INSERT OR REPLACE INTO patterns (id, name, pattern, type, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.name, row.pattern, row.type, row.enabled, row.created_at);
  };

  public deletePattern = (id: string): boolean =>
    Number(this.db.prepare('DELETE FROM patterns WHERE id = ?').run(id).changes) > 0;

  public togglePattern = (id: string): PatternRow | null => {
    const existing = this.db.prepare('SELECT * FROM patterns WHERE id = ?').get(id) as unknown as PatternRow | undefined;
    if (!existing) return null;
    const newEnabled = existing.enabled === 1 ? 0 : 1;
    this.db.prepare('UPDATE patterns SET enabled = ? WHERE id = ?').run(newEnabled, id);
    return { ...existing, enabled: newEnabled };
  };

  public getSessions = (): SessionRow[] =>
    this.db.prepare('SELECT sessions.*, (SELECT json_group_array(DISTINCT url) FROM transactions WHERE session_id = sessions.id) AS endpoints FROM sessions ORDER BY last_seen DESC').all() as unknown as SessionRow[];

  public getSession = (id: string): SessionRow | null =>
    (this.db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as unknown as SessionRow) || null;

  public upsertSession = (id: string, client: string): SessionRow => {
    const now = new Date().toISOString();
    const existing = this.getSession(id);
    if (!existing) {
      const row: SessionRow = { id, client, first_seen: now, last_seen: now, tx_count: 1 };
      this.db.prepare('INSERT INTO sessions (id, client, first_seen, last_seen, tx_count) VALUES (?, ?, ?, ?, ?)').run(id, client, now, now, 1);
      return row;
    }
    const updated: SessionRow = { ...existing, client, last_seen: now, tx_count: existing.tx_count + 1 };
    this.db.prepare('UPDATE sessions SET client = ?, last_seen = ?, tx_count = tx_count + 1 WHERE id = ?').run(client, now, id);
    return updated;
  };

  public deleteSession = (sessionId: string): boolean => {
    this.db.prepare('DELETE FROM transactions WHERE session_id = ?').run(sessionId);
    return Number(this.db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId).changes) > 0;
  };

  public clearAllSessions = (): void => {
    this.db.exec('DELETE FROM transactions; DELETE FROM sessions;');
  };

  public getSetting = (key: string, fallback: string = ''): string => {
    const row = this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined;
    return row ? row.value : fallback;
  };

  public setSetting = (key: string, value: string): void => {
    this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(key, value);
  };

  public getAllSettings = (): Record<string, string> => {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as unknown as { key: string; value: string }[];
    const res: Record<string, string> = {};
    for (const r of rows) res[r.key] = r.value;
    return res;
  };

  public saveTransaction = (row: TransactionRow): void => {
    this.db.prepare(
      'INSERT OR REPLACE INTO transactions (id, session_id, client, method, url, status, latency_ms, prompt_text, masked_prompt, model_response, intercepted_secrets, timestamp, target_provider, target_url) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(row.id, row.session_id, row.client, row.method, row.url, row.status, row.latency_ms, row.prompt_text, row.masked_prompt, row.model_response, row.intercepted_secrets, row.timestamp, row.target_provider || null, row.target_url || null);
  };

  public getTransactions = (limit: number = 50): TransactionRow[] =>
    this.db.prepare('SELECT * FROM transactions ORDER BY timestamp DESC LIMIT ?').all(limit) as unknown as TransactionRow[];

  public getRulePreviewPage = (offset: number, snapshot: string) => {
    const source = 'FROM sessions s JOIN transactions t ON t.id = (SELECT id FROM transactions WHERE session_id = s.id AND timestamp <= ? ORDER BY timestamp DESC, id DESC LIMIT 1)';
    const total = (this.db.prepare('SELECT COUNT(*) AS count ' + source).get(snapshot) as { count: number }).count;
    const rows = this.db.prepare('SELECT t.id, t.session_id, t.client, t.url, t.timestamp, t.prompt_text AS text ' + source + ' ORDER BY s.id LIMIT 1 OFFSET ?').all(snapshot, offset);
    return { total, rows, next: offset + rows.length };
  };

  public getTransactionsBySession = (sessionId: string): TransactionRow[] =>
    this.db.prepare('SELECT * FROM transactions WHERE session_id = ? ORDER BY timestamp DESC').all(sessionId) as unknown as TransactionRow[];

  public getTransaction = (id: string): TransactionRow | null =>
    (this.db.prepare('SELECT * FROM transactions WHERE id = ?').get(id) as unknown as TransactionRow) || null;

  public getAllRoutes = (): RouteRow[] =>
    this.db.prepare('SELECT * FROM routes ORDER BY is_custom ASC, id ASC').all() as unknown as RouteRow[];

  public hasRouteHistory = (prefix: string): boolean => Boolean(this.db.prepare("SELECT 1 FROM transactions WHERE url = '/' || ? OR instr(url, '/' || ? || '/') = 1 LIMIT 1").get(prefix, prefix));

  public upsertRoute = (route: RouteRow): void => {
    this.db.prepare(
      'INSERT OR REPLACE INTO routes (id, name, prefix, upstream_url, description, is_custom) VALUES (?, ?, ?, ?, ?, ?)'
    ).run(route.id, route.name, route.prefix, route.upstream_url, route.description, route.is_custom);
  };

  public deleteRoute = (id: string): boolean =>
    Number(this.db.prepare('DELETE FROM routes WHERE id = ? AND is_custom = 1').run(id).changes) > 0;

  public close = (): void => this.db.close();
}
