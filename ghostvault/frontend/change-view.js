import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';
import { MessageOrder } from './message-order.js';

export class ChangeView {
  constructor(display, order = 'oldest', expanded = new Set()) { this.display = display; this.order = order; this.expanded = expanded; }

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
        const truncated = windows.length !== 1 || windows[0].start !== 0 || windows[0].end !== value.length;
        const expanded = truncated && this.expanded.has(path);
        const snippets = expanded ? '<p class="app-change-text">' + this.display.render(value) + '</p>' : windows.map(({ start, end }) => '<p class="app-change-text">' + (start ? '…' : '') + this.display.render(value.slice(start, end)) + (end < value.length ? '…' : '') + '</p>').join('');
        const call = /tool_calls|function_call|functionCall|\.arguments$/.test(path);
        const output = ['tool', 'function'].includes(role) || path.includes('functionResponse');
        const label = call ? 'Вызов инструмента' : output ? 'Результат инструмента' : ({ user: 'Пользователь', assistant: 'Ассистент', model: 'Ассистент', system: 'Система', developer: 'Разработчик' }[role] || role || 'Поле запроса');
        const toggle = truncated ? `<button type="button" class="app-text-button" data-context-toggle="${escapeHtml(path)}" aria-expanded="${expanded}">${expanded ? 'Свернуть до мест замен' : 'Показать поле целиком'}</button>` : '';
        cards.push(`<article class="app-change-card" data-reading-key="${escapeHtml(path)}" data-timeline-item tabindex="-1" data-content-kind="${call || output ? 'code' : 'prose'}"><header><strong>${escapeHtml(label)}</strong><code class="app-technical">${escapeHtml(path)}</code></header>${snippets}${toggle}</article>`);
      } else if (Array.isArray(value)) MessageOrder.ordered(value, path, this.order).forEach(({ value: item, index }) => visit(item, path + '[' + index + ']', role));
      else if (value && typeof value === 'object') {
        const label = value.role || role;
        Object.entries(value).forEach(([key, item]) => visit(item, path ? path + '.' + key : key, label));
      }
    };
    visit(body, 'request');
    return cards.join('') || Ui.empty('В сохранённом запросе подстановок нет. Полный текст доступен рядом.');
  };
}
