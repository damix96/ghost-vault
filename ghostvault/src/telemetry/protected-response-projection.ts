import { ResponseNormalizer } from '../proxy/response-normalizer.js';
import { TransactionRecord } from './types.js';
import { ResponseChangeEvidence } from './response-change-evidence.js';
import { ProtectedDiagnostics } from '../vault/secret-redactor.js';

export type ResponseDiagnostics = ProtectedDiagnostics;

export class ProtectedResponseProjection {
  public static omitted = '[protected raw response omitted]';
  public static unavailable = '[protected diagnostic unavailable]';

  constructor(private diagnostics: ResponseDiagnostics, private evidence: ResponseChangeEvidence) {}

  public bind = (diagnostics: ResponseDiagnostics, evidence: ResponseChangeEvidence): void => {
    this.diagnostics = diagnostics;
    this.evidence = evidence;
  };

  public retainedBytes = (): number => {
    const bytes = this.diagnostics.estimatedBytes();
    if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error('Invalid diagnostic retention estimate');
    return this.evidence.retainedBytes() + bytes;
  };
  public preview = (text: string): string | undefined => {
    try { return this.diagnostics.preview(text); }
    catch { return undefined; }
  };
  public original = (record: TransactionRecord): TransactionRecord => ({ ...record, responseChanges: this.evidence.original() });

  private body = (body: unknown, pending: boolean) => {
    const normalized = ResponseNormalizer.normalize(body);
    if (!normalized || typeof normalized !== 'object' || Array.isArray(normalized)) return { body: this.diagnostics.redact(body), protected: false };
    const { raw, ...semantic } = normalized;
    const safe = this.diagnostics.redact(semantic);
    if (pending && Array.isArray(safe.content)) safe.content = safe.content.map((block: any) => block?.type === 'text' && typeof block.text === 'string' ? { ...block, text: this.diagnostics.preview(block.text) } : block);
    const protectedContent = JSON.stringify(safe) !== JSON.stringify(semantic) || raw !== undefined && JSON.stringify(this.diagnostics.redact(raw)) !== JSON.stringify(raw);
    return { body: protectedContent ? { ...safe, ...(raw !== undefined ? { raw: ProtectedResponseProjection.omitted } : {}) } : body, protected: protectedContent };
  };

  public project = (record: TransactionRecord): TransactionRecord => {
    try {
      const stream = record.response?.isStream;
      const response = stream ? this.body(record.response!.body, record.responseChanges?.status !== 'complete') : undefined;
      const projected = this.diagnostics.redact({ ...record,
        response: record.response ? { ...record.response, body: response?.body ?? record.response.body } : undefined,
        sampleStreamChunk: response?.protected ? ProtectedResponseProjection.omitted : record.sampleStreamChunk,
      });
      return { ...projected, interceptedSecrets: projected.interceptedSecrets.map((entry, index) => ({ ...entry, ...(entry.realValue !== record.interceptedSecrets[index]?.realValue ? { valueHidden: true } : {}) })), responseChanges: this.evidence.snapshot() };
    } catch {
      return { id: record.id, sessionId: record.sessionId, timestamp: record.timestamp, state: record.state,
        request: { method: '', url: '', headers: {}, body: ProtectedResponseProjection.unavailable, client: '' }, interceptedSecrets: [],
        response: record.response ? { status: record.response.status, headers: {}, body: ProtectedResponseProjection.unavailable, isStream: record.response.isStream, client: '' } : undefined,
      };
    }
  };
}
