import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';
import { ClientInstructions } from './client-instructions.js';

export class RouteRowView {
  static headings = () => '<div class="app-route-columns" aria-hidden="true"><span>Получатель запросов</span><span>CLI → VAULT</span><span></span><span>Куда уйдёт запрос</span><span>Последний запрос</span><span></span></div>';

  static render = (route, state, actions, outgoing) => {
    const name = `<div class="app-route-name"><strong>${escapeHtml(route.name || route.title || route.id)}</strong><small>${route.isCustom ? 'Добавлено вами' : 'Готовый вариант'}</small></div>`;
    const incoming = `<code class="app-route-address"><span class="sr-only">CLI → VAULT: </span><span class="app-mobile-label" aria-hidden="true">CLI → VAULT</span>${escapeHtml(ClientInstructions.incoming(route))}</code>`;
    const target = `<code class="app-route-address"><span class="sr-only">Сервис получит запрос по адресу: </span><span class="app-mobile-label" aria-hidden="true">Куда уйдёт запрос</span>${escapeHtml(outgoing)}</code>`;
    const status = `<span class="app-route-state">${escapeHtml(state || 'Запросов пока нет')}</span>`;
    return `<div class="app-route-row" role="listitem">${name}${incoming}<span class="app-route-arrow" aria-hidden="true">→</span>${target}${status}<gv-stack class="app-route-actions" direction="row" gap="small">${Ui.button('Как подключить', 'route-open', [route.id], true, '', 'compact')}${actions}</gv-stack></div>`;
  };
}
