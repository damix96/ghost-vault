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
    const tabs = '<div class="app-secret-tabs" role="tablist" aria-label="Тип секретов"><button type="button" role="tab" id="subTabManualBtn" aria-controls="manualVaultTable" aria-selected="true">Ручные <span id="manualCount">0</span></button><button type="button" role="tab" id="subTabAutoBtn" aria-controls="autoVaultTable" aria-selected="false" tabindex="-1">Найденные правилами <span id="autoCount">0</span></button></div>';
    const search = '<input id="searchInput" class="app-search" type="search" aria-label="Поиск секретов" placeholder="Найти по имени, значению или подстановке">';
    const lists = ['manual', 'auto'].map(id => `<section id="${id}VaultTable" role="tabpanel" tabindex="0" aria-labelledby="${id === 'manual' ? 'subTabManualBtn' : 'subTabAutoBtn'}"${id === 'auto' ? ' hidden' : ''}><div id="${id}TableBody" class="app-secret-list"></div></section>`).join('');
    const related = '<div id="secretRulesLink" class="app-related" hidden><span id="autoRetentionNotice">Новые найденные значения хранятся до перезапуска. Перенесите нужные в ручные.</span>' + Ui.button('Открыть правила', 'page-open', ['rules'], true, '', 'compact') + '</div>';
    return Ui.page('Секреты', 'Сохранённые значения и их подстановки в запросах к модели.', '<div class="app-secret-toolbar">' + tabs + search + '</div>' + related + lists, actions);
  };

  static feed = () => {
    const filters = '<gv-select id="feedClientFilter" name="client" label="Приложение" value="all" initial="all"></gv-select><gv-select id="feedDirectionFilter" name="direction" label="Направление" value="all" initial="all"></gv-select>';
    const status = '<div class="app-inline-actions"><span id="liveStreamDot" class="app-live" aria-hidden="true"></span><span id="liveStreamText">Подключаемся к ленте…</span><span id="feedTotalCount">0</span> событий</div>';
    return Ui.page('Диагностика', 'Последние 50 событий. Лента очищается при перезагрузке страницы.', '<gv-stack>' + status + '<gv-grid>' + filters + '</gv-grid>' + Ui.field('feedSearchInput', 'Поиск событий', '', 'type="search" placeholder="Приложение, адрес или значение"') + '<gv-action id="clearFeedBtn" label="Очистить ленту" hint="Сохранённые сессии останутся в «Обзоре»."></gv-action><div id="liveFeedContainer"></div></gv-stack>');
  };
}
