import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class CallSecretsView {
  static render = (step, sent, display) => {
    const counts = sent === undefined ? new Map() : display.counts(sent);
    const touched = sent === undefined ? (step.interceptedSecrets || []).map(secret => secret.alias).filter(Boolean) : [];
    const keys = [...new Set([...counts.keys(), ...touched])];
    const cards = keys.map(alias => {
      const entry = display.aliases.get(alias);
      const key = alias.startsWith('$${<') && alias.endsWith('>}') ? alias.slice(4, -2) : alias;
      const count = counts.get(alias);
      const original = entry ? CallSecretsView.value('Было', entry.value, 'Копировать исходное значение ' + key) : '<p class="app-help">Значение не сохранено</p>';
      const masked = CallSecretsView.value('К модели', alias, 'Копировать подстановку ' + key);
      return `<details class="app-substitution" data-detail-id="variable.${escapeHtml(alias)}"><summary><span class="app-variable-name">${escapeHtml(key)}</span><span class="app-variable-count" title="${count === undefined ? 'Обнаружено при обработке' : 'Вхождений в запросе'}">${count ===undefined ? 'найдено' : count}</span></summary><div class="app-variable-values">${original}${masked}</div></details>`;
    }).join('');
    const unknown = [...new Set((JSON.stringify(sent) || '').match(/\$\$\{<[^<>]+>\}/g) || [])].filter(alias => !display.aliases.has(alias));
    const missing = unknown.map(alias => `<details class="app-substitution" data-detail-id="variable.${escapeHtml(alias)}"><summary><span class="app-variable-name">${escapeHtml(alias)}</span></summary><div class="app-variable-values"><p class="app-help">Реальное значение не сохранено.</p>${CallSecretsView.value('К модели', alias, 'Копировать подстановку')}</div></details>`).join('');
    return `<aside class="app-call-secrets" aria-label="Переменные" data-reading-target-id="variables" tabindex="-1"><header class="app-variables-heading"><h3>Переменные</h3><span class="app-variable-total">${keys.length + unknown.length}</span></header><p class="app-variables-help">Число справа — вхождения в запросе</p><div class="app-variable-list">${cards}${missing}${!keys.length && !unknown.length ? '<p class="app-help">В запросе подстановок нет</p>' : ''}</div></aside>`;
  };

  static value = (label, value, action) => `<div class="app-variable-value"><header><span>${label}</span></header><div class="app-value-content"><code>${value === '' ? '<span class="app-muted">Пустая строка</span>' : escapeHtml(value)}</code>${Ui.copy(value, action, true)}</div></div>`;
}
