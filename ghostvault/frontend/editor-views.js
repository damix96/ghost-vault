import { Ui } from './ui-components.js';
import { RuleTemplateView } from './rule-template-view.js';

export class EditorViews {
  static keyDescription = 'Например, для имени DB_HOST модель увидит $${<DB_HOST>} вместо секрета.';
  static shell = () => EditorViews.secret() + EditorViews.pattern();
  static secret = () => {
    const key = Ui.field('modalKeyInput', 'Имя подстановки', '', 'required placeholder="DB_HOST" autocomplete="off"', EditorViews.keyDescription);
    const value = Ui.field('modalValInput', 'Секретное значение', '', 'type="textarea" rows="3" required placeholder="db.internal.example"', 'Вставьте текст, который нужно скрывать от модели. Например адрес базы db.internal.example.');
    const description = Ui.field('modalDescInput', 'Описание', '', 'placeholder="Для чего используется этот секрет"');
    const preview = '<p class="app-help"><span id="modalPreviewLabel">В запросе</span>: <code id="modalPreviewToken">$${&lt;KEY&gt;}</code></p>';
    const help = '<p class="app-help">Секрет хранится на этом компьютере без шифрования.</p>';
    const actions = '<div class="app-form-actions"><gv-action id="cancelModalBtn" label="Закрыть"></gv-action>' + Ui.submit('Сохранить секрет') + '</div>';
    return `<gv-dialog id="secretModal" heading="Добавить секрет"><form id="secretForm" novalidate><gv-stack>${Ui.feedback('secretFormError')}${key}${value}${description}${preview}${help}<p id="secretSaveEffect" class="app-help"></p>${actions}</gv-stack></form></gv-dialog>`;
  };
  static pattern = () => {
    const name = Ui.field('patternNameInput', 'Название', '', 'required placeholder="Токены моей системы"');
    const regex = Ui.field('patternRegexInput', 'Регулярное выражение', '', 'type="textarea" rows="6" required placeholder="DEMO_[A-Z0-9]{8}" autocomplete="off"', 'Например DEMO_[A-Z0-9]{8} найдёт DEMO_AB12CD34.');
    const details = '<p class="app-help">Исходное выражение без /…/ и флагов.</p>' + Ui.details('Как обрабатываются совпадения', '<p>Поиск использует gi: все полные совпадения без учёта регистра. Совпадения короче четырёх символов пропускаются. Пробелы по краям найденного значения убираются.</p>', 'pattern-semantics');
    const type = Ui.field('patternTypeInput', 'Метка найденных секретов', '', 'placeholder="custom"', 'Например billing: найденные этим правилом секреты получат имена AUTO_BILLING_…');
    const actions = '<div class="app-form-actions"><gv-action id="cancelPatternModalBtn" label="Закрыть"></gv-action>' + Ui.submit('Создать правило') + '</div>';
    return `<gv-dialog id="patternModal" heading="Добавить правило"><form id="patternForm" novalidate><gv-stack>${Ui.feedback('patternFormError')}${name}${regex}${details}${type}${RuleTemplateView.field()}<p class="app-help">Поиск включится для новых запросов всех подключений.</p>${actions}</gv-stack></form></gv-dialog>`;
  };
}
