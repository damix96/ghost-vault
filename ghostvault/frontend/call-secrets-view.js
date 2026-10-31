import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class CallSecretsView {
  static render = (step, sent, display) => {
    const counts = sent === undefined ? new Map() : display.counts(sent);
    const touched = sent === undefined ? (step.interceptedSecrets || []).map(secret => secret.alias).filter(Boolean) : [];
    const keys = [...new Set([...counts.keys(), ...touched])].filter(alias => display.aliases.has(alias));
    const cards = keys.map(alias => {
      const entry = display.aliases.get(alias);
      const key = alias.startsWith('$${<') && alias.endsWith('>}') ? alias.slice(4, -2) : alias;
      const count = counts.get(alias);
      const original = entry ? CallSecretsView.value('Исходное значение', entry.value, 'Копировать исходное значение ' + key) : '<p class="app-help">Нет известного соответствия</p>';
      const masked = CallSecretsView.value('К модели', alias, 'Копировать подстановку ' + key);
      return `<details class="app-substitution" data-detail-id="variable.${escapeHtml(alias)}"><summary><span class="app-variable-name">${escapeHtml(key)}</span><span class="app-variable-count" title="Вхождений в строковых полях сохранённого запроса">${count === undefined ? '—' : count}</span></summary><div class="app-variable-values">${count === undefined ? '<p class="app-help">Число вхождений неизвестно.</p>' : ''}${original}${masked}</div></details>`;
    }).join('');
    const unknown = [...counts.keys()].filter(alias => !display.aliases.has(alias));
    const missing = unknown.map(alias => `<details class="app-substitution app-unknown-substitution" data-detail-id="variable.${escapeHtml(alias)}"><summary><span class="app-variable-name">${escapeHtml(alias.slice(4, -2))}<small>Нет соответствия</small></span><span class="app-variable-count">${counts.get(alias)}</span></summary><div class="app-variable-values"><p class="app-help">Нет известного соответствия. Возможно, это буквальный текст.</p>${CallSecretsView.value('К модели', alias, 'Копировать подстановку')}</div></details>`).join('');
    return `<aside class="app-call-secrets" aria-label="Подстановки в запросе" tabindex="-1"><header class="app-variables-heading"><h3>Подстановки</h3><span class="app-variable-total" title="Уникальных строк в форме подстановки">${keys.length + unknown.length}</span></header><p class="app-variables-help">${sent === undefined ? 'Сохранённых соответствий' : 'Известных в запросе'}: ${keys.length}${unknown.length ? ' · ' + unknown.length + ' без соответствия' : ''}</p><div class="app-variable-columns"><span>Подстановка</span><span>Вхождений</span></div><div class="app-variable-list">${cards}${missing}${!keys.length && !unknown.length ? '<p class="app-help">В сохранённом запросе подстановок нет</p>' : ''}</div></aside>`;
  };

  static value = (label, value, action) => `<div class="app-variable-value"><header><span>${label}</span></header><div class="app-value-content"><code>${value === '' ? '<span class="app-muted">Пустая строка</span>' : escapeHtml(value)}</code>${Ui.copy(value, action, true)}</div></div>`;
}
