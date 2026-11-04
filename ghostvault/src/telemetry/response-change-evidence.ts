export interface RestorationMatch {
  alias: string;
  value: string;
  start: number;
  end: number;
  outputStart: number;
}

export type RestorationSource = 'response-field' | 'stream-text' | 'tool-arguments' | 'protocol-snapshot';

export interface ResponseChange {
  id: string;
  fieldId: string;
  source: RestorationSource;
  alias: string;
  value: string;
  key?: string;
  before: { text: string; start: number; end: number; contextStart: number; totalLength: number };
  after: { text: string; start: number; end: number; contextStart: number; totalLength: number };
}

export interface ResponseChanges {
  version: 1;
  status: 'pending' | 'complete' | 'interrupted' | 'not-processed';
  stage: 'restoration';
  postHookModified: boolean;
  items: ResponseChange[];
}

export class ResponseChangeEvidence {
  private values: Map<string, string>;
  private keys: Map<string, string | undefined>;
  private ordinal = 0;
  private state: ResponseChanges = { version: 1, status: 'pending', stage: 'restoration', postHookModified: false, items: [] };

  constructor(replacements: Array<{ from: string; to: string; key?: string }>) {
    this.values = new Map(replacements.map(({ from, to }) => [from, to]));
    this.keys = new Map(replacements.map(({ from, key }) => [from, key]));
  }

  public snapshot = (): ResponseChanges => ({ ...this.state, items: [...this.state.items] });
  public finish = (status: ResponseChanges['status']): void => { if (this.state.status !== 'interrupted' || status !== 'complete') this.state.status = status; };
  public hookChanged = (): void => { this.state.postHookModified = true; };

  private fragment = (text: string, start: number, end: number) => {
    let from = Math.max(0, start - 96);
    let to = Math.min(text.length, end + 96);
    if (from && /[\uDC00-\uDFFF]/.test(text[from])) from--;
    if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to++;
    return { text: text.slice(from, to), start: start - from, end: end - from, contextStart: from, totalLength: text.length };
  };

  public capture = (before: string, after: string, matches: RestorationMatch[], source: RestorationSource, fieldId = source + ':' + (++this.ordinal)): void => {
    for (const match of matches) {
      if (match.alias === match.value) continue;
      this.state.items.push({ id: 'restore-' + (this.state.items.length + 1), fieldId, source, alias: match.alias, value: match.value, key: this.keys.get(match.alias), before: this.fragment(before, match.start, match.end), after: this.fragment(after, match.outputStart, match.outputStart + match.value.length) });
    }
  };

  public restore = (text: string, source: RestorationSource = 'response-field', fieldId?: string): string => {
    const matches: RestorationMatch[] = [];
    let difference = 0;
    const restored = text.replace(/\$\$\{<[A-Z0-9_]+>\}/g, (alias, start: number) => {
      const value = this.values.get(alias);
      if (value === undefined) return alias;
      matches.push({ alias, value, start, end: start + alias.length, outputStart: start + difference });
      difference += value.length - alias.length;
      return value;
    });
    this.capture(text, restored, matches, source, fieldId);
    return restored;
  };

  public stream = (raw: string, matches: RestorationMatch[], fieldId: string): void => {
    if (!matches.length) return;
    let after = '';
    let cursor = 0;
    for (const match of matches) { after += raw.slice(cursor, match.start) + match.value; cursor = match.end; }
    after += raw.slice(cursor);
    this.capture(raw, after, matches, 'stream-text', fieldId);
  };
}
