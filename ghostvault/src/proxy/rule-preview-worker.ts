import { parentPort, workerData } from 'node:worker_threads';
import { isIP } from 'node:net';
import { randomUUID } from 'node:crypto';
import { PayloadCodec } from '../protocols/payload-codec.js';

interface PreviewRow { id: string; session_id: string; client: string; url: string; timestamp: string; text: string }

class RulePreviewWorker {
  results: Record<string, unknown>[] = [];
  more = false;
  contexts: Record<string, string> = {};
  seen = 0;
  regex = new RegExp(workerData.pattern, 'gi');

  scan = (row: PreviewRow) => {
    const originals = new Map<string, string>();
    const transformed = new PayloadCodec().request(row.text, row.url, text => {
      const marker = randomUUID();
      originals.set(marker, text);
      return marker;
    });
    const visit = (value: unknown, path: string, role = ''): void => {
      if (this.more) return;
      if (typeof value === 'string') {
        if (!originals.has(value)) {
          try {
            const nested: unknown = JSON.parse(value);
            if (nested && typeof nested === 'object') visit(nested, path, role);
          } catch {}
          return;
        }
        value = originals.get(value)!;
        const text = value as string;
        this.regex.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = this.regex.exec(text)) !== null) {
          if (!match[0].length) { this.regex.lastIndex++; continue; }
          const found = match[0].trim();
          if (workerData.anyIp ? !isIP(found) : found.length <= 3) continue;
          if (this.seen++ < (workerData.matchOffset || 0)) continue;
          if (this.results.length >= 20) { this.more = true; break; }
          this.contexts[path] = text;
          this.results.push({ session: row.session_id, client: row.client, endpoint: row.url, timestamp: row.timestamp, transaction: row.id, path, role, value: found, before: text.slice(Math.max(0, match.index - 70), match.index), after: text.slice(match.index + match[0].length, match.index + match[0].length + 70), contextBefore: text.slice(Math.max(0, match.index - 500), match.index), contextAfter: text.slice(match.index + match[0].length, match.index + match[0].length + 500) });
        }
      } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, path + '[' + index + ']', role));
      else if (value && typeof value === 'object') {
        const object = value as Record<string, unknown>;
        const nextRole = typeof object.role === 'string' ? object.role : role;
        Object.entries(object).forEach(([key, item]) => visit(item, path + '.' + key, nextRole));
      }
    };
    visit(transformed, 'request');
  };

  run = () => {
    (workerData.rows as PreviewRow[]).forEach(this.scan);
    parentPort?.postMessage({ results: this.results, more: this.more, contexts: this.contexts });
  };
}

try { new RulePreviewWorker().run(); }
catch (error) { parentPort?.postMessage({ error: error instanceof Error ? error.message : 'Не удалось проверить выражение' }); }
