import { Ui } from './ui-components.js';

export class ClaudeInstructionsView {
  static base = route => route.suffix !== undefined ? (route.cliUrl || route.incomingUrl || '') : (route.cliUrl || route.incomingUrl || '').replace(/\/v1\/?$/, '');
  static setting = route => 'ANTHROPIC_BASE_URL=' + ClaudeInstructionsView.base(route);
  static config = route => JSON.stringify({ env: { ANTHROPIC_BASE_URL: ClaudeInstructionsView.base(route) } }, null, 2);

  static render = route => {
    const paths = '<p>Откройте или создайте файл:</p><ul><li>macOS / Linux: <code>~/.claude/settings.json</code></li><li>Windows: <code>%USERPROFILE%\\.claude\\settings.json</code></li><li>Только для проекта: <code>.claude/settings.local.json</code> в папке проекта.</li></ul>';
    const config = Ui.code(ClaudeInstructionsView.config(route)) + Ui.button('Скопировать JSON', 'route-copy', [route.id, 'nativeConfig'], false);
    const instruction = '<p class="app-help">Добавьте строку в <code>env</code>, сохранив остальные настройки. Перезапустите Claude Code.</p>';
    const environment = Ui.code(ClaudeInstructionsView.setting(route)) + Ui.button('Скопировать переменную', 'route-copy', [route.id, 'command'], true);
    return paths + config + instruction + '<p class="app-help"><a href="https://code.claude.com/docs/en/settings" target="_blank" rel="noreferrer">Расположение файлов в документации Claude Code</a></p>' + Ui.details('Через переменную окружения', environment, 'claude-env.' + route.id);
  };
}
