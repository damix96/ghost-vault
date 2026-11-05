import { SecretRepresentation, SecretRepresentations } from './secret-representations.js';
import { SecretPreview } from './secret-preview.js';

export interface ProtectedTextProjection {
  text: string;
  ranges: Array<{ start: number; end: number; replacement: string }>;
}

export interface ProtectedDiagnostics {
  redact: <T>(value: T) => T;
  project: (value: string) => ProtectedTextProjection;
  preview: (value: string) => string;
  estimatedBytes: () => number;
}

export class SecretRedactor {
  private forms = new Map<string, string>();
  private generation = 0;
  private pattern?: RegExp;
  private preview?: SecretPreview;
  private metadata = new Set(['key', 'alias', 'name', 'id', 'sessionId', 'transactionId', 'requestId', 'revision', 'source', 'storage', 'origin', 'format', 'scope', 'type', 'method', 'client', 'code', 'createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp', 'exportedAt', 'representationMetadata']);
  private content = new Set(['body', 'headers', 'prompt', 'prompt_text', 'model_response', 'intercepted_secrets', 'maskedPrompt', 'text', 'content', 'messages', 'logs', 'output', 'input', 'requestBody', 'responseBody']);

  public remember = (forms: readonly SecretRepresentation[]): void => {
    const seen = new Set<string>();
    let changed = false;
    for (const { value, alias } of forms) if (value && !seen.has(value)) {
      seen.add(value);
      const replacement = value === alias ? '[protected]' : alias;
      if (this.forms.get(value) !== replacement) { this.forms.set(value, replacement); changed = true; }
    }
    if (!changed) return;
    this.generation++;
    this.pattern = undefined;
    this.preview = undefined;
  };

  public snapshot = (restore: (value: string) => string, inboundBytes = 0): ProtectedDiagnostics => {
    if (!Number.isSafeInteger(inboundBytes) || inboundBytes < 0) throw new RangeError('Invalid diagnostic retention charge.');
    let generation = -1;
    let scoped = new SecretRedactor();
    let bytes = Math.min(Number.MAX_SAFE_INTEGER, 8192 + inboundBytes);
    const current = (): SecretRedactor => {
      if (generation === this.generation) return scoped;
      const next = new SecretRedactor();
      next.forms = new Map(this.forms);
      for (const [value, alias] of this.forms) {
        if (/^\$\$\{<[A-Z0-9_]+>\}$/.test(value)) continue;
        const derived = restore(value);
        if (derived === value) continue;
        for (const form of Object.values(SecretRepresentations.variants(derived))) if (form && !next.forms.has(form)) next.forms.set(form, alias);
      }
      let estimated = 8192 + inboundBytes;
      for (const [value, alias] of next.forms) estimated += 256 + 32 * value.length + 2 * alias.length + (this.forms.has(value) ? 0 : 2 * value.length);
      bytes = Math.min(Number.MAX_SAFE_INTEGER, Math.max(bytes, estimated));
      scoped = next;
      generation = this.generation;
      return scoped;
    };
    return { redact: <T>(value: T): T => current().redact(value), project: (value: string) => current().project(value), preview: (value: string) => current().redactPreview(value), estimatedBytes: () => { current(); return bytes; } };
  };

  public project = (value: string): ProtectedTextProjection => {
    const ranges: ProtectedTextProjection['ranges'] = [];
    if (!this.forms.size) return { text: value, ranges };
    this.pattern ??= new RegExp([...this.forms.keys()].sort((a, b) => b.length - a.length).map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const tokens = [...value.matchAll(/\$\$\{<[A-Z0-9_]+>\}/g)].map(match => ({ start: match.index, end: match.index + match[0].length }));
    const text = value.replace(this.pattern, (original, offset: number) => {
      if (tokens.some(token => offset >= token.start && offset + original.length <= token.end)) return original;
      const alias = this.forms.get(original)!;
      ranges.push({ start: offset, end: offset + original.length, replacement: alias });
      return alias;
    });
    return { text, ranges };
  };

  private text = (value: string, boundary = value.length): string => {
    const projected = this.project(value);
    let projectedBoundary = boundary;
    for (const { start, end, replacement } of projected.ranges) if (start < boundary) projectedBoundary += replacement.length - Math.min(end - start, boundary - start);
    return projected.text.slice(0, projectedBoundary);
  };

  private walk = <T>(value: T, content = false): T => {
    if (typeof value === 'string') return this.text(value) as T;
    if (Buffer.isBuffer(value)) return Buffer.from(this.text(value.toString('utf8'))) as T;
    if (Array.isArray(value)) return value.map(item => this.walk(item, content)) as T;
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, child]) => [content ? this.text(key) : key, !content && this.metadata.has(key) ? child : this.walk(child, content || this.content.has(key))])) as T;
    return value;
  };

  public redact = <T>(value: T): T => this.walk(value);

  public redactPreview = (value: string): string => {
    this.preview ??= new SecretPreview(this.forms.keys());
    return this.text(value, this.preview.trim(value).length);
  };
}
