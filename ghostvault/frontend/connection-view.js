import { Ui } from './ui-components.js';
import { escapeHtml } from './utils.js';
import { ClientInstructions } from './client-instructions.js';
import { ConnectionPresets } from './connection-presets.js';

export class ConnectionView {
  static bar = (routes, selected) => {
    const route = routes.find(item => item.id === selected) || routes[0];
    if (!route) return '<section class="app-connection-bar"><div><strong>Соединение ещё не добавлено</strong><p class="app-help">Укажите сервис, которому приложение отправляет запросы.</p></div>' + Ui.button('Добавить соединение', 'route-create', [], false) + '</section>';
    const tabs = '<div class="app-connection-tabs" role="tablist" aria-label="Соединения">' + routes.map(item => `<button type="button" role="tab" id="connection-tab-${escapeHtml(item.id)}" data-connection-id="${escapeHtml(item.id)}" aria-selected="${route.id === item.id}" aria-controls="connectionPanel" tabindex="${route.id === item.id ? '0' : '-1'}">${escapeHtml(item.name)}</button>`).join('') + '</div>';
    const panel = `role="tabpanel" aria-labelledby="connection-tab-${escapeHtml(route.id)}"`;
    const header = '<div class="app-connections-header">' + tabs + '<button type="button" class="app-connection-add" data-connection-add aria-label="Добавить соединение" title="Добавить соединение">+</button></div>';
    return `${header}<section id="connectionPanel" class="app-connection-bar" ${panel}><div class="app-connection-identity"><code class="app-connection-address">${escapeHtml(ClientInstructions.incoming(route))}</code>${Ui.copy(ClientInstructions.incoming(route), 'Копировать адрес')}</div><div class="app-inline-actions">${Ui.button('Как подключить', 'route-open', [route.id], true, '', 'compact')}${Ui.button('Настройки', 'route-settings', [route.id], true, '', 'compact')}</div></section>`;
  };

  static create = () => {
    const templates = ConnectionPresets.entries.map(route => Ui.button(route.name, 'route-template', [route.id], true, '', 'compact')).join('');
    const target = Ui.field('connectionUpstream', 'URL сервиса', '', 'type="url" required placeholder="https://api.anthropic.com"', 'Куда GhostVault отправит запросы. Например: https://api.anthropic.com для Claude, http://localhost:11434 для Ollama.');
    const name = Ui.field('connectionName', 'Название', '', 'required placeholder="opencode"');
    return `<gv-dialog id="connectionCreateDialog" heading="Добавить соединение"><gv-stack><form id="connectionForm" novalidate><gv-stack><div><p class="app-help">Заполнить из пресета</p><div class="app-template-grid">${templates}</div></div>${Ui.feedback('connectionFormError')}${name}${target}<div class="app-form-actions">${Ui.button('Закрыть', 'route-create-cancel')}${Ui.submit('Добавить')}</div></gv-stack></form></gv-stack></gv-dialog>`;
  };
}
