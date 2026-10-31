import { Ui } from './ui-components.js';

export class RuleTemplateView {
  static help = 'Необязательно. Например URL_${protocol}_${host}: $1 и ${1} — группы по номеру, $name и ${group_name} — именованные. $$ — знак доллара. Неучаствующая группа станет NA.';

  static notice = 'Захваченные части метки видны модели. Используйте только несекретные группы. Регистр станет верхним, прочие символы — _, префикс до 96 символов; уникальный суффикс добавляется автоматически.';

  static condition = () => '<p class="app-condition"><strong>Захваченные части метки видны модели.</strong>Используйте только несекретные группы.</p>';
  static field = () => Ui.field('patternTemplateInput', 'Шаблон метки', '', 'placeholder="URL_${protocol}_${host}" autocomplete="off"', RuleTemplateView.help) + RuleTemplateView.condition() + Ui.details('Правила формирования метки', '<p class="app-help">' + RuleTemplateView.notice + '</p>', 'template-normalization');
  static editor = () => '<label>Шаблон метки<input name="label_template" class="app-search" placeholder="URL_${protocol}_${host}" aria-describedby="ruleTemplateHelp"></label>' + RuleTemplateView.condition() + '<details class="app-preview-context"><summary>Как составить метку</summary><p id="ruleTemplateHelp" class="app-help">' + RuleTemplateView.help + ' ' + RuleTemplateView.notice + '</p></details>';
}
