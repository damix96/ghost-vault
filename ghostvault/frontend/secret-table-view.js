import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';
import { SecretGroups } from './secret-groups.js';

export class SecretTableView {
  static value = secret => secret.isSecret && secret.realValue === undefined ? '<div class="app-vault-value"><header><span>Зашифрованное значение</span></header><p class="app-help">Значение скрыто настройкой интерфейса.</p></div>' : SecretTableView.field('Реальное значение', secret.realValue, 'Копировать исходное значение ' + secret.key);
  static alias = secret => SecretTableView.field('Подстановка', secret.alias, 'Копировать подстановку ' + secret.key);
  static field = (label, value, action) => `<div class="app-vault-value"><header><span>${label}</span></header><div class="app-value-content"><pre>${value === undefined ? 'Значение не сохранено' : value === '' ? 'Пустая строка' : escapeHtml(value)}</pre>${value === undefined ? '' : Ui.copy(value, action, true)}</div></div>`;
  static cell = (label, html) => `<td data-label="${escapeHtml(label)}">${html}</td>`;
  static actions = (secret, automatic) => '<div class="app-inline-actions">' + (automatic ? Ui.button('В ручные', 'secret-promote', [secret.key], true, 'Перенести в «Ручные», чтобы редактировать значение и описание. Подстановка сохранится.', 'compact') : Ui.button(secret.isSecret ? 'Заменить значение' : 'Изменить', 'secret-edit', [secret.key], true, '', 'compact') + (secret.isSecret ? '' : Ui.button('Защитить', 'secret-protect', [secret.key], true, '', 'compact')) + Ui.button('Переименовать', 'secret-rename', [secret.key], true, '', 'compact')) + '</div>';
  static card = (secret, automatic) => {
    const storage = secret.storage === 'memory' ? 'В памяти' : secret.storage === 'legacy' ? 'Сохранённая ранее' : '';
    const status = automatic ? Ui.explain('Обнаружений: ' + (secret.hitCount ?? 'неизвестно'), 'Количество обнаружений правилами, включая повторы в истории запроса.') + ' · ' + (storage || RelativeTime.render(secret.updatedAt)) : Ui.badge(secret.maskInAi ? 'Замена включена' : 'Замена выключена') + (secret.isSecret ? ' · ' + Ui.badge('Защищённое хранение') : '');
    const description = secret.description ? '<p class="app-secret-description">' + escapeHtml(secret.description) + '</p>' : '';
    const remove = '<div class="app-record-footer"><span>Удаление отключит подстановку для новых запросов.</span>' + Ui.button('Удалить секрет', 'secret-delete', [secret.key], true, '', 'compact') + '</div>';
    return `<article class="app-secret-card" tabindex="-1" data-reading-key="vault.${escapeHtml(secret.key)}" data-secret-record="${escapeHtml(secret.key)}" data-secret-protected="${Boolean(secret.isSecret)}"><header><div><h3>${escapeHtml(secret.key)}</h3><div class="app-record-meta">${status}</div></div>${SecretTableView.actions(secret, automatic)}</header><details class="app-record-details" data-detail-id="vault.${escapeHtml(secret.key)}"><summary>Значение и подстановка</summary>${description}<div class="app-vault-pair">${SecretTableView.value(secret)}${SecretTableView.alias(secret)}</div>${remove}</details></article>`;
  };
  static manual = secret => SecretTableView.card(secret, false);
  static auto = secret => SecretTableView.card(secret, true);
  static grouped = (secrets, query) => {
    const { groups, singles } = SecretGroups.collect(secrets, query);
    const rows = groups.filter(group => group.entries.length).map(group => {
      const count = query ? group.entries.length + ' из ' + group.total : String(group.total);
      return `<details class="app-secret-group" data-secret-group="${escapeHtml(group.prefix)}"><summary data-reading-key="auto-group.${escapeHtml(group.prefix)}"><span class="app-secret-group-heading"><code>${escapeHtml(group.prefix)}</code><span class="app-secret-group-count">Записей: ${count}</span></span></summary>${group.entries.map(SecretTableView.auto).join('')}</details>`;
    });
    return rows.join('') + singles.map(SecretTableView.auto).join('');
  };
  static rows = (secrets, query, automatic = false) => {
    const q = (query || '').toLowerCase().trim();
    const html = automatic ? SecretTableView.grouped(secrets, q) : secrets.filter(secret => SecretGroups.matches(secret, q)).map(SecretTableView.manual).join('');
    return html || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : automatic ? 'Найденных значений пока нет.' : 'Ручных секретов пока нет.');
  };
}
