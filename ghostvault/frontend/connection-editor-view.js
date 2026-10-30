import { Ui } from './ui-components.js';
import { ClientInstructions } from './client-instructions.js';

export class ConnectionEditorView {
  static shell = () => '<gv-dialog id="connectionSettingsDialog" heading="Соединение"></gv-dialog>';

  static content = (route, mode) => {
    const target = Ui.field('connectionSettingsTarget', 'URL сервиса', route.upstreamUrl || '', 'type="url" required', 'Куда GhostVault отправит запросы. Например: https://api.anthropic.com для Claude, http://localhost:11434 для Ollama.');
    const name = Ui.field('connectionSettingsName', 'Название соединения', route.name, 'required', 'Чтобы различать соединения во вкладках. Например «Работа» и «Личное».');
    const close = '<gv-action label="Закрыть" data-settings-close></gv-action>';
    const remove = route.isCustom ? '<span class="app-delete-connection">' + Ui.button('Удалить соединение', 'route-delete', [route.id], true, '', 'compact') + '</span>' : '';
    const form = `<form id="connectionSettingsForm" novalidate><gv-stack>${name}${target}${Ui.feedback('connectionSettingsError')}${Ui.feedback('connectionSettingsStatus', 'info')}<div class="app-settings-footer">${remove}${close}${Ui.submit('Сохранить')}</div></gv-stack></form>`;
    const content = mode === 'settings' ? form : '<p>' + ClientInstructions.intro(route) + '</p>' + ClientInstructions.render(route) + '<div hidden>' + form.replace(' data-settings-close', '') + '</div>' + close;
    return '<gv-stack>' + content + Ui.feedback('connectionCopyStatus', 'success') + '</gv-stack>';
  };
}
