import { OverviewView } from './overview-view.js';
import { LatestCallView } from './latest-call-view.js';
import { Ui } from './ui-components.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { DisclosureState } from './disclosure-state.js';
import { ReadingPosition } from './reading-position.js';
import { TimelineNavigation } from './timeline-navigation.js';


export class Overview {
  sessions = [];
  routes = [];
  selectedSession = null;
  step = null;
  pending = new Map();
  results = new Map();
  mode = 'masked';
  contentMode = 'changes';
  query = '';
  live = false;
  refreshing = false;
  signature = '';
  routeSignature = '';
  sessionGeneration = 0;
  pendingCall = null;
  callDetails = new DisclosureState();
  renderGeneration = 0;
  expandedContexts = new Set();

  constructor(app, api) {
    this.app = app;
    this.api = api;
  }

  init = () => {
    document.getElementById('viewOverview').innerHTML = OverviewView.shell();
    document.getElementById('viewOverview').addEventListener('gv-hint-state', event => {
      if (event.detail.pinned) return;
      this.flushConversation();
      this.renderRoutes();
      this.renderSessions();
    });
    document.addEventListener('selectionchange', this.flushConversation);
    document.getElementById('sessionSearch').addEventListener('input', event => { this.query = event.target.value; this.renderSessions(); });
    document.getElementById('overviewSessionList').addEventListener('click', event => {
      const button = event.target.closest('[data-session-id]');
      if (button) this.selectSession(button.dataset.sessionId);
    });
    document.getElementById('overviewConversation').addEventListener('click', event => {
      const edge = event.target.closest('[data-timeline-edge]')?.dataset.timelineEdge;
      if (edge) TimelineNavigation.navigate(document.getElementById('overviewConversation'), edge);
      const button = event.target.closest('[data-content-mode]');
      if (button) {
        this.contentMode = button.dataset.contentMode;
        HintLifecycle.hide(document.getElementById('overviewConversation'));
        this.renderConversation(true);
        document.querySelector(`[data-content-mode="${this.contentMode}"]`)?.focus({ preventScroll: true });
      }
      const context = event.target.closest('[data-context-toggle]');
      if (context) {
        const key = context.dataset.contextToggle;
        this.expandedContexts.has(key) ? this.expandedContexts.delete(key) : this.expandedContexts.add(key);
        this.renderConversation(true);
        [...document.querySelectorAll('[data-context-toggle]')].find(button => button.dataset.contextToggle === key)?.focus({ preventScroll: true });
      }
    });
    document.getElementById('overviewConversation').addEventListener('change', event => {
      if (event.target.id !== 'messageOrder') return;
      this.app.preferences.set('order', event.target.value);
      document.getElementById('messageOrder')?.focus({ preventScroll: true });
    });
    document.getElementById('overviewConversation').addEventListener('gv-activate', event => {
      const mode = event.target.closest('[data-call-mode]')?.dataset.callMode;
      if (!mode || mode === this.mode) return;
      HintLifecycle.hide(document.getElementById('overviewConversation'));
      this.mode = mode;
      this.renderConversation(true);
      document.querySelector(`[data-call-mode="${mode}"]`)?.focus({ preventScroll: true });
    });
    this.renderConversation();
  };

  setLive = connected => {
    this.live = connected;
    document.getElementById('liveStreamText').textContent = connected ? 'События подключены' : 'Переподключаемся';
    document.getElementById('liveStreamDot').classList.toggle('app-offline', !connected);
    this.renderRoutes();
  };

  routeFor = endpoint => {
    let path;
    try { path = new URL(endpoint, 'http://localhost').pathname; } catch { return null; }
    const matches = this.routes.filter(route => {
      try {
        const prefix = route.prefix ? '/' + route.prefix : new URL(route.cliUrl || route.incomingUrl).pathname.replace(/\/$/, '');
        return prefix && (path === prefix || path.startsWith(prefix + '/'));
      } catch { return false; }
    });
    return matches.length === 1 ? matches[0].id : null;
  };

  handleEvent = event => {
    const details = event.details || {};
    const editing = this.app.connections.editor.isOpen();
    if (event.type === 'request_started') this.pending.set(details.transactionId, { started: Date.now(), route: this.routeFor(details.endpoint), session: details.sessionId });
    if (event.type === 'transaction_completed') {
      const route = this.pending.get(details.transactionId)?.route || this.routeFor(details.endpoint);
      this.pending.delete(details.transactionId);
      if (route) this.results.set(route, { status: details.status, timestamp: event.timestamp });
      if (!editing && document.getElementById('overviewStream').dataset.transaction === details.transactionId) document.getElementById('overviewStream').hidden = true;
      this.refresh();
    }
    if (!editing && event.type === 'stream_progress' && details.sessionId === this.selectedSession && this.pending.get(details.transactionId)?.route === this.app.connections.workspace.selected && details.text) {
      const preview = document.getElementById('overviewStream');
      preview.dataset.transaction = details.transactionId;
      preview.hidden = false;
      document.getElementById('overviewStreamText').textContent = details.text;
    }
    if (!editing) {
      this.renderActivity();
      this.renderRoutes();
    }
  };

  selectSession = async id => {
    if (!this.sessions.some(session => session.id === id)) return;
    this.pendingCall = null;
    HintLifecycle.hide(document.getElementById('viewOverview'));
    this.selectedSession = id;
    this.expandedContexts.clear();
    this.sessionGeneration++;
    this.signature = '';
    this.step = null;
    this.renderConversation();
    document.getElementById('overviewStream').hidden = true;
    await this.refresh();
  };

  changeConnection = () => {
    HintLifecycle.hide(document.getElementById('viewOverview'));
    this.sessionGeneration++;
    this.selectedSession = null;
    this.expandedContexts.clear();
    this.pendingCall = null;
    this.step = null;
    this.signature = '';
    this.sessions = [];
    this.query = '';
    document.getElementById('sessionSearch').value = '';
    document.getElementById('overviewStream').hidden = true;
    this.renderSessions();
    this.renderFirstRun();
    this.renderConversation();
    this.refresh();
  };

  renderActivity = () => {
    const recent = [...this.pending.values()].filter(item => item.route === this.app.connections.workspace.selected && Date.now() - item.started < 180000);
    const activity = document.getElementById('overviewActivity');
    activity.hidden = !recent.length;
    activity.textContent = `Выполняется запросов: ${recent.length}`;
  };

  activity = route => {
    const pending = [...this.pending.values()].filter(item => item.route === route.id && Date.now() - item.started < 180000);
    const last = this.results.get(route.id);
    const parts = [];
    if (pending.length) parts.push(this.live ? `Выполняется: ${pending.length}` : 'Обновление недоступно');
    if (last) parts.push(`${last.status >= 400 ? 'Ошибка ' + last.status : last.status ? 'Ответ получен' : 'Результат неизвестен'} · ${new Date(last.timestamp).toLocaleTimeString()}`);
    return parts.join(' · ');
  };

  refresh = async () => {
    if (this.refreshing || this.app.connections.editor.isOpen()) return;
    this.refreshing = true;
    const generation = this.sessionGeneration;
    const errorElement = document.getElementById('overviewError');
    try {
      const [health, sessions, routes] = await Promise.all([this.api.request('/health'), this.api.getSessions(), this.api.getRoutes()]);
      if (generation !== this.sessionGeneration || this.app.connections.editor.isOpen()) return;
      this.routes = routes;
      this.sessions = sessions.filter(session => (session.endpoints || [session.endpoint]).some(endpoint => this.routeFor(endpoint) === this.app.connections.workspace.selected)).sort((a, b) => new Date(b.lastSeen || b.timestamp) - new Date(a.lastSeen || a.timestamp));
      this.renderFirstRun();
      this.app.connections.setRoutes(routes);
      const preview = document.getElementById('overviewStream');
      if (preview.dataset.transaction && !this.pending.has(preview.dataset.transaction)) preview.hidden = true;
      if (!this.sessions.some(session => session.id === this.selectedSession)) this.selectedSession = this.sessions[0]?.id || null;
      const requestedSession = this.selectedSession;
      const steps = requestedSession ? await this.api.getSession(requestedSession) : [];
      if (generation !== this.sessionGeneration || requestedSession !== this.selectedSession || this.app.connections.editor.isOpen()) return;
      const step = steps.filter(item => this.routeFor(item.request?.url) === this.app.connections.workspace.selected).sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0] || null;
      const signature = JSON.stringify([this.selectedSession, step, [...this.app.manualSecrets, ...this.app.autoSecrets].map(secret => [secret.key, secret.realValue])]);
      this.pendingCall = { step, signature, session: requestedSession, generation };
      this.flushConversation();
      this.renderSessions();
      this.renderRoutes();
      this.renderActivity();
      errorElement.hidden = true;
    } catch (error) {
      errorElement.message = 'Не удалось обновить страницу. Показаны последние полученные данные. ' + error.message;
      errorElement.hidden = false;
    } finally {
      this.refreshing = false;
      if (generation !== this.sessionGeneration) queueMicrotask(this.refresh);
    }
  };

  renderFirstRun = () => {
    const empty = this.sessions.length === 0;
    document.getElementById('overviewSessions').hidden = empty;
    document.getElementById('sessionSearch').hidden = false;
    document.getElementById('overviewDialogLayout').classList.toggle('app-no-sessions', empty);
  };

  flushConversation = () => {
    const candidate = this.pendingCall;
    if (!candidate || candidate.session !== this.selectedSession || candidate.generation !== this.sessionGeneration || candidate.signature === this.signature || this.app.connections.editor.isOpen()) return;
    if (window.getSelection()?.toString() || HintLifecycle.pinned(document.getElementById('overviewConversation'))) return;
    this.step = candidate.step;
    this.signature = candidate.signature;
    this.renderConversation(true);
  };

  renderSessions = () => {
    const list = document.getElementById('overviewSessionList');
    if (HintLifecycle.pinned(list)) return;
    const query = this.query.toLowerCase().trim();
    const filtered = this.sessions.filter(session => [session.name, session.id, session.client].some(value => String(value || '').toLowerCase().includes(query)));
    const html = filtered.length ? OverviewView.sessions(filtered, this.selectedSession) : Ui.empty('Сессий по этому запросу нет.');
    if (this.sessionsHtml === html) return;
    const focused = list.contains(document.activeElement);
    const top = list.scrollTop;
    const left = list.scrollLeft;
    list.innerHTML = html;
    list.querySelectorAll('[data-action="overview-session"]').forEach(action => { action.pressed = JSON.parse(action.dataset.args)[0] === this.selectedSession; });
    this.sessionsHtml = html;
    if (focused) [...list.querySelectorAll('[data-session-id]')].find(button => button.dataset.sessionId === this.selectedSession)?.focus();
    list.scrollTop = top;
    list.scrollLeft = left;
  };

  renderRoutes = () => this.app.connections.renderBar();

  renderConversation = (preserveReading = false, priorReading = null) => {
    const container = document.getElementById('overviewConversation');
    const reading = priorReading || (preserveReading ? new ReadingPosition(container) : null);
    const generation = ++this.renderGeneration;
    const position = container.scrollTop;
    this.callDetails.render(container, this.step ? LatestCallView.render(this.step, this.mode, [...this.app.manualSecrets, ...this.app.autoSecrets], this.contentMode, this.selectedSession || '', this.app.preferences, this.expandedContexts) : OverviewView.empty());
    container.querySelectorAll('[data-call-mode]').forEach(action => { action.pressed = action.dataset.callMode === this.mode; });
    container.scrollTop = position;
    if (reading) requestAnimationFrame(() => requestAnimationFrame(() => { if (generation === this.renderGeneration) reading.restore(); }));
  };
}
