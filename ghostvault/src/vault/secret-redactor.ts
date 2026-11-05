import { SecretRepresentation } from './secret-representations.js';
import { SecretPreview } from './secret-preview.js';

export class SecretRedactor {
  private forms = new Map<string, string>();
  private pattern?: RegExp;
  private preview?: SecretPreview;
  private metadata = new Set(['key', 'alias', 'name', 'id', 'sessionId', 'transactionId', 'requestId', 'revision', 'source', 'storage', 'origin', 'format', 'scope', 'type', 'method', 'client', 'code', 'createdAt', 'updatedAt', 'created_at', 'updated_at', 'timestamp', 'exportedAt', 'representationMetadata']);
  private content = new Set(['body', 'headers', 'prompt', 'prompt_text', 'model_response', 'intercepted_secrets', 'maskedPrompt', 'text', 'content', 'messages', 'logs', 'output', 'input', 'requestBody', 'responseBody']);

  public remember = (forms: readonly SecretRepresentation[]): void => {
    const seen = new Set<string>();
    for (const { value, alias } of forms) if (value && !seen.has(value)) {
      seen.add(value);
      this.forms.set(value, value === alias ? '[protected]' : alias);
    }
    this.pattern = undefined;
    this.preview = undefined;
  };

  private text = (value: string, boundary = value.length): string => {
    if (!this.forms.size) return value.slice(0, boundary);
    this.pattern ??= new RegExp([...this.forms.keys()].sort((a, b) => b.length - a.length).map(form => form.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|'), 'g');
    const tokens = [...value.matchAll(/\$\$\{<[A-Z0-9_]+>\}/g)].map(match => ({ start: match.index, end: match.index + match[0].length }));
    let projectedBoundary = boundary;
    const projected = value.replace(this.pattern, (original, offset: number) => {
      if (tokens.some(token => offset >= token.start && offset + original.length <= token.end)) return original;
      const alias = this.forms.get(original)!;
      if (offset < boundary) projectedBoundary += alias.length - Math.min(original.length, boundary - offset);
      return alias;
    });
    return projected.slice(0, projectedBoundary);
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
