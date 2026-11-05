import { HintLifecycle } from './hint-lifecycle.js';
import { Ui } from './ui-components.js';

export class SecretCache {
  static invalidate = app => {
    HintLifecycle.hide();
    app.clipboard.dispose();
    const overview = app.overview;
    overview.sessionGeneration++;
    overview.renderGeneration++;
    overview.step = null;
    overview.pendingCall = null;
    overview.signature = '';
    overview.sessionsHtml = '';
    overview.sessions = [];
    document.getElementById('overviewSessionList').replaceChildren();
    document.getElementById('overviewConversation').innerHTML = Ui.empty('Обновляем данные после защиты переменной…');
    document.getElementById('overviewStreamText').textContent = '';
    document.getElementById('overviewStream').hidden = true;
    app.feed.events = app.feed.events.map(event => ({ id: event.id, timestamp: event.timestamp, direction: event.direction, status: event.status, client: 'Событие шлюза', endpoint: '', tokens: [], originalUrl: '', replacement: '', payloadSummary: 'Содержимое этой локальной копии очищено после защиты переменной. Сохранённая история доступна на Обзоре.' }));
    app.feed.render();
    [app.ruleEditor.preview, app.modals.rulePreview].filter(Boolean).forEach(preview => {
      preview.cancel();
      preview.results.replaceChildren();
      preview.contexts.clear();
      preview.groups.clear();
      preview.notices.clear();
      preview.notice.textContent = '';
      preview.state = null;
      preview.more.hidden = true;
      preview.status.textContent = 'Данные изменились после защиты переменной. Измените выражение для новой проверки.';
    });
    if (app.ruleEditor.dialog.open) app.ruleEditor.preview.schedule();
    if (document.getElementById('patternModal')?.open) app.modals.rulePreview.schedule();
    overview.refresh();
  };
}
