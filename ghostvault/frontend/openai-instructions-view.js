import { ZenInstructionsView } from './zen-instructions-view.js';
import { Ui } from './ui-components.js';

export class OpenAiInstructionsView {
  static base = route => (route.cliUrl || route.incomingUrl || '').replace(/\/+$/, '');

  static render = route => {
    const primary = Ui.copyCode(OpenAiInstructionsView.base(route), 'Копировать Base URL');
    return '<h3>OpenCode 2</h3>' + ZenInstructionsView.locations() + ZenInstructionsView.custom(route) + '<p class="app-help">Ключ берётся из переменной <code>MYOC2_API_KEY</code>.</p>' + Ui.code('MYOC2_API_KEY=ваш_ключ') + '<h3>Другое приложение</h3><p>Вставьте адрес в поле Base URL:</p>' + primary;
  };
}
