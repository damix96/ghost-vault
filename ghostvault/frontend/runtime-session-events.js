import { HintLifecycle } from './hint-lifecycle.js';

export class RuntimeSessionEvents {
  static handle = (overview, event) => {
    const details = event.details || {};
    if (event.type === 'request_started') {
      overview.sessionGeneration++;
      overview.pendingCall = null;
      if (details.sessionId === overview.selectedSession) document.getElementById('overviewStream').hidden = true;
      overview.refresh();
    }
    if (!['session_removed', 'sessions_cleared'].includes(event.type)) return;
    const all = event.type === 'sessions_cleared';
    overview.sessionGeneration++;
    overview.pendingCall = null;
    for (const [id, item] of overview.pending) if (all || item.session === details.sessionId) overview.pending.delete(id);
    if (all) overview.runtimeActivity.clear();
    overview.sessions = all ? [] : overview.sessions.filter(session => session.id !== details.sessionId);
    if (all || overview.selectedSession === details.sessionId) {
      if (details.reason === 'budget') overview.app.showToast('Сессия удалена из памяти: достигнут лимит хранения текущих вызовов.');
      overview.selectedSession = null;
      overview.step = null;
      overview.signature = '';
      overview.expandedContexts.clear();
      overview.callDetails.opened.clear();
      HintLifecycle.hide(document.getElementById('viewOverview'));
      document.getElementById('overviewStream').hidden = true;
      document.getElementById('overviewStreamText').textContent = '';
      overview.renderConversation();
    }
    overview.renderSessions();
    overview.renderFirstRun();
    overview.refresh();
  };
}
