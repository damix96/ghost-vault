import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class RulesView {
  static names = { 'internal-urls': 'Внутренние адреса', 'database-uri': 'Адреса баз данных', 'private-ip': 'Частные IP-адреса', 'any-ip': 'Любой IP-адрес', 'api-keys': 'Ключи доступа' };
  static examples = { 'internal-urls': ['https://wiki.internal', 'https://portal.corp'], 'database-uri': ['postgres://user:pass@db/app', 'redis://cache:6379'], 'private-ip': ['192.168.1.10', '10.0.0.5:8080'], 'any-ip': ['8.8.8.8', '192.168.1.10', '2001:db8::1', '::1'], 'api-keys': ['sk-…', 'ghp_…', 'Bearer …'] };
  static shell = () => Ui.page('Правила', 'Что автоматически скрывать в запросах к модели.', Ui.feedback('rulesError') + Ui.field('rulesSearch', 'Найти правило', '', 'type="search" placeholder="Название или выражение"') + '<div id="rulesList" class="app-rules-list"></div>', Ui.button('Добавить правило', 'rule-create', [], false));

  static row = pattern => {
    const enabled = pattern.enabled === 1 || pattern.enabled === true;
    const title = RulesView.names[pattern.name] || pattern.name;
    const description = { 'internal-urls': 'Адреса с internal, local, corp или bank.', 'database-uri': 'Строки подключения PostgreSQL, MySQL, MongoDB и Redis.', 'private-ip': 'IP-адреса внутренней сети, в том числе с портом.', 'any-ip': 'Публичные и частные адреса IPv4 и IPv6.', 'api-keys': 'Токены и ключи известных форматов.' }[pattern.name];
    const toggle = `<gv-hint label="Поиск новых значений" text="После выключения новые значения не ищутся. Уже найденные секреты продолжают скрываться."><label class="app-switch"><input type="checkbox" role="switch" data-pattern-toggle="${escapeHtml(pattern.id)}" aria-label="Поиск: ${escapeHtml(title)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'Включено' : 'Выключено'}</span></label></gv-hint>`;
    const examples = RulesView.examples[pattern.name];
    const condition = examples ? '<div class="app-rule-examples">' + examples.map(value => '<code>' + escapeHtml(value) + '</code>').join('') + '</div>' : '<pre class="app-rule-expression"><code>' + escapeHtml(pattern.pattern || pattern.regex) + '</code></pre>';
    const actions = '<div class="app-rule-actions">' + toggle + Ui.button('Удалить', 'pattern-delete', [pattern.id], true, '', 'compact') + '</div>';
    return `<section class="app-rule" data-enabled="${enabled}"><div class="app-rule-content"><h3>${escapeHtml(title)}</h3>${description ? '<p class="app-help">' + description + '</p>' : ''}${condition}</div>${actions}</section>`;
  };

  static list = (patterns, query = '') => {
    const q = query.toLowerCase().trim();
    const filtered = patterns.filter(pattern => [RulesView.names[pattern.name], pattern.name, pattern.type, pattern.pattern].some(value => String(value || '').toLowerCase().includes(q)));
    return filtered.map(RulesView.row).join('') || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : 'Правил пока нет. Добавьте условие поиска.');
  };
}
