import { escapeHtml } from './utils.js';
import { Ui } from './ui-components.js';

export class CallSecretsView {
  static render = (step, sent, display) => {
    const counts = sent === undefined ? new Map() : display.counts(sent);
    const touched = (step.interceptedSecrets || []).map(secret => secret.key);
    const keys = [...new Set([...counts.keys(), ...touched])];
    const cards = keys.map(key => {
      const entry = [...display.aliases.values()].find(item => item.secret.key === key);
      const alias = entry?.secret.alias;
      const count = counts.get(key);
      return `<article class="app-substitution"><header><strong>${entry ? Ui.explain(key, entry.secret.realValue === '' ? '(пустая строка)' : entry.secret.realValue, entry.secret.realValue, key) : escapeHtml(key)}</strong><span>${count === undefined ? 'Обнаружено при обработке' : 'В запросе: ' + count}</span></header><div class="app-substitution-pair"><div><small>Было</small>${entry ? Ui.value(entry.secret.realValue, 'call:' + key, 'Реальное значение') : '<p>Значение не сохранено</p>'}</div><div><small>К модели</small>${alias ? '<div class="app-token">' + display.render(alias) + '</div>' + Ui.button('Копировать подстановку', 'secret-copy', [alias], true, '', 'compact') : '<p>Подстановка не сохранена</p>'}</div></div></article>`;
    }).join('');
    const unknown = [...new Set((JSON.stringify(sent) || '').match(/\$\$\{<[^<>]+>\}/g) || [])].filter(alias => !display.aliases.has(alias));
    return `<section class="app-call-secrets"><h3>Подстановки</h3>${cards || '<p class="app-help">Секреты не найдены.</p>'}${unknown.map(alias => '<article class="app-substitution">' + display.render(alias) + '<p class="app-help">Реальное значение не сохранено.</p></article>').join('')}</section>`;
  };
}
