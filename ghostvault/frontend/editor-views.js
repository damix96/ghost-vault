import { Ui } from './ui-components.js';

export class EditorViews {
  static keyDescription = 'Например, для имени DB_HOST модель увидит $${<DB_HOST>} вместо секрета.';
  static shell = () => EditorViews.secret() + EditorViews.pattern();
  static secret = () => {
    const key = Ui.field('modalKeyInput', 'Имя подстановки', '', 'required placeholder="DB_HOST" autocomplete="off"', EditorViews.keyDescription);
    const value = Ui.field('modalValInput', 'Секретное значение', '', 'type="textarea" rows="3" required placeholder="db.internal.example"', 'Вставьте текст, который нужно скрывать от модели. Например адрес базы db.internal.example.');
    const description = Ui.field('modalDescInput', 'Описание', '', 'placeholder="Для чего используется этот секрет"');
    const preview = '<p class="app-help">В запросе: <code id="modalPreviewToken">$${&lt;KEY&gt;}</code></p>';
    const help = '<p class="app-help">Секрет хранится на этом компьютере без шифрования.</p>';
    const actions = '<div class="app-form-actions"><gv-action id="cancelModalBtn" label="Закрыть"></gv-action>' + Ui.submit('Сохранить секрет') + '</div>';
    return `<gv-dialog id="secretModal" heading="Добавить секрет"><form id="secretForm" novalidate><gv-stack>${Ui.feedback('secretFormError')}${key}${value}${Ui.details('Описание', description, 'secret-description')}${preview}${help}<p id="secretSaveEffect" class="app-help" hidden></p>${actions}</gv-stack></form></gv-dialog>`;
  };
  static pattern = () => {
    const name = Ui.field('patternNameInput', 'Название', '', 'required placeholder="Токены моей системы"');
    const regex = Ui.field('patternRegexInput', 'Регулярное выражение', '', 'required placeholder="DEMO_[A-Z0-9]{8}" autocomplete="off"', 'Например DEMO_[A-Z0-9]{8} найдёт DEMO_AB12CD34.');
    const details = ('<p>Регистр не важен: DEMO и demo совпадут. Совпадения короче четырёх символов пропускаются. Пробелы по краям убираются.</p><p>Введите DEMO_[A-Z0-9]{8}, без / в начале и конце.</p>');
    const type = Ui.field('patternTypeInput', 'Метка найденных секретов', '', 'placeholder="custom"', 'Например billing: найденные этим правилом секреты получат имена AUTO_BILLING_…');
    const actions = '<div class="app-form-actions"><gv-action id="cancelPatternModalBtn" label="Закрыть"></gv-action>' + Ui.submit('Создать правило') + '</div>';
    return `<gv-dialog id="patternModal" heading="Добавить правило"><form id="patternForm" novalidate><gv-stack>${Ui.feedback('patternFormError')}${name}${regex}${details}${type}<p class="app-help">Поиск включится для новых запросов всех подключений.</p>${actions}</gv-stack></form></gv-dialog>`;
  };
}
