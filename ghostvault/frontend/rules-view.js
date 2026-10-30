import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class RulesView {
  static names = { 'internal-urls': 'Внутренние адреса', 'database-uri': 'Адреса баз данных', 'private-ip': 'Частные IP-адреса', 'any-ip': 'Любой IP-адрес', 'api-keys': 'Ключи доступа' };
  static shell = () => Ui.page('Правила', 'Условия поиска новых секретов в запросах к модели.', Ui.feedback('rulesError') + '<div class="app-management-toolbar">' + Ui.field('rulesSearch', 'Найти правило', '', 'type="search" placeholder="Название или выражение"') + Ui.button('Найденные секреты', 'found-secrets', [], true, '', 'compact') + '</div><p class="app-help">Выключение правила останавливает новый поиск. Уже найденные секреты сохраняются.</p><div id="rulesList" class="app-rules-list"></div><div id="ruleEditorHost"></div>', Ui.button('Добавить правило', 'rule-create', [], false));

  static row = pattern => {
    const enabled = pattern.enabled === 1 || pattern.enabled === true;
    const title = RulesView.names[pattern.name] || pattern.name;
    const toggle = `<gv-hint label="Поиск новых значений" text="После выключения новые значения не ищутся. Уже найденные секреты продолжают скрываться."><label class="app-switch"><input type="checkbox" role="switch" data-pattern-toggle="${escapeHtml(pattern.id)}" aria-label="Поиск: ${escapeHtml(title)}" ${enabled ? 'checked' : ''}><span>${enabled ? 'Включено' : 'Выключено'}</span></label></gv-hint>`;
    const semantics = pattern.id === 'pat_any_ip' ? 'gi · полное совпадение · проверка IPv4/IPv6, включая ::1' : 'gi · полное совпадение · trim · длина больше 3';
    const expression = pattern.pattern ?? pattern.regex ?? '';
    const condition = '<div class="app-expression-heading"><span>Регулярное выражение</span>' + Ui.copy(expression, 'Копировать выражение', true) + '</div><pre class="app-rule-expression" tabindex="0" aria-label="Регулярное выражение"><code>' + escapeHtml(expression) + '</code></pre><p class="app-help">' + semantics + '</p>' + (pattern.label_template ? '<p class="app-help">Шаблон метки: <code>' + escapeHtml(pattern.label_template) + '</code></p>' : '');
    const actions = '<div class="app-rule-actions">' + toggle + Ui.button('Изменить', 'rule-edit', [pattern.id], true, '', 'compact') + '</div>';
    const remove = '<div class="app-record-footer"><span>Найденные секреты останутся после удаления правила.</span>' + Ui.button('Удалить правило', 'pattern-delete', [pattern.id], true, '', 'compact') + '</div>';
    return `<section class="app-rule" data-rule-record="${escapeHtml(pattern.id)}" data-enabled="${enabled}"><header class="app-rule-heading"><div><h3>${escapeHtml(title)}</h3><p class="app-record-meta">Метка: <code>${escapeHtml(pattern.type)}</code></p></div>${actions}</header><details class="app-record-details" data-detail-id="rule.${escapeHtml(pattern.id)}"><summary>Выражение и параметры</summary>${condition}${remove}</details><span class="app-rule-feedback" role="status"></span></section>`;
  };

  static list = (patterns, query = '') => {
    const q = query.toLowerCase().trim();
    const filtered = patterns.filter(pattern => [RulesView.names[pattern.name], pattern.name, pattern.type, pattern.pattern].some(value => String(value || '').toLowerCase().includes(q)));
    return filtered.map(RulesView.row).join('') || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : 'Правил пока нет. Добавьте условие поиска.');
  };
}
