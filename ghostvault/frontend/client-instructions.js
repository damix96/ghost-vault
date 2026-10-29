import { ClaudeInstructionsView } from './claude-instructions-view.js';
import { OpenAiInstructionsView } from './openai-instructions-view.js';
import { ZenInstructionsView } from './zen-instructions-view.js';
import { Ui } from './ui-components.js';

export class ClientInstructions {
  static configure = environment => { ZenInstructionsView.pluginPath = environment.zenPlugin; };
  static kind = route => {
    if (route.instructionKind) return route.instructionKind;
    const target = (route.upstreamUrl || route.targetUrl || '').replace(/\/+$/, '');
    const service = { 'https://api.anthropic.com': 'claude', 'https://api.anthropic.com/v1': 'claude', 'https://api.openai.com': 'openai', 'https://api.openai.com/v1': 'openai', 'https://opencode.ai/inference': 'zen', 'https://opencode.ai/inference/v1': 'zen', 'https://opencode.ai/inference/go': 'go', 'http://127.0.0.1:11434': 'openai', 'http://127.0.0.1:11434/v1': 'openai' }[target];
    if (service) return service;
    const value = route.cliUrl || route.incomingUrl;
    const path = URL.canParse(value) ? new URL(value).pathname.replace(/\/$/, '') : '';
    const known = { '/anthropic/v1': 'claude', '/openai/v1': 'openai', '/ollama/v1': 'openai', '/opencode/v1': 'zen', '/opencode-go/v1': 'go' }[path];
    if (route.isCustom) return 'unknown';
    if (path === '/openai/v1' && !['https://api.openai.com', 'https://api.openai.com/v1'].includes(target)) return 'unverified-openai';
    return known || 'unknown';
  };

  static incoming = route => route.cliUrl || route.incomingUrl || '';
  static addressLabel = route => 'CLI → VAULT' + (ClientInstructions.kind(route) === 'claude' ? ' · ANTHROPIC_BASE_URL без /v1' : '');

  static intro = route => ({ claude: 'Claude Code · настройка через файл', openai: 'В поле Base URL вашего приложения:', zen: 'OpenCode 2 · настройка через файл', go: 'OpenCode Go:', 'unverified-openai': 'В поле API URL / Base URL вашего приложения:', unknown: 'В поле API URL / Base URL вашего приложения:' }[ClientInstructions.kind(route)]);

  static command = route => {
    const kind = ClientInstructions.kind(route);
    if (kind === 'claude') return ClaudeInstructionsView.setting(route);
    if (kind === 'openai') return OpenAiInstructionsView.base(route);
    if (kind === 'zen') return ZenInstructionsView.base(route);
    return '';
  };

  static render = route => {
    const kind = ClientInstructions.kind(route);
    if (kind === 'claude') return ClaudeInstructionsView.render(route);
    if (kind === 'openai') return OpenAiInstructionsView.render(route);
    if (kind === 'zen') return ZenInstructionsView.render(route);
    if (kind === 'go') return '<p>Инструкция для OpenCode Go пока недоступна.</p>';
    return Ui.code(ClientInstructions.incoming(route)) + Ui.button('Скопировать адрес', 'route-copy', [route.id, 'incoming']) + '<h3>Подключить в OpenCode 2</h3>' + ZenInstructionsView.locations() + ZenInstructionsView.custom(route) + '<p class="app-help">Ключ берётся из переменной <code>MYOC2_API_KEY</code>.</p>' + Ui.code('MYOC2_API_KEY=ваш_ключ');
  };

  static copyMessage = () => 'Скопировано.';

  static launch = route => ClientInstructions.kind(route) === 'zen' ? 'opencode --standalone' : '';
  static environment = route => ClientInstructions.kind(route) === 'zen' ? ZenInstructionsView.environment(route) : '';
  static nativeConfig = route => ClientInstructions.kind(route) === 'claude' ? ClaudeInstructionsView.config(route) : ClientInstructions.kind(route) === 'zen' ? ZenInstructionsView.nativeConfig(route) : '';
  static customConfig = route => ZenInstructionsView.customConfig(route);
  static pluginConfig = route => ClientInstructions.kind(route) === 'zen' ? ZenInstructionsView.config(route) : '';
}
