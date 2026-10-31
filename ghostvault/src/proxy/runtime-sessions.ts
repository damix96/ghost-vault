import { TransactionRecord } from '../telemetry/types.js';

interface RuntimeSession {
  id: string;
  firstSeen: string;
  lastSeen: string;
  activity: number;
  activeCalls: number;
  record: TransactionRecord;
  bytes: number;
}

export interface RuntimeCall {
  current: () => boolean;
  update: (record: TransactionRecord) => boolean;
  end: () => void;
}

export class RuntimeSessions {
  public static budgetBytes = 200_000_000;
  private sessions = new Map<string, RuntimeSession>();
  private activity = 0;
  private revision = 0;
  private sourceRevision = 0;
  private bytes = 0;

  constructor(private budget = RuntimeSessions.budgetBytes, private removed: (id: string, reason: string) => void = () => {}, private clock = () => new Date().toISOString()) {}

  private freeze = <T>(value: T): T => {
    if (value && typeof value === 'object' && !Object.isFrozen(value)) { Object.values(value).forEach(this.freeze); Object.freeze(value); }
    return value;
  };

  private measure = (session: RuntimeSession): void => {
    this.bytes -= session.bytes;
    session.bytes = Buffer.byteLength(JSON.stringify({ id: session.id, firstSeen: session.firstSeen, lastSeen: session.lastSeen, activeCalls: session.activeCalls, record: session.record }), 'utf8');
    this.bytes += session.bytes;
    this.revision++;
  };

  private touch = (session: RuntimeSession): void => { session.activity = ++this.activity; session.lastSeen = this.clock(); };

  private evict = (): void => {
    while (this.bytes > this.budget && this.sessions.size > 1) {
      const candidate = [...this.sessions.values()].filter(session => session.activeCalls === 0).sort((a, b) => a.activity - b.activity)[0];
      if (!candidate) break;
      this.remove(candidate.id, 'budget');
    }
  };

  private remove = (id: string, reason: string): boolean => {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.bytes -= session.bytes;
    this.sessions.delete(id);
    this.revision++;
    this.sourceRevision++;
    this.removed(id, reason);
    return true;
  };

  public begin = (input: TransactionRecord): RuntimeCall => {
    const id = input.sessionId || input.id;
    const now = this.clock();
    const session = this.sessions.get(id) || { id, firstSeen: now, lastSeen: now, activity: 0, activeCalls: 0, record: input, bytes: 0 };
    session.activeCalls++;
    this.sourceRevision++;
    session.record = this.freeze(structuredClone({ ...input, sessionId: id, state: 'active' as const }));
    this.sessions.set(id, session);
    this.touch(session);
    this.measure(session);
    this.evict();
    let ended = false;
    const present = () => this.sessions.get(id) === session;
    const current = () => !ended && present() && session.record.id === input.id;
    return {
      current,
      update: record => {
        if (!current()) return false;
        if (JSON.stringify(record.request.body) !== JSON.stringify(session.record.request.body) || record.request.url !== session.record.request.url || record.request.client !== session.record.request.client) this.sourceRevision++;
        session.record = this.freeze(structuredClone({ ...record, sessionId: id, state: 'active' as const }));
        this.touch(session);
        this.measure(session);
        this.evict();
        return true;
      },
      end: () => {
        if (ended) return;
        if (present()) {
          session.activeCalls--;
          if (session.record.id === input.id) session.record = Object.freeze({ ...session.record, state: 'complete' });
          this.touch(session);
          this.measure(session);
          this.evict();
        }
        ended = true;
      },
    };
  };

  public record = (record: TransactionRecord): void => this.begin(record).end();
  public clear = (id?: string): void => { for (const key of id === undefined ? [...this.sessions.keys()] : [id]) this.remove(key, 'deleted'); };
  public stats = () => ({ bytes: this.bytes, budgetBytes: this.budget, sessions: this.sessions.size, revision: this.revision, unit: 'UTF-8 JSON bytes', policy: 'latest-started-call' });
  public records = (): TransactionRecord[] => [...this.sessions.values()].sort((a, b) => b.activity - a.activity).map(session => session.record);
  public find = (id: string): TransactionRecord | undefined => this.records().find(record => record.id === id);
  public bySession = (id: string): TransactionRecord[] => this.sessions.has(id) ? [this.sessions.get(id)!.record] : [];
  public hasRoute = (prefix: string): boolean => this.records().some(record => record.request.url.split('?')[0] === '/' + prefix || record.request.url.startsWith('/' + prefix + '/'));
  public list = () => [...this.sessions.values()].sort((a, b) => b.activity - a.activity).map(session => ({ id: session.id, name: session.id, client: session.record.request.client, firstSeen: session.firstSeen, lastSeen: session.lastSeen, timestamp: session.lastSeen, endpoints: [session.record.request.url], txCount: 1, stepsCount: 1, activeCalls: session.activeCalls, latestTransactionId: session.record.id, state: session.record.state }));

  public previewRevision = (): number => this.sourceRevision;
  public preview = (offset: number, snapshot: string, revision?: number) => {
    if (revision !== undefined && revision !== this.sourceRevision) throw Object.assign(new Error('Последние вызовы изменились. Запустите проверку заново.'), { statusCode: 409 });
    const records = this.records().filter(record => record.timestamp <= snapshot).sort((a, b) => (a.sessionId || '').localeCompare(b.sessionId || ''));
    const rows = records.slice(offset, offset + 1).map(record => ({ id: record.id, session_id: record.sessionId!, client: record.request.client, url: record.request.url, timestamp: record.timestamp, text: typeof record.request.body === 'string' ? record.request.body : JSON.stringify(record.request.body ?? '') }));
    return { total: records.length, rows, next: offset + rows.length, revision: this.sourceRevision };
  };
}
