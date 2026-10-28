import { ChangeView } from './change-view.js';
import { Ui } from './ui-components.js';
import { PayloadView } from './payload-view.js';
import { SecretDisplay } from './secret-display.js';
import { CallHeaderView } from './call-header-view.js';
import { CallSecretsView } from './call-secrets-view.js';

export class LatestCallView {
  static render = (step, mode, vaultSecrets = [], contentMode = 'changes') => {
    if (!step) return Ui.empty('Запросов пока нет. Подключите своё приложение по инструкции и отправьте из него обычный запрос.');
    const entries = [...new Map([...vaultSecrets, ...(step.interceptedSecrets || [])].map(secret => [secret.key, secret])).values()];
    const display = new SecretDisplay(entries);
    const viewer = new PayloadView(display);
    const sent = PayloadView.parse(step.maskedPrompt);
    const body = mode === 'original' ? PayloadView.parse(step.request?.body) : sent;
    const request = body === undefined ? Ui.empty('Это представление запроса не сохранено.') : viewer.render(body, 'Запрос', 'request') + viewer.saved(body, 'request');
    const response = viewer.render(step.response?.body, 'Ответ', 'response') + (step.response?.body !== undefined ? viewer.saved(step.response.body, 'response') : '');
    return `<gv-stack class="app-latest-call" gap="large">${CallHeaderView.render(step, mode, contentMode)}${CallSecretsView.render(step, sent, display)}<section class="app-request-payload">${modes}${request}</section><section class="app-final-response"><h3>${Ui.explain('Ответ приложению', 'Ответ модели после восстановления секретов: вместо $${<DB_HOST>} снова стоит настоящий адрес.')}</h3>${response}</section></gv-stack>`;
  };
}
