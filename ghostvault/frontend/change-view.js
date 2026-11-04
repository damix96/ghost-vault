import { escapeHtml } from './utils.js';
import { MessageOrder } from './message-order.js';
import { ChangeFragments } from './change-fragments.js';

export class ChangeView {
  constructor(display, order = 'oldest', expanded = new Set()) { this.display = display; this.order = order; this.expanded = expanded; }

  render = body => {
    if (body === undefined) return ChangeFragments.empty('Это представление запроса не сохранено.');
    const cards = [];
    const visit = (value, path, role = '') => {
      if (typeof value === 'string') {
        const matches = [...value.matchAll(this.display.matcher())];
        if (!matches.length) return;
        const ranges = matches.map(match => ({ start: match.index, end: match.index + match[0].length }));
        const snippets = ChangeFragments.render(value, ranges, path, this.expanded, text => this.display.render(text));
        const call = /tool_calls|function_call|functionCall|\.arguments$/.test(path);
        const output = ['tool', 'function'].includes(role) || path.includes('functionResponse');
        const label = call ? 'Вызов инструмента' : output ? 'Результат инструмента' : ({ user: 'Пользователь', assistant: 'Ассистент', model: 'Ассистент', system: 'Система', developer: 'Разработчик' }[role] || role || 'Поле запроса');
        cards.push(`<article class="app-change-card" data-reading-key="${escapeHtml(path)}" data-timeline-item tabindex="-1" data-content-kind="${call || output ? 'code' : 'prose'}"><header><strong>${escapeHtml(label)}</strong><code class="app-technical">${escapeHtml(path)}</code></header>${snippets}</article>`);
      } else if (Array.isArray(value)) MessageOrder.ordered(value, path, this.order).forEach(({ value: item, index }) => visit(item, path + '[' + index + ']', role));
      else if (value && typeof value === 'object') {
        const label = value.role || role;
        Object.entries(value).forEach(([key, item]) => visit(item, path ? path + '.' + key : key, label));
      }
    };
    visit(body, 'request');
    return cards.join('') || ChangeFragments.empty('В запросе подстановок нет.');
  };
}
