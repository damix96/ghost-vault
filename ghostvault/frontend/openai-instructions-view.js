import { Ui } from './ui-components.js';

export class OpenAiInstructionsView {
  static base = route => (route.cliUrl || route.incomingUrl || '').replace(/\/+$/, '');

  static render = route => {
    const primary = Ui.code(OpenAiInstructionsView.base(route)) + Ui.button('Скопировать Base URL', 'route-copy', [route.id, 'command'], false);
    return primary;
  };
}
