import { escapeHtml } from './utils.js';
import { RestorationFragments } from './restoration-fragments.js';
import { Ui } from './ui-components.js';
import { ChangeFragments } from './change-fragments.js';

export class ResponseChangeView {
  constructor(display) { this.display = display; }

  static empty = ChangeFragments.empty;

  render = step => {
    if (step.state === 'active' || step.responseChanges?.status === 'pending') return '<p class="app-exchange-empty" role="status">Ответ поступает</p>';
    const evidence = step.responseChanges;
    if (!evidence || evidence.version !== 1) return ResponseChangeView.empty('Места восстановления для этого ответа не сохранены. Доступен полный текст.');
    const valid = (Array.isArray(evidence.items) ? evidence.items : []).filter(item => Number.isInteger(item.after?.start) && Number.isInteger(item.after?.end) && item.after.start >= 0 && item.after.end >= item.after.start && item.after.text?.slice(item.after.start, item.after.end) === item.value);
    if (!valid.length) return ResponseChangeView.empty(evidence.status === 'complete' ? 'В этом ответе восстановлений не было.' : evidence.status === 'interrupted' ? 'Ответ прерван. Подтверждённых фрагментов восстановления нет.' : 'Ответ не проходил восстановление подстановок.');
    const notice = evidence.postHookModified ? '<p class="app-help">Фрагменты на этапе восстановления. После него обработчик изменил ответ.</p>' : '';
    const interrupted = evidence.status === 'interrupted' ? '<p class="app-help">Ответ прерван. Показаны подтверждённые восстановления полученной части.</p>' : '';
    const groups = RestorationFragments.group(valid);
    const content = groups.filter(group => group.source !== 'protocol-snapshot').map(group => this.fragment(group)).join('');
    const protocol = groups.filter(group => group.source === 'protocol-snapshot');
    return notice + interrupted + content + (protocol.length ? Ui.details('Восстановления в данных протокола', protocol.map(group => this.fragment(group)).join(''), 'response.restoration.protocol') : '');
  };

  restored = item => {
    const key = item.key ?? this.display.aliases.get(item.alias)?.secret.key;
    const shown = item.value === '' ? '(пустая строка)' : item.value;
    const keyAttribute = key === undefined ? '' : ` secret-key="${escapeHtml(key)}"`;
    const actionAttribute = key === undefined ? '' : ` data-secret-key="${escapeHtml(key)}" aria-keyshortcuts="Control+Enter"`;
    return `<span class="app-restored-value"><gv-hint direction="inbound" label="${escapeHtml(item.alias)}" text="${escapeHtml('От модели: ' + item.alias + '\nПриложению: ' + item.value)}" copy-value="${escapeHtml(item.value)}"${keyAttribute}><span class="app-explained" role="button" tabindex="0" data-hint-only${actionAttribute}>${escapeHtml(shown)}</span></gv-hint></span>`;
  };

  fragment = group => {
    const kind = ['tool-arguments', 'protocol-snapshot'].includes(group.source) ? 'code' : 'prose';
    const label = group.source === 'tool-arguments' ? 'Аргументы инструмента' : group.source === 'protocol-snapshot' ? 'Данные протокола' : 'Восстановлено';
    let html = '';
    let trimStart = 0;
    let trimEnd = group.text.length;
    const first = group.matches.reduce((start, item) => Math.min(start, item.start), group.text.length);
    const last = group.matches.reduce((end, item) => Math.max(end, item.end), 0);
    const cutEnd = Number.isInteger(group.totalLength) && group.start + group.text.length < group.totalLength;
    if (group.start > 0) while (trimStart < first && !/\s/.test(group.text[trimStart])) trimStart++;
    if (cutEnd) while (trimEnd > last && !/\s/.test(group.text[trimEnd - 1])) trimEnd--;
    let offset = trimStart;
    for (const item of [...group.matches].sort((a, b) => a.start - b.start)) {
      if (item.start < offset) continue;
      html += escapeHtml(group.text.slice(offset, item.start)) + this.restored(item);
      offset = item.end;
    }
    html += escapeHtml(group.text.slice(offset, trimEnd));
    return `<article class="app-change-card" data-reading-key="response.change.${escapeHtml(group.id)}" data-timeline-item tabindex="-1" data-content-kind="${kind}"><header><strong>${label}</strong></header><div class="app-change-fragment">${group.start > 0 ? '<span class="app-fragment-cut" aria-label="Начало поля скрыто">…</span>' : ''}<div class="app-change-text">${html}</div>${cutEnd ? '<span class="app-fragment-cut" aria-label="Продолжение поля скрыто">…</span>' : ''}</div></article>`;
  };
}
