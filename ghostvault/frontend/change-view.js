import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class ChangeView {
  constructor(display) { this.display = display; }

  render = body => {
    if (body === undefined) return Ui.empty('Это представление запроса не сохранено.');
    const cards = [];
    const visit = (value, path, role = '') => {
      if (typeof value === 'string') {
        const matches = [...value.matchAll(this.display.matcher())];
        const windows = [];
        for (const match of matches) {
          const start = Math.max(0, match.index - 70);
          const end = Math.min(value.length, match.index + match[0].length + 70);
          const last = windows.at(-1);
          if (last && start <= last.end) last.end = end;
          else windows.push({ start, end });
        }
        if (!windows.length) return;
        const snippets = windows.map(({ start, end }) => '<p class="app-change-text">' + (start ? '…' : '') + this.display.render(value.slice(start, end)) + (end < value.length ? '…' : '') + '</p>').join('');
        cards.push(`<article class="app-change-card"><header><strong>${escapeHtml(role || 'Поле запроса')}</strong><code>${escapeHtml(path)}</code></header>${snippets}<button type="button" class="app-text-button" data-context-toggle aria-expanded="false">Показать контекст</button><div class="app-context app-prose" hidden>${this.display.render(value)}</div></article>`);
      } else if (Array.isArray(value)) value.forEach((item, index) => visit(item, path + '[' + index + ']', role));
      else if (value && typeof value === 'object') {
        const label = { user: 'Пользователь', assistant: 'Ассистент', system: 'Система', developer: 'Разработчик', tool: 'Инструмент' }[value.role] || value.role || role;
        Object.entries(value).forEach(([key, item]) => visit(item, path ? path + '.' + key : key, label));
      }
    };
    visit(body, 'request');
    return cards.join('') || Ui.empty('В сохранённом запросе подстановок нет. Полный текст доступен рядом.');
  };
}
