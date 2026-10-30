import { SecretEntry } from '../types/index.js';

export interface SecretRepresentation {
  value: string;
  alias: string;
}

export class SecretRepresentations {
  private forms = new Map<SecretEntry, SecretRepresentation[]>();
  private inbound = new Map<string, string>();

  public static variants = (value: string) => {
    const escaped = JSON.stringify(value).slice(1, -1);
    const variants: Record<string, string> = {};
    let json = value;
    let slash = value.replace(/\//g, '\\/');
    for (let depth = 1; depth <= 3; depth++) {
      json = JSON.stringify(json).slice(1, -1);
      slash = JSON.stringify(slash).slice(1, -1);
      variants['JSON' + depth] = json;
      variants['JSON_SLASH' + depth] = json.replace(/\//g, '\\/');
      variants['SLASH_JSON' + depth] = slash;
    }
    return {
      raw: value, urlEncoded: encodeURIComponent(value), jsonEscaped: value.replace(/\//g, '\\/'),
      base64: Buffer.from(value).toString('base64'), jsonStringEscaped: escaped,
      jsonSlashEscaped: escaped.replace(/\//g, '\\/'), ...variants,
    };
  };

  constructor(secrets: SecretEntry[]) {
    const reserved = new Set(secrets.map(secret => secret.alias));
    const names: Record<string, string> = {
      urlEncoded: 'URL', jsonEscaped: 'SLASH', base64: 'BASE64',
      jsonStringEscaped: 'JSON1', jsonSlashEscaped: 'JSON_SLASH1',
    };
    for (const secret of secrets) {
      const forms: SecretRepresentation[] = [];
      const seen = new Set<string>();
      for (const [format, value] of Object.entries(secret.variants)) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        let alias = secret.alias;
        if (format !== 'raw') {
          const name = secret.alias.slice(4, -2) + '__GV_' + (names[format] || format);
          let suffix = '';
          let counter = 0;
          do { alias = '$${<' + name + suffix + '>}'; suffix = '_' + (++counter); } while (reserved.has(alias));
          reserved.add(alias);
        }
        forms.push({ value, alias });
        if (!this.inbound.has(alias)) this.inbound.set(alias, value);
      }
      this.forms.set(secret, forms);
    }
  }

  public get = (secret: SecretEntry): readonly SecretRepresentation[] => this.forms.get(secret) || [];

  public replacements = (): Array<{ from: string; to: string }> =>
    [...this.inbound].map(([from, to]) => ({ from, to }));

  public restore = (text: string): string => text.replace(/\$\$\{<[A-Z0-9_]+>\}/g, alias => this.inbound.get(alias) ?? alias);
}
