import { Ui } from './ui-components.js';

export class ProtectedEditorView {
  static shell = () => {
    const actions = '<div class="app-form-actions"><gv-action id="protectedEditorCancel" label="Отменить"></gv-action>' + Ui.submit('Сохранить секрет') + '</div>';
    const description = Ui.field('protectedDescription', 'Описание', '', 'autocomplete="off"', 'Укажите назначение без секретного значения.');
    const help = '<p id="protectedEditorHelp" class="app-help">Секрет будет храниться с системной защитой. Введённое значение удаляется из формы после сохранения или отмены.</p>';
    return `<gv-dialog id="protectedEditor" heading="Добавить секрет"><form id="protectedEditorForm" novalidate autocomplete="off"><gv-stack gap="large">${Ui.feedback('protectedEditorError')}<div id="protectedEditorRows"></div>${description}${help}${actions}</gv-stack></form></gv-dialog>`;
  };

  static protection = () => `<gv-dialog id="protectExistingDialog" heading="Защитить переменную"><form id="protectExistingForm" novalidate><gv-stack>${Ui.feedback('protectExistingError')}${Ui.field('protectExistingName', 'Имя переменной', '', 'readonly')}<p>Имя, подстановка и текущее значение сохранятся. Значение будет храниться с системной защитой и больше не будет отображаться в списке. Сохранённые прошлые значения этой переменной тоже будут защищены.</p><p class="app-help">В сохранённой диагностике известные вхождения этих значений, включая кодированные формы, заменятся подстановками. События и даты сохранятся.</p><p class="app-help">Прежние внешние копии, экспорты и резервные копии не удаляются. Настройка замены в запросах не меняется.</p><div class="app-form-actions"><gv-action id="protectExistingCancel" label="Отменить"></gv-action>${Ui.submit('Защитить значение')}</div></gv-stack></form></gv-dialog>`;
}
