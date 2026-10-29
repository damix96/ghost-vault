import { escapeHtml } from './utils.js';
import { RelativeTime } from './relative-time.js';
import { Ui } from './ui-components.js';

export class SecretTableView {
  static value = secret => Ui.value(secret.realValue, 'vault:' + secret.key, 'Реальное значение', true);
  static alias = secret => '<div class="app-token">' + Ui.explain(secret.alias, 'Было: ' + (secret.realValue === '' ? '(пустая строка)' : secret.realValue ?? 'значение не сохранено') + '\nК модели: ' + secret.alias, secret.realValue ?? '', secret.key) + '</div>' + Ui.button('Копировать подстановку', 'secret-copy', [secret.alias], true, '', 'compact');
  static cell = (label, html) => `<td data-label="${escapeHtml(label)}">${html}</td>`;
  static actions = (secret, automatic) => '<div class="app-inline-actions">' + (automatic ? Ui.button('В ручные', 'secret-promote', [secret.key], true, 'Перенести в «Ручные», чтобы редактировать значение и описание. Подстановка сохранится.', 'compact') : Ui.button('Изменить', 'secret-edit', [secret.key], true, '', 'compact')) + Ui.button('Удалить', 'secret-delete', [secret.key], true, '', 'compact') + '</div>';
  static card = (secret, automatic) => `<article class="app-secret-card" tabindex="-1" data-secret-record="${escapeHtml(secret.key)}"><header><div><h3>${escapeHtml(secret.key)}</h3>${secret.description ? '<p class="app-help">' + escapeHtml(secret.description) + '</p>' : ''}</div>${SecretTableView.actions(secret, automatic)}</header><div class="app-substitution-pair"><div><small>${Ui.explain('Реальное значение', 'Текст, который скрывается от модели.')}</small>${SecretTableView.value(secret)}</div><div><small>${Ui.explain('Подстановка', 'Этот текст отправляется модели вместо реального значения. В ответе GhostVault восстанавливает значение.')}</small>${SecretTableView.alias(secret)}</div></div><footer>${automatic ? Ui.explain('Обнаружений: ' + (secret.hitCount ?? 'неизвестно'), 'Количество обнаружений правилами, включая повторы в истории запроса.') + ' · ' + RelativeTime.render(secret.updatedAt) : Ui.badge(secret.maskInAi ? 'Замена включена' : 'Замена выключена')}</footer></article>`;
  static manual = secret => SecretTableView.card(secret, false);
  static auto = secret => SecretTableView.card(secret, true);
  static rows = (secrets, query, automatic = false) => {
    const q = (query || '').toLowerCase().trim();
    const filtered = secrets.filter(secret => [secret.key, secret.realValue, secret.alias, secret.description].some(value => String(value || '').toLowerCase().includes(q)));
    return filtered.map(secret => automatic ? SecretTableView.auto(secret) : SecretTableView.manual(secret)).join('') || Ui.empty(q ? 'Совпадений нет. Измените или очистите поиск.' : automatic ? 'Найденных значений пока нет.' : 'Ручных секретов пока нет.');
  };
}
