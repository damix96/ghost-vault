import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class RulesView {
  static names = { 'internal-urls': 'Внутренние адреса', 'database-uri': 'Адреса баз данных', 'private-ip': 'Частные IP-адреса', 'any-ip': 'Любой IP-адрес', 'api-keys': 'Ключи доступа' };
  static shell = () => Ui.page('Правила', 'Что автоматически скрывать в запросах к модели.', Ui.feedback('rulesError') + Ui.field('rulesSearch', 'Найти правило', '', 'type="search" placeholder="Название или выражение"') + '<div id="rulesList" class="app-rules-list"></div><div id="ruleEditorHost"></div>', Ui.button('Добавить правило', 'rule-create', [], false));

  static row = pattern => {
    const enabled = pattern.enabled === 1 || pattern.enabled === true;
    const title = RulesView.names[pattern.name] || pattern.name;
    const toggle = `<gv-hint label="Поиск новых значений" text="После выключения новые значения не ищутся. Уже найденные секреты продолжают скрываться."><label class="app-switch"><input type="checkbox" role="switch" data-pattern-toggle="${escapeHtml(pattern.id)}" aria-label="Поиск: ${escapeHtml(title)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'Включено' : 'Выключено'}</span></label></gv-hint>`;
    const semantics = pattern.id === 'pat_any_ip' ? 'gi · полное совпадение · проверка IPv4/IPv6, включая ::1' : 'gi · полное совпадение · trim · длина больше 3';
    const condition = '<pre class="app-rule-expression" tabindex="0" aria-label="Регулярное выражение"><code>' + escapeHtml(pattern.pattern ?? pattern.regex ?? '') + '</code></pre><p class="app-help">' + semantics + ' · Метка: <code>' + escapeHtml(pattern.type) + '</code></p>';
    const actions = '<div class="app-rule-actions">' + toggle + Ui.button('Изменить', 'rule-edit', [pattern.id], true, '', 'compact') + Ui.button('Удалить', 'pattern-delete', [pattern.id], true, '', 'compact') + '</div>';
    return `<section class="app-rule" data-enabled="${enabled}"><div class="app-rule-content"><h3>${escapeHtml(title)}</h3>${condition}</div>${actions}</section>`;
  };

  static list = (patterns, query = '') => {
    const q = query.toLowerCase().trim();
    const filtered = patterns.filter(pattern => [RulesView.names[pattern.name], pattern.name, pattern.type, pattern.pattern].some(value => String(value || '').toLowerCase().includes(q)));
    return filtered.map(RulesView.row).join('') || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : 'Правил пока нет. Добавьте условие поиска.');
  };
}
