import { Ui } from './ui-components.js';

export class Screens {
  static mount = () => {
    document.getElementById('viewSecrets').innerHTML = Screens.secrets();
    document.getElementById('viewFeed').innerHTML = Screens.feed();
    document.getElementById('feedClientFilter').options = [{ value: 'all', label: 'Все приложения' }, { value: 'claude', label: 'Claude Code' }, { value: 'opencode', label: 'OpenCode' }, { value: 'неизвестное', label: 'Неизвестное приложение' }];
    document.getElementById('feedDirectionFilter').options = [{ value: 'all', label: 'Все события' }, { value: 'outbound', label: 'К сервису модели' }, { value: 'inbound', label: 'Ответ приложению' }, { value: 'unknown', label: 'События шлюза' }];
  };

  static secrets = () => {
    const actions = '<gv-action id="openAddModalBtn" label="Добавить секрет" tone="primary"></gv-action>';
    const tabs = '<div class="app-inline-actions" role="group" aria-label="Тип секретов"><gv-action id="subTabManualBtn" label="Ручные"></gv-action><span id="manualCount">0</span><gv-action id="subTabAutoBtn" label="Найденные правилами"></gv-action><span id="autoCount">0</span></div>';
    const search = '<input id="searchInput" class="app-search" type="search" aria-label="Поиск секретов" placeholder="Найти по имени, значению или подстановке">';
    const lists = ['manual', 'auto'].map(id => `<section id="${id}VaultTable"${id === 'auto' ? ' hidden' : ''} aria-label="${id === 'manual' ? 'Ручные секреты' : 'Найденные правилами'}"><div id="${id}TableBody" class="app-secret-list"></div></section>`).join('');
    return Ui.page('Секреты', 'Реальные значения и подстановки, которые получает модель.', '<div class="app-secret-toolbar">' + tabs + search + '</div>' + lists, actions);
  };

  static feed = () => {
    const filters = '<gv-select id="feedClientFilter" name="client" label="Приложение" value="all" initial="all"></gv-select><gv-select id="feedDirectionFilter" name="direction" label="Направление" value="all" initial="all"></gv-select>';
    const status = '<div class="app-inline-actions"><span id="liveStreamDot" class="app-live" aria-hidden="true"></span><span id="liveStreamText">Подключаемся к ленте…</span><span id="feedTotalCount">0</span> событий</div>';
    return Ui.page('Диагностика', 'Последние 50 событий. Лента очищается при перезагрузке страницы.', '<gv-stack>' + status + '<gv-grid>' + filters + '</gv-grid>' + Ui.field('feedSearchInput', 'Поиск событий', '', 'type="search" placeholder="Приложение, адрес или значение"') + '<gv-action id="clearFeedBtn" label="Очистить ленту" hint="Сохранённые сессии останутся в «Обзоре»."></gv-action><div id="liveFeedContainer"></div></gv-stack>');
  };
}
