import { RegExpParser, visitRegExpAST } from '@eslint-community/regexpp';

export class LabelTemplate {
  private static tokens = /\$\$|\$\{([A-Za-z_][A-Za-z0-9_]*|[1-9][0-9]*)\}|\$([A-Za-z][A-Za-z0-9]*|[1-9][0-9]*)|\$/g;

  public static validate = (pattern: string, template?: string | null): void => {
    new RegExp(pattern, 'gi');
    if (template == null) return;
    if (!template.trim() || template.length > 512) throw new Error('Шаблон метки должен содержать от 1 до 512 символов.');
    const ast = new RegExpParser().parsePattern(pattern);
    let count = 0;
    const names = new Set<string>();
    visitRegExpAST(ast, { onCapturingGroupEnter: group => { count++; if (group.name) names.add(group.name); } });
    for (const token of template.matchAll(this.tokens)) {
      if (token[0] === '$$') continue;
      const reference = token[1] || token[2];
      if (!reference || (/^[0-9]+$/.test(reference) ? Number(reference) > count : !names.has(reference))) throw new Error('Неизвестная группа или некорректная ссылка в шаблоне: ' + token[0]);
    }
  };

  public static normalize = (value: string): string => value.toUpperCase().replace(/[^A-Z0-9_]/g, '_').slice(0, 96);

  public static prefix = (type: string, template?: string | null, match?: RegExpMatchArray): string => {
    const fallback = this.normalize('AUTO_' + type);
    if (template == null) return fallback;
    const rendered = template.replace(this.tokens, (token, braced: string, short: string) => {
      if (token === '$$') return '$';
      const reference = braced || short;
      if (!reference) throw new Error('Некорректная ссылка в шаблоне.');
      return (/^[0-9]+$/.test(reference) ? match?.[Number(reference)] : match?.groups?.[reference]) ?? 'NA';
    });
    return this.normalize(rendered) || fallback;
  };
}
