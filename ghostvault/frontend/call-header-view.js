import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';

export class CallHeaderView {
  static render = (step, mode, contentMode = 'full') => {
    const status = step.response?.status;
    const state = status >= 400 ? 'Ошибка запроса' : status ? 'Запрос завершён' : 'Результат не сохранён';
    const hints = { original: 'Что приложение отправило в GhostVault, включая секреты.', masked: 'Что GhostVault подготовил для отправки модели: секреты заменены подстановками.' };
    const buttons = ['original', 'masked'].map(value => `<gv-action label="${value === 'original' ? 'Из приложения' : 'К модели'}" tone="${mode === value ? 'primary' : 'neutral'}" data-call-mode="${value}" hint="${escapeHtml(hints[value])}"></gv-action>`).join('');
    const result = state + (status ? ' · HTTP ' + status : '') + (step.latencyMs !== undefined ? ' · ' + step.latencyMs + ' мс' : '');
    const moment = RelativeTime.render(step.timestamp);
    return `<div class="app-call-meta"><div><p>${moment} · ${escapeHtml(step.targetProvider || step.request?.client || 'Сервис модели')}</p></div>${Ui.badge(result, status >= 400 ? 'error' : '')}</div><gv-stack direction="row" gap="small" role="group" aria-label="Представление запроса">${contentMode === 'changes' ? '' : buttons}</gv-stack>`;
  };
}
