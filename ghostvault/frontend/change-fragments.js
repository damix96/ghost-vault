import { escapeHtml } from './utils.js';
import { ContextWindow } from './context-window.js';

export class ChangeFragments {
  static empty = text => `<div class="app-exchange-empty"><p>${escapeHtml(text)}</p><button type="button" class="app-text-button" data-content-mode="full">Показать полный текст</button></div>`;

  static ellipsis = () => '<span class="app-fragment-cut" aria-label="Часть поля скрыта">…</span>';

  static windows = (value, matches) => {
    const windows = [];
    for (const match of matches) {
      const { start, end } = ContextWindow.around(value, match.start, match.end, 100);
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
    const fragments = selected.map(({ start, end }, index) => (index || start ? ChangeFragments.ellipsis() : '') + decorate(value.slice(start, end), start, end)).join('') + (selected.at(-1)?.end < value.length ? ChangeFragments.ellipsis() : '');
    const toggle = truncated ? `<button type="button" class="app-text-button app-context-toggle" data-context-toggle="${escapeHtml(path)}" aria-expanded="${full}">${full ? 'Свернуть до мест замен' : 'Показать поле целиком'}</button>` : '';
    return '<div class="app-change-fragments"><div class="app-change-fragment"><div class="app-change-text">' + fragments + '</div></div></div>' + toggle;
  };
}
