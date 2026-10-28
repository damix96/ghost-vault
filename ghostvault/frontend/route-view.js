import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';
import { RouteRowView } from './route-row-view.js';
import { ClientInstructions } from './client-instructions.js';

export class RouteView {
  static page = () => Ui.page('Подключения приложений', '', Ui.feedback('connectionsError') + RouteView.create() + Ui.panel('Адреса для подключения', '<p class="app-help">«Запросов пока нет» — через этот адрес ещё не зарегистрирован вызов.</p><div id="connectionsList"></div>'), Ui.button('Добавить другой сервис', 'route-create', [], false, 'Открывает форму для другого получателя запросов. Настройки приложения не меняются; запрос к модели не выполняется.'));

  static summary = value => {
    try {
      const url = new URL(value);
      return url.protocol + '//' + url.host + (url.pathname === '/' ? '' : '/…') + (url.search ? '?…' : '');
    } catch { return 'Адрес недоступен'; }
  };

  static address = (label, value, id, incoming = false) =>
    `<div class="app-route-address"><span>${escapeHtml(label)}</span><code>${escapeHtml(incoming ? value : RouteView.summary(value))}</code>${incoming ? '' : Ui.details('Показать полный адрес', Ui.code(value) + '<small>Полный адрес может содержать секретные значения.</small>', 'address.' + id)}</div>`;

  static row = (route, activity = '', actions = '') => RouteRowView.render(route, activity, actions, RouteView.summary(route.upstreamUrl || route.targetUrl || ''));

  static list = (routes, activity = () => '', actions = () => '') => RouteRowView.headings() + '<div role="list">' + routes.map(route => RouteView.row(route, activity(route), actions(route))).join('') + '</div>';

  static incoming = route => RouteView.address(ClientInstructions.addressLabel(route), ClientInstructions.incoming(route), route.id + '.in', true) + '<gv-stack direction="row" gap="small">' + Ui.button('Скопировать адрес CLI → VAULT', 'route-copy', [route.id, 'incoming'], false) + '</gv-stack>';

  static instruction = route => ClientInstructions.render(route);

  static create = () => {

    const target = Ui.field('connectionUpstream', 'Адрес сервиса модели', '', 'type="url" required placeholder="https://api.example.com/v1"', 'Введите полный базовый URL из документации сервиса: с https:// или http://, портом и путём API при необходимости. Например https://api.example.com/v1. Без логина, пароля, ?параметров и #фрагмента. Это не адрес GhostVault; ключ доступа настройте отдельно в приложении.');
    const name = Ui.field('connectionName', 'Название подключения · необязательно', '', 'autocomplete="off" placeholder="Мой сервер моделей"', 'Только подпись в списке GhostVault. Если оставить пустым, используем имя сервера из адреса сервиса.');
    const prefix = Ui.field('connectionPrefix', 'Короткое имя в адресе · необязательно', '', 'autocomplete="off" placeholder="my-service"', 'Оставьте пустым — имя подберётся из адреса сервиса. Для своего имени достаточно my-service; /my-service/ тоже принимается, крайние слеши убираются. Не вводите полный URL или /v1. Латинские буквы, цифры и дефис; буквы станут строчными. Адрес GhostVault и /v1 добавляются автоматически.');
    const actions = Ui.submit('Сохранить подключение') + Ui.button('Отмена', 'route-create-cancel', [], true, 'Закрывает форму без создания подключения.');
    return `<div id="createConnection" hidden>${Ui.panel('Добавить свой сервис модели', `<form id="connectionForm" novalidate><gv-stack>${Ui.feedback('connectionFormError')}${target}${name}${Ui.details('Выбрать своё имя в адресе', prefix, 'new-connection-prefix')}<p class="app-help" id="connectionPreview" aria-live="polite"></p><gv-stack direction="row" gap="small">${actions}</gv-stack></gv-stack></form>`, 'Достаточно адреса сервиса. Имя подключения и полный адрес GhostVault сформируются автоматически; при желании их можно уточнить. Сохранение не выполняет запрос к модели и не меняет ваше приложение.')}</div>`;
  };
}
