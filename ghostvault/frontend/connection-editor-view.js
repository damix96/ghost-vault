import { Ui } from './ui-components.js';
import { ClientInstructions } from './client-instructions.js';

export class ConnectionEditorView {
  static shell = () => '<gv-dialog id="connectionSettingsDialog" heading="Соединение"></gv-dialog>';

  static content = (route, mode) => {
    const target = Ui.field('connectionSettingsTarget', 'URL сервиса', route.upstreamUrl || '', 'type="url" required', 'Куда GhostVault отправит запросы. Например: https://api.anthropic.com для Claude, http://localhost:11434 для Ollama.');
    const name = Ui.field('connectionSettingsName', 'Название соединения', route.name, 'required', 'Чтобы различать соединения во вкладках. Например «Работа» и «Личное».');
    const form = `<form id="connectionSettingsForm" novalidate><gv-stack>${name}${target}${Ui.feedback('connectionSettingsError')}${Ui.submit('Сохранить')}</gv-stack></form>`;
    const actions = '<div class="app-inline-actions">' + (route.isCustom ? Ui.button('Удалить соединение', 'route-delete', [route.id], true, '', 'compact') : '') + '</div>';
    const content = mode === 'settings' ? form + actions : '<p>' + ClientInstructions.intro(route) + '</p>' + ClientInstructions.render(route) + '<div hidden>' + form + '</div>';
    return '<gv-stack>' + content + Ui.feedback('connectionCopyStatus', 'success') + Ui.feedback('connectionSettingsStatus', 'info') + '<gv-action label="Закрыть" data-settings-close></gv-action></gv-stack>';
  };
}
