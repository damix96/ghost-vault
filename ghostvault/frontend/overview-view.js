import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';
import { RelativeTime } from './relative-time.js';

export class OverviewView {
  static shell = () => Ui.page('Рабочее пространство', '', Ui.feedback('overviewError') + '<div id="connectionBar"></div>' + OverviewView.streamPanel() + OverviewView.dialogPanel());
  static streamPanel = () => '<div id="overviewStream" hidden><p class="app-help">Приходит ответ…</p><pre id="overviewStreamText" class="app-code"></pre></div>';
  static dialogPanel = () => '<p id="overviewActivity" class="app-help" hidden></p><div id="overviewDialogLayout" class="app-session-layout app-no-sessions"><aside id="overviewSessions" aria-label="Сессии" hidden><input class="app-search" id="sessionSearch" type="search" aria-label="Найти сессию" placeholder="Найти сессию"><div id="overviewSessionList"></div></aside><div id="overviewConversation"></div></div>';
  static sessions = (sessions, selected) => sessions.map(session => `<article class="app-session-row" data-selected="${session.id === selected}"><button type="button" class="app-session-choice" data-session-id="${escapeHtml(session.id)}" aria-current="${session.id === selected}" title="${escapeHtml(session.id)}"><strong class="app-session-id">${escapeHtml(session.id)}</strong><span>${escapeHtml(session.client || 'Сессия')}</span></button><div class="app-session-time">${RelativeTime.render(session.lastSeen || session.timestamp)}</div></article>`).join('');
  static empty = () => '<div class="app-empty"><strong>В этом соединении пока нет запросов</strong><p>Отправьте сообщение из подключённого приложения. Здесь появятся места замен и ответ модели.</p></div>';
}
