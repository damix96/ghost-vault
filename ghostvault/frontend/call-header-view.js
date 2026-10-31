import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';

export class CallHeaderView {
  static render = (step, mode, contentMode = 'full', session = '') => {
    const status = step.response?.status;
    const state = step.state === 'active' ? 'Выполняется запрос' : status >= 400 ? 'Ошибка запроса' : status ? 'Запрос завершён' : 'Результат не сохранён';
    const result = state + (status ? ' · HTTP ' + status : '') + (step.latencyMs !== undefined ? ' · ' + step.latencyMs + ' мс' : '');
    const moment = RelativeTime.render(step.timestamp);
    return `<header class="app-session-header"><div><h3>Сессия</h3><div class="app-session-identity"><code class="app-current-session">${escapeHtml(session)}</code>${Ui.copy(session, 'Копировать ID сессии')}</div><p class="app-session-scope">В памяти один вызов; сообщения — из его запроса. После перезапуска сессия исчезнет.</p></div><div class="app-call-meta"><p>${moment}</p>${Ui.badge(result, status >= 400 ? 'error' : '')}<span class="app-technical app-help">${step.targetProvider ? 'Сервис: ' + escapeHtml(step.targetProvider) : step.request?.client ? 'Приложение: ' + escapeHtml(step.request.client) : ''}</span></div></header>`;
  };

  static modes = (mode, contentMode) => contentMode === 'changes' ? '<span class="app-source-label">К модели · места замен</span>' : '<div class="app-source-modes" role="group" aria-label="Представление запроса">' + [['original', 'Из приложения'], ['masked', 'К модели']].map(([value, label]) => `<gv-action label="${label}" size="compact" tone="${mode === value ? 'primary' : 'neutral'}" data-call-mode="${value}"></gv-action>`).join('') + '</div>';
}
