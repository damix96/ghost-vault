import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class LiveFeed {
  api = null;
  events = [];
  filterClient = 'all';
  filterDirection = 'all';
  searchQuery = '';
  expandedEventId = null;
  eventIds = new Set();

  constructor(api) {
    this.api = api;
  }

  init = () => {
    this.bindEvents();
    this.render();
  };

  bindEvents = () => {
    document.getElementById('feedClientFilter')?.addEventListener('gv-input', e => {
      this.filterClient = e.detail.value;
      this.render();
    });
    document.getElementById('feedDirectionFilter')?.addEventListener('gv-input', e => {
      this.filterDirection = e.detail.value;
      this.render();
    });
    document.getElementById('feedSearchInput')?.addEventListener('gv-input', e => {
      this.searchQuery = e.detail.value.toLowerCase();
      this.render();
    });
    document.getElementById('clearFeedBtn')?.addEventListener('gv-activate', () => {
      this.events = [];
      this.eventIds.clear();
      this.render();
    });
  };

  addEvent = event => {
    if (['request_started', 'stream_progress'].includes(event.type) || this.eventIds.has(event.id)) return;
    if (event.id) this.eventIds.add(event.id);
    const details = event.details || {};
    this.events.unshift({
      id: event.id || `ev-${Date.now()}`,
      timestamp: event.timestamp ? new Date(event.timestamp).toLocaleTimeString() : new Date().toLocaleTimeString(),
      client: event.client || details.client || 'Неизвестное приложение',
      direction: event.type?.includes('unmasked') ? 'inbound' : (event.direction || (event.type?.includes('masked') ? 'outbound' : 'unknown')),
      endpoint: event.endpoint || details.endpoint || event.type || 'Событие',
      status: event.status || details.status || '—',
      tokens: event.tokens || [details.alias || event.alias].filter(Boolean),
      originalUrl: details.realValue || event.rawUrl || event.originalUrl || '',
      replacement: details.alias || event.alias || event.replacement || '',
      payloadSummary: event.payloadSummary || JSON.stringify(details || event.payload || {}),
    });
    if (this.events.length > 50) this.eventIds.delete(this.events.pop().id);
    this.render();
  };

  toggleExpand = id => {
    this.expandedEventId = this.expandedEventId === id ? null : id;
    this.render();
  };

  render = () => {
    const container = document.getElementById('liveFeedContainer');
    const countBadge = document.getElementById('feedTotalCount');
    if (!container) return;

    const filtered = this.events.filter(e => {
      const matchClient = this.filterClient === 'all' || e.client.toLowerCase().includes(this.filterClient.toLowerCase());
      const matchDir = this.filterDirection === 'all' || e.direction === this.filterDirection;
      const matchQuery = !this.searchQuery ||
        e.client.toLowerCase().includes(this.searchQuery) ||
        e.endpoint.toLowerCase().includes(this.searchQuery) ||
        e.tokens.some(t => t.toLowerCase().includes(this.searchQuery)) ||
        e.originalUrl.toLowerCase().includes(this.searchQuery);
      return matchClient && matchDir && matchQuery;
    });

    if (countBadge) countBadge.textContent = `${filtered.length} событий`;
    container.innerHTML = filtered.length ? '<gv-stack>' + filtered.map(event => this.eventView(event)).join('') + '</gv-stack>' : Ui.empty(this.events.length ? 'Совпадений нет. Очистите поиск или выберите все события.' : 'Событий в этой вкладке пока нет.');
  };

  eventView = event => {
    const expanded = this.expandedEventId === event.id;
    const summary = Ui.button(expanded ? 'Скрыть подробности' : 'Подробности события', 'feed-expand', [event.id]);
    const direction = { outbound: 'К сервису модели', inbound: 'Ответ приложению' }[event.direction] || 'Событие шлюза';
    const original = Ui.value(event.originalUrl || '', 'event:' + event.id + ':original', 'Исходное значение', true);
    const replacement = Ui.value(event.replacement || event.tokens.join(', '), 'event:' + event.id + ':replacement', 'Подстановка');
    return Ui.panel(`${event.client} · ${direction}`, `<gv-stack><p class="app-help">${escapeHtml(event.timestamp)} · ${escapeHtml(event.endpoint)} · ${escapeHtml(event.status)}</p>${summary}${expanded ? '<gv-grid>' + original + replacement + '</gv-grid>' + Ui.code(event.payloadSummary) : ''}</gv-stack>`);
  };
}
