import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class RulePreview {
  revision = 0;
  timer = null;
  controller = null;
  contexts = new Map();
  groups = new Map();
  notices = new Set();
  state = null;

  constructor(api, host, read) {
    this.api = api;
    this.host = host;
    this.read = read;
    host.innerHTML = '<section class="app-rule-preview" aria-label="Проверка по сессиям"><h3>Совпадения в сессиях</h3><p class="app-help">Проверка черновика. Правило и секреты не изменяются.</p><details class="app-preview-context"><summary>Какие данные проверяются</summary><p class="app-help">По одному последнему начатому запросу каждой сессии в памяти текущего процесса, во всех подключениях. Исходящие поля проверяются целиком обработчиком протокола, до применения сохранённых секретов. После перезапуска сессии исчезают. Результаты загружаются порциями; остальные доступны через «Показать ещё».</p></details><p class="app-preview-status" role="status" aria-live="polite"></p><div class="app-preview-results"></div><button type="button" class="app-text-button" data-preview-more hidden>Показать ещё</button></section>';
    this.status = host.querySelector('.app-preview-status');
    this.notice = document.createElement('p');
    this.notice.className = 'app-help app-preview-notice';
    this.status.after(this.notice);
    this.results = host.querySelector('.app-preview-results');
    this.more = host.querySelector('[data-preview-more]');
    this.more.addEventListener('click', () => this.state ? this.run(this.revision) : this.schedule());
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
    this.groups.clear();
    this.notices.clear();
    this.notice.textContent = '';
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
        state.revision = data.revision;
        for (const match of data.results) {
          if (match.labelNotice) this.notices.add(match.labelNotice);
          const contextId = String(this.contexts.size);
          this.contexts.set(contextId, data.contexts?.[match.path] ?? '');
          const groupKey = JSON.stringify([match.transaction, match.session, match.path]);
          if (!this.groups.has(groupKey)) {
            const group = document.createElement('section');
            group.className = 'app-preview-group';
            group.innerHTML = '<header><strong>' + escapeHtml(match.client || 'Сессия') + '</strong><code>' + escapeHtml(match.session) + '</code></header><p class="app-help">' + escapeHtml(match.endpoint) + ' · ' + escapeHtml(match.path) + (match.role ? ' · ' + escapeHtml(match.role) : '') + '</p>';
            this.results.append(group);
            this.groups.set(groupKey, group);
          }
          this.groups.get(groupKey).insertAdjacentHTML('beforeend', RulePreview.card(match, contextId));
        }
        this.notice.textContent = [...this.notices].join(' ');
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
      this.more.textContent = error.status === 409 ? 'Начать проверку заново' : 'Повторить проверку этой порции';
      if (error.status === 409) {
        this.state = null;
        this.results.replaceChildren();
        this.contexts.clear();
        this.groups.clear();
        this.notices.clear();
        this.notice.textContent = '';
      }
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
    const label = match.alias ? '<div class="app-preview-alias"><span>' + (match.existing ? 'Сохранённая подстановка' : 'Пример подстановки') + '</span><code>' + escapeHtml(match.alias) + '</code></div>' : '';
    return '<article class="app-preview-match"><div class="app-preview-value"><code>' + excerpt + '</code></div>' + label + '<details class="app-preview-context"><summary>Контекст совпадения</summary>' + matchText + exact + context + fullContext + '</details></article>';
  };
}
