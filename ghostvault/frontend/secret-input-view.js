import { Ui } from './ui-components.js';
import { escapeHtml } from './utils.js';

export class SecretInputView {
  static shell = () => `<header class="app-header"><a href="/#secrets" class="app-brand">GhostVault</a></header><main class="app-secret-input-page"><gv-page id="secretInputPage" heading="Секретные значения" description="Введите значения на этом компьютере."><gv-stack gap="large">${Ui.feedback('secretInputStatus', 'loading')}<form id="secretInputForm" novalidate autocomplete="off"><gv-stack gap="large">${Ui.feedback('secretInputError')}<div id="secretInputRows"></div><gv-action id="secretInputAdd" label="Добавить переменную"></gv-action><p id="secretInputExplanation" class="app-help">Значения будут сохранены в защищённом хранилище. После сохранения они не отображаются в списке переменных.</p><div class="app-form-actions"><gv-action id="secretInputCancel" label="Отменить"></gv-action>${Ui.submit('Сохранить значения')}</div></gv-stack></form><div id="secretInputResult" hidden tabindex="-1"></div></gv-stack></gv-page></main>`;

  static result = (heading, text, restartUrl = '') => {
    const link = (restartUrl ? '<p><a href="' + escapeHtml(restartUrl) + '">Открыть новую форму</a></p>' : '') + '<a href="/#secrets">Открыть переменные</a>';
    return Ui.panel(heading, '<p class="app-help">' + escapeHtml(text) + '</p>' + link);
  };
}
