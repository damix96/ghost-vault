import { escapeHtml, formatTimestamp, truncate, extractSnippets, highlightTokens, highlightOriginalTokens, parsePromptText, parseOutboundRaw, parseResponseText, parseToolCalls } from './utils.js';
import { Ui } from './ui-components.js';
import { DisclosureState } from './disclosure-state.js';

export class InspectorRenderer {
  headerDetails = new DisclosureState();
  renderSidebar = (sessions, selectedSessionId) => {
    const html = sessions.map(session => Ui.button(`${session.name || session.id} · ${session.client || 'Приложение'} · ${session.stepsCount ?? session.txCount ?? '—'} вызовов`, 'session-select', [session.id], session.id !== selectedSessionId, 'Показывает сохранённые вызовы этой сессии. Новых запросов к модели не выполняет. Последняя запись: ' + formatTimestamp(session.lastSeen || session.timestamp))).join('');
    document.getElementById('sessionsSidebarList').innerHTML = `<gv-stack gap="small">${html || Ui.empty('Нет активных сессий')}</gv-stack>`;
    document.querySelectorAll('#sessionsSidebarList [data-action="session-select"]').forEach(action => { action.pressed = JSON.parse(action.dataset.args)[0] === selectedSessionId; });
  };

  renderHeader = (session, steps, selectedIndex) => {
    const allSecrets = steps.flatMap(step => step.interceptedSecrets || []);
    const unique = [...new Map(allSecrets.map(secret => [secret.key || secret.alias, secret])).values()];
    const secrets = unique.map(secret => Ui.panel(secret.key || secret.alias, Ui.value(secret.realValue ?? '', `session:${session.id}:${secret.key}`, 'Реальное значение', true) + Ui.value(secret.alias, `session:${session.id}:${secret.key}:alias`, 'Подстановка'))).join('');
    const tabs = steps.map((step, index) => Ui.button(`#${index + 1} · ${truncate(parsePromptText(step.request || {}).replace(/\s+/g, ' '), 40)}`, 'step-select', [index], index !== selectedIndex, 'Показывает этот сохранённый вызов и его ответ. Повторно запрос не отправляется. Время: ' + formatTimestamp(step.timestamp))).join('');
    this.headerDetails.render(document.getElementById('sessionHeaderArea'), `<gv-stack>${Ui.heading(session.name || session.id || 'Диалог', `${session.client || 'Приложение'} · ${steps.length} вызовов`, Ui.button('Удалить эту сессию', 'session-delete', [session.id], true, 'Сразу удаляет выбранную сессию и все её сохранённые вызовы из GhostVault. Секреты, правила, подключения и сессия в исходном приложении сохраняются.'))}${Ui.details(`Перехваты сессии · ${unique.length} секретов`, `<gv-stack>${secrets || Ui.empty('Зарегистрированных перехватов нет')}</gv-stack>`, 'inspector-secrets')}<gv-stack direction="row" gap="small" role="group" aria-label="Шаги сессии">${tabs}</gv-stack></gv-stack>`);
    document.querySelectorAll('#sessionHeaderArea [data-action="step-select"]').forEach(action => { action.pressed = JSON.parse(action.dataset.args)[0] === selectedIndex; });
  };

  renderDialog = steps => `<gv-stack>${steps.map((step, index) => {
    const prompt = parsePromptText(step.request || {});
    const response = parseResponseText(step.response || {});
    const tools = parseToolCalls(step.response || {});
    return Ui.panel(`Шаг #${index + 1} · ${formatTimestamp(step.timestamp)}`, `<gv-stack>${Ui.message('Запрос пользователя', '<div class="app-prose">' + highlightTokens(prompt, step.interceptedSecrets || []) + '</div>')}${response ? Ui.message('Ответ ассистента', '<div class="app-prose">' + escapeHtml(response) + '</div>') : ''}${tools.map(tool => Ui.message('Инструмент: ' + tool.name, Ui.code(tool.input))).join('')}</gv-stack>`);
  }).join('')}</gv-stack>`;

  renderStep = (step, stepIndex, mode = 'snippets', allSteps = []) => {
    const container = document.getElementById('sessionTimelineArea');
    if (!step) {
      container.innerHTML = Ui.empty('Шаги не найдены.');
      return;
    }
    const request = step.request || {};
    const response = step.response || {};
    const secrets = step.interceptedSecrets || [];
    const stepId = step.id || 'step-' + stepIndex;
    const prompt = parsePromptText(request);
    const outbound = parseOutboundRaw(step, prompt);
    const responseText = parseResponseText(response);
    const tools = parseToolCalls(response);
    const snippets = extractSnippets(outbound, secrets.flatMap(secret => [secret.alias, secret.realValue]), 70);
    const modes = [['snippets', 'Фрагменты рядом с заменами', 'Показывает участки сохранённого запроса рядом с известными значениями и подстановками. Это сокращённое представление, а не весь запрос.'], ['cloud', 'Запрос для сервиса модели', 'Показывает сохранённое представление после замены. Если отдельное тело после замены не сохранено, оно восстанавливается по известным соответствиям; это не побайтовая запись сетевой отправки.'], ['original', 'Запрос из приложения', 'Показывает сохранённое содержимое выбранного запроса до замены, включая реальные секреты. Отображение и переключение не отправляют данные модели.'], ['dialog', 'Сохранённые запросы сессии', 'Показывает доступные вызовы этой сессии. Каждый может повторять историю сообщений; это не единый очищенный от повторов диалог.']];
    const controls = '<gv-stack direction="row" gap="small" role="group" aria-label="Представление запроса">' + modes.map(([value, label, hint]) => Ui.button(label, 'outbound-mode', [stepId, value], mode !== value, hint)).join('') + '</gv-stack>';
    const content = mode === 'dialog' ? this.renderDialog(allSteps.length ? allSteps : [step]) : mode === 'original' ? highlightOriginalTokens(prompt, secrets) : mode === 'cloud' ? highlightTokens(outbound, secrets) : snippets.map((snippet, index) => `<div><strong>Фрагмент ${index + 1}</strong><div class="app-prose">${highlightTokens(snippet, secrets)}</div></div>`).join('');
    const status = response.status ? `HTTP ${response.status}` : 'Статус не сохранён';
    const error = step.error || response.status >= 400 ? `<gv-feedback state="error" message="${escapeHtml(step.error || JSON.stringify(response.body || ''))}"></gv-feedback>` : '';
    const target = step.targetUrl || request.targetUrl || 'Точный адрес провайдера не сохранён';
    const answer = responseText ? Ui.message('Сохранённый ответ для приложения', '<div class="app-prose">' + escapeHtml(responseText) + '</div>') : Ui.empty('Текстового ответа не сохранено.');
    container.innerHTML = `<gv-stack gap="large">${Ui.heading(`Шаг #${stepIndex + 1}`, `${request.method || 'POST'} ${request.url || ''} · ${status} · ${step.latencyMs !== undefined ? step.latencyMs + ' мс · ' : ''}${formatTimestamp(step.timestamp)}`)}${Ui.value(target, 'inspector-target:' + stepId, 'GhostVault → провайдер', true)}${controls}<div class="app-prose">${content}</div>${error}${answer}${tools.map(tool => Ui.message('Вызов инструмента: ' + tool.name, Ui.code(tool.input))).join('')}</gv-stack>`;
    container.querySelectorAll('[data-action="outbound-mode"]').forEach(action => { action.pressed = JSON.parse(action.dataset.args)[1] === mode; });
  };
}
