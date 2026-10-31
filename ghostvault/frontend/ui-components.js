import { actionAttributes, escapeHtml } from './utils.js';
import { CodeView } from './code-view.js';

export class Ui {
  static button = (label, action, args = [], secondary = true, hint = '', size = 'normal') => `<gv-action label="${escapeHtml(label)}" tone="${secondary ? 'neutral' : 'primary'}" size="${size}" ${actionAttributes(action, ...args)} hint="${escapeHtml(hint)}"></gv-action>`;
  static hint = (label, text, extra = '') => `<gv-hint text="${escapeHtml(text)}" label="${escapeHtml(label)}" class="${extra}"><gv-action size="compact" label="${escapeHtml(label)}"></gv-action></gv-hint>`;
  static explain = (label, text, copyValue, secretKey) => `<gv-hint ${secretKey !== undefined ? 'secret-key="' + escapeHtml(secretKey) + '"' : ''} ${copyValue === undefined ? '' : 'copy-value="' + escapeHtml(copyValue) + '"'} label="${escapeHtml(label)}" text="${escapeHtml(text)}"><span class="app-explained" tabindex="0" role="button" data-hint-only${secretKey !== undefined ? ' data-secret-key="' + escapeHtml(secretKey) + '" aria-keyshortcuts="Control+Enter"' : ''}>${escapeHtml(label)}</span></gv-hint>`;
  static heading = (title, description, actions = '') => `<div class="app-section-heading"><div><h2>${escapeHtml(title)}</h2><p>${escapeHtml(description)}</p></div><gv-stack direction="row" gap="small">${actions}</gv-stack></div>`;
  static page = (heading, description, content, actions = '') => `<gv-page heading="${escapeHtml(heading)}" description="${escapeHtml(description)}">${actions ? '<gv-stack direction="row" slot="actions" gap="small">' + actions + '</gv-stack>' : ''}<gv-stack gap="large">${content}</gv-stack></gv-page>`;
  static panel = (heading, content, description = '') => `<gv-panel heading="${escapeHtml(heading)}" description="${escapeHtml(description)}">${content}</gv-panel>`;
  static empty = (message, action = '') => `<gv-stack><gv-feedback state="empty" message="${escapeHtml(message)}"></gv-feedback>${action}</gv-stack>`;
  static feedback = (id, state = 'error') => `<gv-feedback id="${id}" class="app-region" state="${state}" hidden></gv-feedback>`;
  static code = value => CodeView.render(value);
  static copy = (value, label, compact = true) => `<gv-copy value="${escapeHtml(value)}" label="${escapeHtml(label)}"${compact ? ' compact' : ''}></gv-copy>`;
  static copyCode = (value, label = 'Копировать JSON') => CodeView.render(value, undefined, Ui.copy(value, label));
  static value = (value, source, label = 'Значение', sensitive = false) => `<gv-value value="${escapeHtml(value)}" source="${escapeHtml(source)}" label="${escapeHtml(label)}"${sensitive ? ' sensitive' : ''}></gv-value>`;
  static details = (label, content, id = label) => `<gv-details heading="${escapeHtml(label)}" data-detail-id="${escapeHtml(id)}">${content}</gv-details>`;
  static badge = (label, tone = '') => `<span class="app-fact"${tone ? ' data-tone="' + escapeHtml(tone) + '"' : ''}>${escapeHtml(label)}</span>`;
  static submit = (label, hint = '') => `<gv-action tone="primary" type="submit" label="${escapeHtml(label)}" hint="${escapeHtml(hint)}"></gv-action>`;
  static metric = (label, id, value, detail, detailId = '') => Ui.panel(label, `<gv-stack gap="small"><strong class="app-metric" id="${id}">${escapeHtml(value)}</strong><small${detailId ? ' id="' + detailId + '"' : ''}>${escapeHtml(detail)}</small></gv-stack>`);
  static toggle = (label, enabled, action, id, hint) => `<gv-action label="${escapeHtml(label)}" tone="${enabled ? 'primary' : 'neutral'}" ${actionAttributes(action, id)} hint="${escapeHtml(hint)}"></gv-action>`;
  static field = (id, label, value = '', attributes = '', hint = '') => `<gv-field id="${id}" name="${id}" label="${escapeHtml(label)}" value="${escapeHtml(value)}" initial="${escapeHtml(value)}" description="${escapeHtml(hint)}" ${attributes}></gv-field>`;
  static message = (label, html, role = '', path = '') => `<article class="app-message" data-role="${escapeHtml(role || label)}" data-reading-key="${escapeHtml(path)}" data-timeline-item tabindex="-1"><div class="app-message-role">${escapeHtml(label)}</div>${path ? '<code class="app-message-path app-technical">' + escapeHtml(path) + '</code>' : ''}${html}</article>`;
  static tableEmpty = message => `<tr><td colspan="5">${Ui.empty(message)}</td></tr>`;
  static error = (id, message) => {
    const element = document.getElementById(id);
    element.message = message;
    element.hidden = !message;
  };
  static read = id => document.getElementById(id).readValue();
}
