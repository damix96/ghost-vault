import { SecretEntry } from '../types/index.js';
import { SecretRepresentation } from './secret-representations.js';

interface Replacement {
  start: number;
  end: number;
  alias: string;
}

export class TextReplacer {
  public static variants = (secret: SecretEntry): string[] =>
    [...new Set(Object.values(secret.variants))].filter(Boolean);

  public static replace = (text: string, secrets: SecretEntry[], representations: (secret: SecretEntry) => readonly SecretRepresentation[]): string => {
    const protectedRanges = [...text.matchAll(/\$\$\{<[A-Z0-9_]+>\}/g)].map(match => ({ start: match.index!, end: match.index! + match[0].length }));
    const candidates: Replacement[] = [];
    for (const secret of secrets) {
      if (!secret.maskInAi) continue;
      for (const { value: variant, alias } of representations(secret)) {
        let offset = 0;
        while ((offset = text.indexOf(variant, offset)) >= 0) {
          candidates.push({ start: offset, end: offset + variant.length, alias });
          offset += variant.length;
        }
      }
    }
    candidates.sort((a, b) => (b.end - b.start) - (a.end - a.start));
    const accepted: Replacement[] = [];
    for (const match of candidates) {
      if ([...protectedRanges, ...accepted].some(range => match.start < range.end && match.end > range.start)) continue;
      accepted.push(match);
    }
    accepted.sort((a, b) => a.start - b.start);
    let cursor = 0;
    let result = '';
    for (const match of accepted) {
      result += text.slice(cursor, match.start) + match.alias;
      cursor = match.end;
    }
    return result + text.slice(cursor);
  };
}
