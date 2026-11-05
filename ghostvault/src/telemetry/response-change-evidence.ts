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

export interface EvidenceTextProjection {
  text: string;
  ranges: Array<{ start: number; end: number; replacement: string }>;
}

export class ResponseChangeEvidence {
  private values: Map<string, string>;
  private keys: Map<string, string | undefined>;
  private ordinal = 0;
  private captures: Array<{ before: string; after: string; matches: RestorationMatch[]; source: RestorationSource; fieldId: string }> = [];
  private bytes = 0;
  private state: ResponseChanges = { version: 1, status: 'pending', stage: 'restoration', postHookModified: false, items: [] };

  constructor(replacements: Array<{ from: string; to: string; key?: string }>, private project: (text: string) => EvidenceTextProjection = text => ({ text, ranges: [] })) {
    this.values = new Map(replacements.map(({ from, to }) => [from, to]));
    this.keys = new Map(replacements.map(({ from, key }) => [from, key]));
  }

  public snapshot = (): ResponseChanges => {
    const items: ResponseChange[] = [];
    for (const capture of this.captures) this.collect(capture.before, capture.after, capture.matches, capture.source, capture.fieldId, items);
    return { ...this.state, items };
  };
  public retainedBytes = (): number => this.bytes;
  public finish = (status: ResponseChanges['status']): void => { if (this.state.status !== 'interrupted' || status !== 'complete') this.state.status = status; };
  public hookChanged = (): void => { this.state.postHookModified = true; };

  private offset = (position: number, ranges: EvidenceTextProjection['ranges'], end = false): number => {
    let shift = 0;
    for (const range of ranges) {
      if (position < range.start) break;
      if (position === range.start) return position + shift;
      if (position < range.end) return range.start + shift + (end ? range.replacement.length : 0);
      shift += range.replacement.length - (range.end - range.start);
    }
    return position + shift;
  };

  private projectedFragment = (projections: EvidenceTextProjection[], start: number, end: number) => {
    for (const projection of projections) { start = this.offset(start, projection.ranges); end = this.offset(end, projection.ranges, true); }
    return this.fragment(projections.at(-1)!.text, start, end);
  };

  private rebuild = (text: string, ranges: EvidenceTextProjection['ranges']): string => {
    let output = '';
    let cursor = 0;
    for (const range of ranges) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.start < cursor || range.end <= range.start || range.end > text.length || typeof range.replacement !== 'string') throw new Error('Invalid diagnostic projection');
      output += text.slice(cursor, range.start) + range.replacement;
      cursor = range.end;
    }
    return output + text.slice(cursor);
  };

  private projection = (text: string): EvidenceTextProjection => {
    const projected = this.project(text);
    if (this.rebuild(text, projected.ranges) !== projected.text) throw new Error('Inconsistent diagnostic projection');
    return projected;
  };

  private stable = (projection: EvidenceTextProjection): EvidenceTextProjection[] => {
    const stages = [projection];
    for (let pass = 0; pass < 32; pass++) {
      const next = this.projection(stages.at(-1)!.text);
      if (next.text === stages.at(-1)!.text) return stages;
      stages.push(next);
    }
    throw new Error('Diagnostic projection did not stabilize');
  };

  private transformed = (before: string, after: string, matches: RestorationMatch[], prior: EvidenceTextProjection): EvidenceTextProjection => {
    const restoration = matches.map(match => ({ start: match.start, end: match.end, replacement: match.value }));
    if (this.rebuild(before, restoration) !== after) throw new Error('Inconsistent restoration provenance');
    let difference = 0;
    for (const match of matches) {
      if (before.slice(match.start, match.end) !== match.alias || match.outputStart !== match.start + difference) throw new Error('Invalid restoration provenance');
      difference += match.value.length - (match.end - match.start);
    }
    const candidates = [
      ...this.projection(after).ranges.map(range => ({ ...range, direct: true })),
      ...prior.ranges.map(range => ({ start: this.offset(range.start, restoration), end: this.offset(range.end, restoration, true), replacement: range.replacement, direct: false })),
    ].filter(range => range.start < range.end).sort((a, b) => a.start - b.start || b.end - a.end || Number(b.direct) - Number(a.direct));
    const ranges: EvidenceTextProjection['ranges'] = [];
    for (const range of candidates) {
      const previous = ranges.at(-1);
      if (!previous || previous.end <= range.start) ranges.push({ start: range.start, end: range.end, replacement: range.replacement });
      else if (range.end > previous.end) { previous.end = range.end; previous.replacement = '[protected]'; }
    }
    return { text: this.rebuild(after, ranges), ranges };
  };

  private fragment = (text: string, start: number, end: number) => {
    let from = Math.max(0, start - 96);
    let to = Math.min(text.length, end + 96);
    if (from && /[\uDC00-\uDFFF]/.test(text[from])) from--;
    if (to < text.length && /[\uD800-\uDBFF]/.test(text[to - 1])) to++;
    return { text: text.slice(from, to), start: start - from, end: end - from, contextStart: from, totalLength: text.length };
  };

  private collect = (before: string, after: string, matches: RestorationMatch[], source: RestorationSource, fieldId: string, items: ResponseChange[]): void => {
    try {
      const safeBefore = this.projection(before);
      const safeAfter = this.transformed(before, after, matches, safeBefore);
      const beforeStages = this.stable(safeBefore);
      const afterStages = this.stable(safeAfter);
      for (const match of matches) {
        if (match.alias === match.value) continue;
        const beforeContext = this.projectedFragment(beforeStages, match.start, match.end);
        const afterContext = this.projectedFragment(afterStages, match.outputStart, match.outputStart + match.value.length);
        items.push({ id: 'restore-' + (items.length + 1), fieldId, source, alias: match.alias, value: afterContext.text.slice(afterContext.start, afterContext.end), key: this.keys.get(match.alias), before: beforeContext, after: afterContext });
      }
    } catch {}
  };

  public capture = (before: string, after: string, matches: RestorationMatch[], source: RestorationSource, fieldId = source + ':' + (++this.ordinal)): void => {
    if (!matches.length) return;
    const capture = { before, after, matches: matches.map(match => ({ ...match })), source, fieldId };
    this.bytes += Buffer.byteLength(JSON.stringify(capture), 'utf8');
    this.captures.push(capture);
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
