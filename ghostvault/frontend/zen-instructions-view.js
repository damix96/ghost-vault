import { Ui } from './ui-components.js';

export class ZenInstructionsView {
  static pluginPath = '';
  static base = route => route.cliUrl || route.incomingUrl;
  static config = route => JSON.stringify({ plugins: [{ package: ZenInstructionsView.pluginPath, options: { baseURL: ZenInstructionsView.base(route), nativeTransport: false } }] }, null, 2);
  static nativeConfig = route => JSON.stringify({ providers: { myoc: { canonical: 'opencode', settings: { baseURL: ZenInstructionsView.base(route), apiKey: '{env:MYOC_API_KEY}' }, models: { 'deepseek-v4.1-flash': {} } } } }, null, 2);
  static customConfig = route => JSON.stringify({ providers: { myoc2: { package: '@opencode/ai/providers/openai-compatible', settings: { baseURL: ZenInstructionsView.base(route), apiKey: '{env:MYOC2_API_KEY}' }, models: { YOUR_MODEL_ID: { name: 'Модель вашего сервиса' } } } } }, null, 2);
  static custom = route => '<h3>Свой OpenAI-совместимый сервис</h3>' + Ui.code(ZenInstructionsView.customConfig(route)) + Ui.button('Скопировать JSON', 'route-copy', [route.id, 'customConfig'], true) + '<p class="app-help">Замените <code>YOUR_MODEL_ID</code> на ID модели вашего сервиса. Выберите <code>myoc2/YOUR_MODEL_ID</code> в OpenCode. Для другого формата API нужен соответствующий пакет провайдера.</p>';
  static environment = route => 'GHOSTVAULT_BASE_URL=' + ZenInstructionsView.base(route);
  static locations = () => '<p>Откройте или создайте один из файлов:</p><ul><li>Для всех проектов: <code>~/.config/opencode/opencode.json</code></li><li>Для одного проекта: <code>./opencode.json</code> в корне проекта.</li></ul><p class="app-help"><code>~</code> — домашняя папка пользователя. Вместо <code>.json</code> можно использовать <code>.jsonc</code>.</p>';

  static native = route => ZenInstructionsView.locations() + Ui.code(ZenInstructionsView.nativeConfig(route)) + Ui.button('Скопировать JSON', 'route-copy', [route.id, 'nativeConfig'], false) + '<p class="app-help">Добавьте <code>myoc</code> к вашим провайдерам. Он наследует каталог <code>opencode</code>. Ключ берётся из переменной <code>MYOC_API_KEY</code>. Выберите <code>myoc/deepseek-v4.1-flash</code> в OpenCode. Доступ к модели зависит от аккаунта.</p>';

  static alias = route => {
    const setup = '<p>В выбранный выше файл добавьте:</p>' + Ui.code(ZenInstructionsView.config(route)) + Ui.button('Скопировать JSON', 'route-copy', [route.id, 'pluginConfig'], true);
    const launch = '<p>Запустите:</p>' + Ui.code('opencode --standalone') + Ui.button('Скопировать команду', 'route-copy', [route.id, 'launch'], true) + '<p>В <code>/models</code> выберите модель из <code>ghostvault-zen</code>.</p>';
    const free = '<p>Для бесплатных моделей укажите <code>nativeTransport: true</code>. Они работают через дополнение; одного Base URL недостаточно. Доступность зависит от сервиса.</p>';
    return setup + launch + free;
  };

  static render = route => {
    const environment = '<p>В конфиге замените значение <code>baseURL</code> на <code>{env:GHOSTVAULT_BASE_URL}</code>, затем задайте переменную:</p>' + Ui.code('MYOC_API_KEY=ваш_ключ\nMYOC2_API_KEY=ваш_ключ\n' + ZenInstructionsView.environment(route)) + Ui.button('Скопировать переменную', 'route-copy', [route.id, 'environment'], true);
    const sources = '<p class="app-help"><a href="https://opencode.ai/v2/docs/config#locations" target="_blank" rel="noreferrer">Расположение файлов</a> · <a href="https://opencode.ai/v2/docs/providers#endpoint" target="_blank" rel="noreferrer">Настройка baseURL</a></p>';
    return ZenInstructionsView.native(route) + ZenInstructionsView.custom(route) + sources + Ui.details('Через переменную окружения', environment, 'zen-env.' + route.id) + Ui.details('Через дополнение GhostVault', ZenInstructionsView.alias(route), 'zen-plugin.' + route.id);
  };
}
