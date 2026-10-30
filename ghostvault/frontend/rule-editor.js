import { Ui } from './ui-components.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { RulePreview } from './rule-preview.js';
import { RuleTemplateView } from './rule-template-view.js';
import { RulesView } from './rules-view.js';

export class RuleEditor {
  retained = new Map();
  entity = null;
  baseline = null;
  latest = null;
  revision = 0;
  pending = false;
  discard = false;

  constructor(app) { this.app = app; }
  static fields = row => ({ name: row.name, pattern: row.pattern, type: row.type, label_template: row.label_template || null, enabled: Number(row.enabled) });

  init = () => {
    document.getElementById('ruleEditorHost').innerHTML = '<gv-dialog id="ruleEditorDialog" heading="Изменить правило"><form id="ruleEditorForm" novalidate><div class="app-rule-editor">' + Ui.feedback('ruleEditorError') + '<label>Название<input name="name" class="app-search" required></label><label>Регулярное выражение<textarea name="pattern" class="app-regex-input" rows="5" required spellcheck="false" aria-describedby="ruleRegexHelp"></textarea></label><p id="ruleRegexHelp" class="app-help"></p><label>Метка найденных секретов<input name="type" class="app-search" required aria-describedby="ruleTypeHelp"></label><p id="ruleTypeHelp" class="app-help">Например billing → AUTO_BILLING_…</p><label class="app-switch"><input name="enabled" type="checkbox">Поиск новых значений включён</label><p class="app-help">Изменение применяется к новым запросам. Найденные ранее секреты сохраняются.</p><div class="app-form-actions"><button type="button" data-rule-cancel class="app-text-button">Сбросить и закрыть</button><button type="submit" class="app-save-button">Сохранить</button></div></div></form></gv-dialog>';
    this.dialog = document.getElementById('ruleEditorDialog');
    this.form = document.getElementById('ruleEditorForm');
    this.form.querySelector('#ruleTypeHelp').insertAdjacentHTML('afterend', RuleTemplateView.editor());
    const preview = document.createElement('aside');
    this.form.append(preview, this.form.querySelector('.app-form-actions'));
    this.preview = new RulePreview(this.app.api, preview, () => ({ pattern: this.read().pattern, type: this.read().type, label_template: this.read().label_template, anyIp: this.entity === 'pat_any_ip' }));
    ['pattern', 'type', 'label_template'].forEach(name => this.form.elements[name].addEventListener('input', this.preview.schedule));
    this.form.addEventListener('submit', this.save);
    this.form.addEventListener('input', () => {
      this.revision++;
      this.form.dataset.dirty = String(JSON.stringify(this.read()) !== JSON.stringify(this.baseline));
      if (!this.blocked) Ui.error('ruleEditorError', '');
    });
    this.form.querySelector('[data-rule-cancel]').addEventListener('click', () => {
      if (this.pending) return;
      this.discard = true;
      this.dialog.hide();
    });
    this.dialog.addEventListener('gv-close', () => {
      this.preview.cancel();
      HintLifecycle.hide(this.dialog);
      if (this.discard) this.retained.delete(this.entity);
      else this.retained.set(this.entity, { baseline: this.baseline, draft: this.read(), revision: this.revision });
      const trigger = [...document.querySelectorAll('[data-action="rule-edit"]')].find(node => JSON.parse(node.dataset.args)[0] === this.entity);
      this.dialog.setReturnFocus(trigger, document.querySelector('[data-action="rule-create"]'));
      requestAnimationFrame(() => window.scrollTo(this.scroll.x, this.scroll.y));
    });
  };

  read = () => ({ name: this.form.elements.name.value, pattern: this.form.elements.pattern.value, type: this.form.elements.type.value, label_template: this.form.elements.label_template.value || null, enabled: this.form.elements.enabled.checked ? 1 : 0 });

  open = id => {
    if (this.pending || this.dialog.open) return;
    const row = this.app.patterns.find(item => item.id === id);
    if (!row) { this.app.showToast('Правило больше не существует.'); return; }
    const retained = this.retained.get(id);
    this.entity = id;
    this.baseline = retained?.baseline || RuleEditor.fields(row);
    this.revision = retained?.revision || 0;
    this.discard = false;
    this.scroll = { x: window.scrollX, y: window.scrollY };
    const draft = retained?.draft || this.baseline;
    for (const key of ['name', 'pattern', 'type', 'label_template']) this.form.elements[key].value = draft[key] ?? '';
    this.dialog.heading = 'Изменить правило · ' + (RulesView.names[row.name] || row.name) + (JSON.stringify(draft) !== JSON.stringify(this.baseline) ? ' · черновик' : '');
    this.form.elements.name.setAttribute('aria-label', RulesView.names[row.name] ? 'Техническое название правила' : 'Название');
    this.form.elements.name.parentElement.firstChild.textContent = RulesView.names[row.name] ? 'Техническое название правила' : 'Название';
    this.form.elements.enabled.checked = Boolean(draft.enabled);
    this.form.dataset.dirty = String(JSON.stringify(draft) !== JSON.stringify(this.baseline));
    document.getElementById('ruleRegexHelp').textContent = 'Исходное выражение без /…/ и флагов. Поиск использует gi: все полные совпадения без учёта регистра; пробелы по краям совпадения убираются. ' + (id === 'pat_any_ip' ? 'У этого правила дополнительно проверяется корректность IPv4/IPv6. Короткие IP, например ::1, допускаются. Другой текст не будет найден даже после изменения выражения.' : 'Совпадения длиной 3 символа и меньше пропускаются.');
    this.observe(this.app.patterns);
    HintLifecycle.hide();
    this.dialog.show(document.activeElement, document.querySelector('[data-action="rule-create"]'));
    this.preview.schedule();
  };

  observe = rows => {
    if (!this.entity) return;
    const current = rows.find(row => row.id === this.entity);
    this.latest = current ? RuleEditor.fields(current) : null;
    this.blocked = !current || JSON.stringify(this.latest) !== JSON.stringify(this.baseline);
    this.form.querySelector('[type="submit"]').disabled = this.pending || this.blocked;
    Ui.error('ruleEditorError', !current ? 'Правило удалено. Черновик доступен для копирования, сохранение недоступно.' : this.blocked ? 'Сохранённое правило изменилось. Ваш ввод сохранён. Для актуальной версии нажмите «Сбросить и закрыть» и откройте правило снова.' : '');
  };

  save = async event => {
    event.preventDefault();
    if (this.pending || this.blocked) return;
    const draft = this.read();
    if (!draft.name.trim() || !draft.type.trim() || !draft.pattern) { Ui.error('ruleEditorError', 'Заполните название, выражение и метку.'); return; }
    try {
      if (/^\/.*\/[a-z]*$/s.test(draft.pattern)) throw new Error('Введите исходное выражение без /…/ и флагов.');
      new RegExp(draft.pattern, 'gi');
    } catch (error) { Ui.error('ruleEditorError', 'Некорректное выражение: ' + error.message); return; }
    this.pending = true;
    this.dialog.closeDisabled = true;
    for (const field of this.form.elements) field.disabled = true;
    try {
      const result = await this.app.api.request('/api/patterns/' + encodeURIComponent(this.entity), { method: 'PUT', body: JSON.stringify({ ...draft, baseline: this.baseline }) });
      this.baseline = RuleEditor.fields(result.pattern);
      this.discard = true;
      await this.app.fetchPatterns();
      this.dialog.closeDisabled = false;
      this.dialog.hide();
      this.app.showToast('Правило сохранено');
    } catch (error) {
      await this.app.fetchPatterns();
      Ui.error('ruleEditorError', error.message);
    }
    finally {
      this.pending = false;
      this.dialog.closeDisabled = false;
      for (const field of this.form.elements) field.disabled = false;
      this.form.querySelector('[type="submit"]').disabled = Boolean(this.blocked);
    }
  };
}
