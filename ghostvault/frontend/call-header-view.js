import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';

export class CallHeaderView {
  static render = (step, mode, contentMode = 'full', session = '') => {
    const status = step.response?.status;
    const state = status >= 400 ? 'Ошибка запроса' : status ? 'Запрос завершён' : 'Результат не сохранён';
    const result = state + (status ? ' · HTTP ' + status : '') + (step.latencyMs !== undefined ? ' · ' + step.latencyMs + ' мс' : '');
    const moment = RelativeTime.render(step.timestamp);
    return `<header class="app-session-header"><div><h3>Сессия</h3><code class="app-current-session">${escapeHtml(session)}</code></div><div class="app-call-meta"><p>${moment} · ${escapeHtml(step.targetProvider || step.request?.client || 'Сервис модели')}</p>${Ui.badge(result, status >= 400 ? 'error' : '')}</div></header>`;
  };

  static modes = (mode, contentMode) => contentMode === 'changes' ? '<span class="app-source-label">К модели · места замен</span>' : '<div class="app-source-modes" role="group" aria-label="Представление запроса">' + [['original', 'Из приложения'], ['masked', 'К модели']].map(([value, label]) => `<gv-action label="${label}" size="compact" tone="${mode === value ? 'primary' : 'neutral'}" data-call-mode="${value}"></gv-action>`).join('') + '</div>';
}
