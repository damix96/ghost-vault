import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class SecretDisplay {
  aliases = new Map();

  constructor(secrets = []) {
    for (const secret of secrets) if (secret.alias && typeof secret.realValue === 'string') this.aliases.set(secret.alias, { secret, value: secret.realValue, format: 'Обычный текст' });
    for (const secret of secrets) {
      if (!secret.alias || typeof secret.realValue !== 'string') continue;
      const seen = new Set([secret.realValue]);
      for (const [format, value] of Object.entries(SecretDisplay.forms(secret.realValue))) {
        if (!value || seen.has(value)) continue;
        seen.add(value);
        const alias = '$${<' + secret.key + '__GV_' + format + '>}';
        if (!this.aliases.has(alias)) this.aliases.set(alias, { secret, value, format });
      }
    }
  }

  static forms = value => {
    const forms = { URL: encodeURIComponent(value), SLASH: value.replace(/\//g, '\\/'), BASE64: btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join('')) };
    let json = value;
    let slash = forms.SLASH;
    for (let depth = 1; depth <= 3; depth++) {
      json = JSON.stringify(json).slice(1, -1);
      slash = JSON.stringify(slash).slice(1, -1);
      forms['JSON' + depth] = json;
      forms['JSON_SLASH' + depth] = json.replace(/\//g, '\\/');
      forms['SLASH_JSON' + depth] = slash;
    }
    return forms;
  };

  matcher = () => new RegExp([...this.aliases.keys()].sort((a, b) => b.length - a.length).map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).concat('\\$\\$\\{<[^<>]+>\\}').join('|'), 'g');

  render = text => {
    const value = String(text ?? '');
    let html = '';
    let offset = 0;
    for (const token of value.matchAll(this.matcher())) {
      html += escapeHtml(value.slice(offset, token.index));
      const entry = this.aliases.get(token[0]);
      const hint = entry ? 'Было: ' + (entry.value === '' ? '(пустая строка)' : entry.value) + '\nУшло: ' + token[0] : 'Значение для этой подстановки отсутствует в списке секретов.';
      html += Ui.explain(token[0], hint, entry?.value || '', entry?.secret.key);
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
          if (entry) result.set(entry.secret.key, (result.get(entry.secret.key) || 0) + 1);
        }
      } else if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === 'object') Object.values(value).forEach(visit);
    };
    visit(body);
    return result;
  };
}
