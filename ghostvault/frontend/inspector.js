import { InspectorRenderer } from './inspector-renderer.js';
import { Ui } from './ui-components.js';

export class RequestInspector {
  api = null;
  renderer = new InspectorRenderer();
  sessions = [];
  selectedSessionId = null;
  sessionSteps = [];
  selectedStepIndex = 0;
  stepViewModes = new Map();
  refreshing = false;
  selectionGeneration = 0;
  renderSignature = '';

  constructor(api) {
    this.api = api;
  }

  init = async () => {
    this.bindEvents();
    await this.fetchData();
  };

  bindEvents = () => {
    document.getElementById('inspectorRefreshBtn')?.addEventListener('gv-activate', () => this.fetchData());
    document.getElementById('sendTestPingBtn')?.addEventListener('gv-activate', this.handleSendTestPing);
    document.getElementById('clearAllSessionsBtn')?.addEventListener('gv-activate', () => this.handleClearAllSessions());
  };

  fetchData = async () => {
    if (this.refreshing) return;
    this.refreshing = true;
    const generation = this.selectionGeneration;
    try {
      const previousId = this.sessionSteps[this.selectedStepIndex]?.id;
      const followLatest = this.selectedStepIndex === this.sessionSteps.length - 1 || !this.sessionSteps.length;
      const sessions = await this.api.getSessions();
      if (generation !== this.selectionGeneration) return;
      this.sessions = sessions;
      if (!this.sessions.length) {
        this.selectedSessionId = null;
        this.sessionSteps = [];
        this.selectedStepIndex = 0;
        this.renderIfChanged();
        return;
      }
      if (!this.selectedSessionId || !this.sessions.some(s => s.id === this.selectedSessionId)) {
        this.selectedSessionId = this.sessions[0].id;
      }
      const requestedSession = this.selectedSessionId;
      const steps = await this.api.getSession(requestedSession);
      if (generation !== this.selectionGeneration || requestedSession !== this.selectedSessionId) return;
      this.sessionSteps = steps;
      const previousIndex = this.sessionSteps.findIndex(step => step.id === previousId);
      this.selectedStepIndex = followLatest || previousIndex < 0 ? Math.max(0, this.sessionSteps.length - 1) : previousIndex;
      Ui.error('inspectorError', '');
      this.renderIfChanged();
    } catch (error) {
      if (generation !== this.selectionGeneration) return;
      const message = document.getElementById('inspectorError');
      if (message) Ui.error('inspectorError', 'Не удалось обновить сессии: ' + error.message);
    } finally {
      this.refreshing = false;
      if (generation !== this.selectionGeneration) queueMicrotask(this.fetchData);
    }
  };

  selectSession = async sessionId => {
    const generation = ++this.selectionGeneration;
    this.selectedSessionId = sessionId;
    let steps;
    try { steps = await this.api.getSession(sessionId); }
    catch (error) {
      if (generation === this.selectionGeneration) throw error;
      return;
    }
    if (generation !== this.selectionGeneration || sessionId !== this.selectedSessionId) return;
    this.sessionSteps = steps;
    this.selectedStepIndex = Math.max(0, this.sessionSteps.length - 1);
    this.renderIfChanged();
  };

  selectStep = index => {
    this.selectionGeneration++;
    this.selectedStepIndex = Math.max(0, Math.min(index, this.sessionSteps.length - 1));
    this.renderIfChanged();
  };

  setOutboundMode = (stepId, mode) => {
    this.stepViewModes.set(stepId, mode);
    this.renderStepView();
  };

  handleDeleteSession = async id => {
    if (!id) return;
    try {
      await this.api.deleteSession(id);
      this.sessions = this.sessions.filter(s => s.id !== id);
      this.selectedSessionId = this.sessions.some(session => session.id === this.selectedSessionId) ? this.selectedSessionId : this.sessions[0]?.id || null;
      if (this.selectedSessionId) {
        await this.selectSession(this.selectedSessionId);
      } else {
        this.selectionGeneration++;
        this.sessionSteps = [];
        this.selectedStepIndex = 0;
      }
      this.renderIfChanged();
      window.app?.showToast('Сессия удалена');
    } catch {
      window.app?.showToast('Не удалось удалить сессию');
    }
  };

  handleClearAllSessions = async () => {
    try {
      await this.api.clearAllSessions();
      this.selectionGeneration++;
      this.sessions = [];
      this.selectedSessionId = null;
      this.sessionSteps = [];
      this.selectedStepIndex = 0;
      this.renderIfChanged();
      window.app?.showToast('Все сессии очищены!');
    } catch {
      window.app?.showToast('Не удалось очистить сессии');
    }
  };

  handleSendTestPing = async () => {
    const button = document.getElementById('sendTestPingBtn');
    if (button.busy) return;
    button.busy = true;
    try {
      await this.api.sendTestPing();
      await this.fetchData();
      window.app?.showToast('Локальное демонстрационное событие создано');
    } catch (error) { Ui.error('inspectorError', error.message); }
    finally { button.busy = false; }
  };

  render = () => {
    const emptyState = document.getElementById('inspectorEmptyState');
    const contentArea = document.getElementById('inspectorContentArea');
    if (!this.sessions.length) {
      emptyState?.classList.remove('hidden');
      contentArea?.classList.add('hidden');
      return;
    }
    emptyState?.classList.add('hidden');
    contentArea?.classList.remove('hidden');
    this.renderer.renderSidebar(this.sessions, this.selectedSessionId);
    this.renderHeader();
    this.renderStepView();
  };

  renderIfChanged = () => {
    const signature = JSON.stringify([this.sessions, this.selectedSessionId, this.sessionSteps, this.selectedStepIndex]);
    if (signature === this.renderSignature) return;
    this.render();
    this.renderSignature = signature;
  };

  renderHeader = () => {
    const currentSession = this.sessions.find(s => s.id === this.selectedSessionId) || { id: this.selectedSessionId };
    this.renderer.renderHeader(currentSession, this.sessionSteps, this.selectedStepIndex);
  };

  renderStepView = () => {
    const step = this.sessionSteps[this.selectedStepIndex];
    const stepId = step?.id || 'step-' + this.selectedStepIndex;
    const mode = this.stepViewModes.get(stepId) || 'snippets';
    this.renderer.renderStep(step, this.selectedStepIndex, mode, this.sessionSteps);
  };
}
