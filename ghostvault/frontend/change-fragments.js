import { escapeHtml } from './utils.js';

export class ChangeFragments {
  static empty = text => `<div class="app-exchange-empty"><p>${escapeHtml(text)}</p><button type="button" class="app-text-button" data-content-mode="full">Показать полный текст</button></div>`;

  static windows = (value, matches) => {
    const windows = [];
    for (const match of matches) {
      const before = value.slice(0, match.start);
      const after = value.slice(match.end);
      const breakAfter = after.search(/[\r\n]/);
      let start = Math.max(0, match.start - 100, before.lastIndexOf('\n') + 1, before.lastIndexOf('\r') + 1);
      let end = Math.min(value.length, match.end + 100, breakAfter < 0 ? value.length : match.end + breakAfter);
      if (start < match.start && /[\uDC00-\uDFFF]/.test(value[start])) start++;
      if (end > match.end && /[\uD800-\uDBFF]/.test(value[end - 1])) end--;
      const last = windows.at(-1);
      if (last && start <= last.end) last.end = Math.max(last.end, end);
      else windows.push({ start, end });
    }
    return windows;
  };

  static render = (value, matches, path, expanded, decorate) => {
    const windows = ChangeFragments.windows(value, matches);
    const truncated = windows.length !== 1 || windows[0]?.start !== 0 || windows[0]?.end !== value.length;
    const full = truncated && expanded.has(path);
    const selected = full ? [{ start: 0, end: value.length }] : windows;
    const fragments = selected.map(({ start, end }, index) => `<div class="app-change-fragment" data-fragment-index="${index}">${start ? '<span class="app-fragment-cut" aria-label="Начало поля скрыто">…</span>' : ''}<div class="app-change-text">${decorate(value.slice(start, end), start, end)}</div>${end < value.length ? '<span class="app-fragment-cut" aria-label="Продолжение поля скрыто">…</span>' : ''}</div>`).join('');
    const toggle = truncated ? `<button type="button" class="app-text-button app-context-toggle" data-context-toggle="${escapeHtml(path)}" aria-expanded="${full}">${full ? 'Свернуть до мест замен' : 'Показать поле целиком'}</button>` : '';
    return '<div class="app-change-fragments">' + fragments + '</div>' + toggle;
  };
}
