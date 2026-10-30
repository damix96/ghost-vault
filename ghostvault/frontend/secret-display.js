import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class SecretDisplay {
  aliases = new Map();

  constructor(secrets = []) {
    for (const secret of secrets) if (secret.alias && typeof secret.realValue === 'string') this.aliases.set(secret.alias, { secret, value: secret.realValue, format: 'Обычный текст' });
    for (const secret of secrets) {
      if (!secret.alias || typeof secret.realValue !== 'string') continue;
      for (const representation of secret.representations || []) {
        const { alias, value } = representation;
        if (typeof alias !== 'string' || typeof value !== 'string') continue;
        if (!this.aliases.has(alias)) this.aliases.set(alias, { secret, value, format: value === secret.realValue ? 'Обычный текст' : 'Сохранённое представление' });
      }
    }
  }

  matcher = () => new RegExp([...this.aliases.keys()].sort((a, b) => b.length - a.length).map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).concat('\\$\\$\\{<[^<>]+>\\}').join('|'), 'g');

  render = text => {
    const value = String(text ?? '');
    let html = '';
    let offset = 0;
    for (const token of value.matchAll(this.matcher())) {
      html += escapeHtml(value.slice(offset, token.index));
      const entry = this.aliases.get(token[0]);
      const hint = entry ? 'Было' + (entry.format === 'Обычный текст' ? '' : ' · ' + entry.format) + ': ' + (entry.value === '' ? '(пустая строка)' : entry.value) + '\nУшло: ' + token[0] : 'Значение для этой подстановки отсутствует в списке секретов.';
      html += Ui.explain(token[0], hint, entry?.value, entry?.secret.key);
      offset = token.index + token[0].length;
    }
    return html + escapeHtml(value.slice(offset));
  };

  counts = body => {
    const result = new Map();
    const visit = value => {
      if (typeof value === 'string') {
        for (const match of value.matchAll(this.matcher())) {
          const entry = this.aliases.get(match[0]);
          if (entry) result.set(match[0], (result.get(match[0]) || 0) + 1);
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(body);
    return result;
  };
}
