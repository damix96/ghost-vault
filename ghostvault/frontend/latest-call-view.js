import { ChangeView } from './change-view.js';
import { Ui } from './ui-components.js';
import { PayloadView } from './payload-view.js';
import { SecretDisplay } from './secret-display.js';
import { CallHeaderView } from './call-header-view.js';
import { CallSecretsView } from './call-secrets-view.js';
import { TimelineNavigation } from './timeline-navigation.js';

export class LatestCallView {
  static render = (step, mode, vaultSecrets = [], contentMode = 'changes', session = '', preferences = {}, expanded = new Set()) => {
    if (!step) return Ui.empty('Запросов пока нет. Подключите своё приложение по инструкции и отправьте из него обычный запрос.');
    const entries = [...new Map([...vaultSecrets, ...(step.interceptedSecrets || [])].map(secret => [secret.alias, secret])).values()];
    const display = new SecretDisplay(entries);
    const order = preferences.order || 'oldest';
    const advanced = preferences.mode !== 'simple';
    const selectedMode = !advanced && contentMode === 'json' ? 'full' : contentMode;
    const viewer = new PayloadView(display, order);
    const sent = PayloadView.parse(step.maskedPrompt);
    const body = mode === 'original' ? PayloadView.parse(step.request?.body) : sent;
    const request = selectedMode === 'changes' ? new ChangeView(display, order, expanded).render(sent) : body === undefined ? Ui.empty('Это представление запроса не сохранено.') : selectedMode === 'json' ? viewer.json(body) : viewer.render(body, 'Запрос', 'request');
    const modes = '<div class="app-view-modes" role="group" aria-label="Просмотр запроса">' + [['changes', 'Места замен'], ['full', 'Полный текст'], ['json', 'JSON']].map(([id, label]) => `<button type="button" class="${id === 'json' ? 'app-technical' : ''}" data-content-mode="${id}" aria-pressed="${selectedMode === id}">${label}</button>`).join('') + '</div>';
    const ordering = '<select id="messageOrder" aria-label="Порядок сообщений"><option value="newest"' + (order === 'newest' ? ' selected' : '') + '>Последние сверху</option><option value="oldest"' + (order === 'oldest' ? ' selected' : '') + '>Последние снизу</option></select>';
    const responseViewer = new PayloadView(display, order, false);
    const response = (step.state === 'active' && step.response?.body === undefined ? Ui.empty('Ответ ещё не получен.') : responseViewer.render(step.response?.body, 'Ответ', 'response')) + (step.response ? viewer.saved(step.response, 'response', 'Сохранённый HTTP-ответ · JSON / RAW') : '');
    const toolbar = `<div class="app-chat-toolbar">${modes}${CallHeaderView.modes(mode, selectedMode)}${ordering}</div>`;
    const requestSection = `<section class="app-request-payload" data-reading-key="request.container" data-timeline-item data-reading-target-id="request" tabindex="-1"><div class="app-chat-messages">${request}${step.request ? viewer.saved(step.request, 'request.http', 'Сохранённый HTTP-запрос') : ''}</div></section>`;
    const responseSection = `<section class="app-final-response" data-reading-key="response.container" data-reading-target-id="response" data-timeline-item tabindex="-1"><header class="app-response-heading"><h3>${Ui.explain('Ответ приложению', 'Сохранённый ответ после восстановления подстановок.')}</h3></header>${response}</section>`;
    return `<div class="app-latest-call">${CallHeaderView.render(step, mode, selectedMode, session)}${TimelineNavigation.render(order)}<div class="app-conversation-grid"><div class="app-chat">${toolbar}${order === 'newest' ? responseSection + requestSection : requestSection + responseSection}</div>${CallSecretsView.render(step, sent, display)}</div></div>`;
  };
}
