import { Ui } from './ui-components.js';
import { EditorViews } from './editor-views.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { FormFeedback } from './form-feedback.js';
import { EditorValidation } from './editor-validation.js';
import { RulePreview } from './rule-preview.js';

export class ModalManager {
  editingKey = null;
  pending = new Set();
  drafts = new Map();

  constructor(app, api) {
    this.app = app;
    this.api = api;
  }

  init = () => {
    document.getElementById('editorHost').innerHTML = EditorViews.shell();
    const preview = document.createElement('aside');
    const patternForm = document.getElementById('patternForm');
    patternForm.append(preview, patternForm.querySelector('.app-form-actions'));
    this.rulePreview = new RulePreview(this.api, preview, () => ({ pattern: Ui.read('patternRegexInput'), type: Ui.read('patternTypeInput') || 'custom', label_template: Ui.read('patternTemplateInput') || null, anyIp: false }));
    ['patternRegexInput', 'patternTypeInput', 'patternTemplateInput'].forEach(id => document.getElementById(id).addEventListener('gv-input', this.rulePreview.schedule));
    document.getElementById('openAddModalBtn').addEventListener('gv-activate', () => this.openSecretModal());
    document.getElementById('cancelModalBtn').addEventListener('gv-activate', this.closeSecretModal);
    document.getElementById('cancelPatternModalBtn').addEventListener('gv-activate', () => this.togglePatternModal(false));
    document.getElementById('secretForm').addEventListener('submit', this.handleSaveSecret);
    document.getElementById('patternForm').addEventListener('submit', this.handleSavePattern);
    ['secret', 'pattern'].forEach(kind => FormFeedback.bind(document.getElementById(kind + 'Form'), document.getElementById(kind + 'FormError')));
    document.getElementById('modalKeyInput').addEventListener('gv-input', event => {
      document.getElementById('modalPreviewToken').textContent = event.detail.value ? '$${<' + event.detail.value + '>}' : 'Будет показана после ввода имени';
    });
    document.getElementById('secretModal').addEventListener('gv-close', event => {
      HintLifecycle.hide(event.currentTarget);
      const page = document.getElementById('viewSecrets');
      const trigger = this.editingKey ? [...page.querySelectorAll('[data-action="secret-edit"]')].find(action => JSON.parse(action.dataset.args)[0] === this.editingKey) : document.getElementById('openAddModalBtn');
      event.currentTarget.setReturnFocus(trigger, page.querySelector('gv-page'));
      if (!this.saved) this.drafts.set(this.editingKey || '', { key: Ui.read('modalKeyInput'), value: Ui.read('modalValInput'), description: Ui.read('modalDescInput') });
      this.saved = false;
      this.editingKey = null;
    });
    document.getElementById('patternModal').addEventListener('gv-close', event => { this.rulePreview.cancel(); HintLifecycle.hide(event.currentTarget); });
  };

  openSecretModal = async (secretKey = null) => {
    const dialog = document.getElementById('secretModal');
    if (dialog.open) return;
    HintLifecycle.hide();
    this.editingKey = secretKey;
    const secret = [...this.app.manualSecrets, ...this.app.autoSecrets].find(item => item.key === secretKey);
    const key = document.getElementById('modalKeyInput');
    const draft = this.drafts.get(secretKey || '');
    key.value = draft?.key ?? secret?.key ?? '';
    key.readonly = Boolean(secret);
    key.label = secret ? 'Имя записи' : 'Имя подстановки';
    key.description = secret ? 'Постоянное имя записи. При изменении значения подстановка обновится.' : EditorViews.keyDescription;
    const restored = draft && (draft.key !== (secret?.key || '') || draft.value !== (secret?.realValue || '') || draft.description !== (secret?.description || ''));
    dialog.heading = (secret ? 'Изменить секрет' : 'Добавить секрет') + (restored ? ' · черновик' : '');
    document.getElementById('modalValInput').value = draft?.value ?? secret?.realValue ?? '';
    document.getElementById('modalDescInput').value = draft?.description ?? secret?.description ?? '';
    document.getElementById('modalPreviewToken').textContent = secret?.alias || (key.value ? '$${<' + key.value + '>}' : 'Введите имя');
    document.getElementById('modalPreviewLabel').textContent = secret ? 'Текущая подстановка' : 'В запросе';
    document.getElementById('secretSaveEffect').textContent = secret ? (secret.maskInAi ? 'Замена останется включена. ' : 'Замена останется выключена. ') + 'При изменении значения новая подстановка появится после сохранения; прежняя восстанавливает только старые ответы.' : 'Сохранение добавит и включит замену этого точного значения. Запрос к модели не выполняется.';
    Ui.error('secretFormError', '');
    document.getElementById('secretForm').querySelectorAll('gv-field').forEach(field => { field.error = ''; });
    dialog.show(document.activeElement, document.querySelector('#viewSecrets gv-page'));
  };

  closeSecretModal = () => { if (!this.pending.has('secret')) document.getElementById('secretModal').hide(); };

  togglePatternModal = show => {
    const dialog = document.getElementById('patternModal');
    if (show) {
      HintLifecycle.hide();
      Ui.error('patternFormError', '');
      document.getElementById('patternForm').querySelectorAll('gv-field').forEach(field => { field.error = ''; });
      dialog.show(document.activeElement, document.querySelector('#viewRules gv-page'));
      this.rulePreview.schedule();
    } else if (!this.pending.has('pattern')) dialog.hide();
  };

  save = async (event, kind, operation, afterSave) => {
    event.preventDefault();
    if (this.pending.has(kind)) return;
    const entries = kind === 'secret' ? EditorValidation.secret(this.editingKey, [...this.app.manualSecrets, ...this.app.autoSecrets]) : EditorValidation.pattern();
    if (!FormFeedback.check(entries, document.getElementById(kind + 'FormError')) || !event.currentTarget.reportValidity()) return;
    const dialog = document.getElementById(kind + 'Modal');
    const form = event.currentTarget;
    const button = form.querySelector('gv-action[type="submit"]');
    this.pending.add(kind);
    dialog.closeDisabled = true;
    const cancel = form.querySelector('gv-action:not([type="submit"])');
    cancel.disabled = true;
    form.querySelectorAll('gv-field').forEach(field => { field.disabled = true; });
    button.busy = true;
    Ui.error(kind + 'FormError', '');
    try {
      await operation();
      await afterSave();
      if (kind === 'secret') { this.saved = true; this.drafts.delete(this.editingKey || ''); }
      this.pending.delete(kind);
      dialog.closeDisabled = false;
      dialog.hide();
    } catch (problem) { Ui.error(kind + 'FormError', 'Не удалось подтвердить сохранение: ' + problem.message); }
    finally {
      this.pending.delete(kind);
      dialog.closeDisabled = false;
      cancel.disabled = false;
      form.querySelectorAll('gv-field').forEach(field => { field.disabled = false; });
      button.busy = false;
    }
  };

  handleSaveSecret = event => this.save(event, 'secret', () => this.api.saveSecret({ key: this.editingKey ?? Ui.read('modalKeyInput'), realValue: Ui.read('modalValInput'), description: Ui.read('modalDescInput') }), async () => {
      await this.app.fetchData();
      this.app.showToast('Секрет сохранён');
    });

  handleSavePattern = event => this.save(event, 'pattern', () => this.api.createPattern({ name: Ui.read('patternNameInput'), pattern: Ui.read('patternRegexInput'), type: Ui.read('patternTypeInput') || 'custom', label_template: Ui.read('patternTemplateInput') || null }), async () => {
    document.getElementById('patternForm').reset();
    await this.app.fetchPatterns();
    this.app.showToast('Правило создано и включено');
  });
}
