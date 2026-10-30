import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';

export class SecretTableView {
  static value = secret => SecretTableView.field('Реальное значение', secret.realValue, 'Копировать исходное значение ' + secret.key);
  static alias = secret => SecretTableView.field('Подстановка', secret.alias, 'Копировать подстановку ' + secret.key);
  static field = (label, value, action) => `<div class="app-vault-value"><header><span>${label}</span></header><div class="app-value-content"><pre>${value === undefined ? 'Значение не сохранено' : value === '' ? 'Пустая строка' : escapeHtml(value)}</pre>${value === undefined ? '' : Ui.copy(value, action, true)}</div></div>`;
  static cell = (label, html) => `<td data-label="${escapeHtml(label)}">${html}</td>`;
  static actions = (secret, automatic) => '<div class="app-inline-actions">' + (automatic ? Ui.button('В ручные', 'secret-promote', [secret.key], true, 'Перенести в «Ручные», чтобы редактировать значение и описание. Подстановка сохранится.', 'compact') : Ui.button('Изменить', 'secret-edit', [secret.key], true, '', 'compact')) + '</div>';
  static card = (secret, automatic) => {
    const storage = secret.storage === 'memory' ? 'В памяти' : secret.storage === 'legacy' ? 'Сохранённая ранее' : '';
    const status = automatic ? Ui.explain('Обнаружений: ' + (secret.hitCount ?? 'неизвестно'), 'Количество обнаружений правилами, включая повторы в истории запроса.') + ' · ' + (storage || RelativeTime.render(secret.updatedAt)) : Ui.badge(secret.maskInAi ? 'Замена включена' : 'Замена выключена');
    const description = (secret.description ? '<p class="app-secret-description">' + escapeHtml(secret.description) + '</p>' : '') + (secret.retainedVersions ? '<p class="app-help">Прежних значений для восстановления ответов: ' + Number(secret.retainedVersions) + '.</p>' : '');
    const remove = '<div class="app-record-footer"><span>Удаление уберёт текущее и прежние соответствия.</span>' + Ui.button('Удалить секрет', 'secret-delete', [secret.key], true, '', 'compact') + '</div>';
    return `<article class="app-secret-card" tabindex="-1" data-secret-record="${escapeHtml(secret.key)}"><header><div><h3>${escapeHtml(secret.key)}</h3><div class="app-record-meta">${status}</div></div>${SecretTableView.actions(secret, automatic)}</header><details class="app-record-details" data-detail-id="vault.${escapeHtml(secret.key)}"><summary>Значение и подстановка</summary>${description}<div class="app-vault-pair">${SecretTableView.value(secret)}${SecretTableView.alias(secret)}</div>${remove}</details></article>`;
  };
  static manual = secret => SecretTableView.card(secret, false);
  static auto = secret => SecretTableView.card(secret, true);
  static rows = (secrets, query, automatic = false) => {
    const q = (query || '').toLowerCase().trim();
    const filtered = secrets.filter(secret => [secret.key, secret.realValue, secret.alias, secret.description].some(value => String(value || '').toLowerCase().includes(q)));
    return filtered.map(secret => automatic ? SecretTableView.auto(secret) : SecretTableView.manual(secret)).join('') || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : automatic ? 'Найденных значений пока нет.' : 'Ручных секретов пока нет.');
  };
}
