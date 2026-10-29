import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class RulePreview {
  revision = 0;
  timer = null;
  controller = null;
  contexts = new Map();
  state = null;

  constructor(api, host, read) {
    this.api = api;
    this.host = host;
    this.read = read;
    host.innerHTML = '<section class="app-rule-preview" aria-label="Проверка по сессиям"><h3>Совпадения в сессиях</h3><p class="app-help">По одному последнему сохранённому запросу каждой сессии, во всех соединениях. Проверка исходящих полей тем же обработчиком протокола, до применения уже сохранённых секретов.</p><p class="app-help">Исходные запросы проверяются целиком. Результаты загружаются порциями; остальные доступны через «Показать ещё». Правило и секреты не изменяются.</p><p class="app-preview-status" role="status" aria-live="polite"></p><div class="app-preview-results"></div><button type="button" class="app-text-button" data-preview-more hidden>Показать ещё</button></section>';
    this.status = host.querySelector('.app-preview-status');
    this.results = host.querySelector('.app-preview-results');
    this.more = host.querySelector('[data-preview-more]');
    this.more.addEventListener('click', () => this.run(this.revision));
    host.addEventListener('toggle', event => {
      const details = event.target;
      if (!details.open || !details.hasAttribute('data-preview-context')) return;
      details.querySelector('pre').textContent = this.contexts.get(details.dataset.previewContext) || '';
    }, true);
  }

  cancel = () => {
    this.revision++;
    clearTimeout(this.timer);
    this.controller?.abort();
    this.controller = null;
  };

  schedule = () => {
    this.cancel();
    this.results.replaceChildren();
    this.contexts.clear();
    this.state = null;
    this.more.hidden = true;
    this.status.textContent = 'Ожидаем ввод…';
    const revision = this.revision;
    this.timer = setTimeout(() => this.run(revision), 300);
  };

  run = async revision => {
    if (!this.state) this.state = { ...this.read(), snapshot: new Date().toISOString(), offset: 0, matchOffset: 0, shown: 0 };
    const state = this.state;
    if (!state.pattern) { this.status.textContent = 'Введите выражение — найденные строки появятся здесь.'; return; }
    this.controller = new AbortController();
    const signal = this.controller.signal;
    const initialShown = state.shown;
    this.more.hidden = true;
    this.more.disabled = true;
    this.status.textContent = 'Проверяем сохранённые сессии…';
    try {
      while (!signal.aborted) {
        const data = await this.api.request('/api/pattern-preview', { method: 'POST', signal, body: JSON.stringify(state) });
        if (revision !== this.revision || signal.aborted) return;
        const cards = data.results.map(match => {
          const contextId = String(this.contexts.size);
          this.contexts.set(contextId, data.contexts?.[match.path] ?? '');
          return RulePreview.card(match, contextId);
        });
        this.results.insertAdjacentHTML('beforeend', cards.join(''));
        state.shown += data.results.length;
        state.offset = data.next;
        state.matchOffset = data.matchOffset || 0;
        const done = state.offset >= data.total;
        this.status.textContent = `${done ? 'Проверено' : 'Проверка не завершена. Обработано'} сессий: ${state.offset} / ${data.total}. Показано совпадений: ${state.shown}.`;
        if (done) {
          if (!data.total) this.status.textContent = 'Сохранённых запросов сессий пока нет.';
          else if (!state.shown) this.status.textContent += ' В проверенных данных выражение не совпало.';
          break;
        }
        if (!data.scanned) throw new Error('Данные сессий изменились. Измените выражение, чтобы повторить проверку.');
        if (state.shown - initialShown >= 50) { this.more.hidden = false; this.more.textContent = 'Показать ещё'; break; }
      }
    } catch (error) {
      if (revision !== this.revision || signal.aborted) return;
      this.status.textContent = 'Проверка не завершена. ' + error.message;
      this.more.hidden = false;
      this.more.textContent = 'Повторить проверку этой порции';
    } finally {
      if (revision === this.revision) this.more.disabled = false;
    }
  };

  static card = (match, contextId) => {
    const value = String(match.value);
    const excerpt = escapeHtml(value.slice(0, 1024)) + (value.length > 1024 ? '…' : '');
    const matchText = '<p class="app-change-text">' + escapeHtml(match.before) + '<mark>' + excerpt + '</mark>' + escapeHtml(match.after) + '</p>';
    const context = '<details class="app-preview-context"><summary>Расширенный контекст</summary><p class="app-change-text">' + escapeHtml(match.contextBefore ?? match.before) + '<mark>' + excerpt + '</mark>' + escapeHtml(match.contextAfter ?? match.after) + '</p></details>';
    const fullContext = '<details class="app-preview-context" data-preview-context="' + contextId + '"><summary>Полный контекст поля</summary><pre class="app-code"></pre></details>';
    const exact = value.length > 1024 ? '<p class="app-help">Совпадение длинное. Полное значение:</p>' + Ui.value(value, 'preview:' + match.transaction + ':' + match.path, 'Полное совпадение') : '';
    return '<article class="app-preview-match"><header><strong>' + escapeHtml(match.client || 'Сессия') + '</strong><code>' + escapeHtml(match.session) + '</code></header><p class="app-help">' + escapeHtml(match.endpoint) + ' · ' + escapeHtml(match.path) + (match.role ? ' · ' + escapeHtml(match.role) : '') + '</p>' + matchText + exact + context + fullContext + '</article>';
  };
}
