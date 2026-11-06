import { Ui } from './ui-components.js';
import { EditorViews } from './editor-views.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { FormFeedback } from './form-feedback.js';
import { EditorValidation } from './editor-validation.js';
import { RulePreview } from './rule-preview.js';
import { SecretKeyInput } from './secret-key-input.js';
import { SecretPrivacy } from './secret-privacy.js';
import { SecretCleanup } from './secret-cleanup.js';
import { SecretErrors } from './secret-errors.js';

export class ModalManager {
  editingKey = null;
  pending = new Set();
  drafts = new Map();
  sensitive = false;
  protectedExisting = false;
  committed = false;
  review = false;

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
    document.getElementById('modalEncryptInput').addEventListener('change', () => {
      this.sensitive ||= document.getElementById('modalEncryptInput').checked;
      if (this.sensitive) this.drafts.delete(this.editingKey || '');
      this.storageNote();
    });
    document.getElementById('patternForm').addEventListener('submit', this.handleSavePattern);
    ['secret', 'pattern'].forEach(kind => FormFeedback.bind(document.getElementById(kind + 'Form'), document.getElementById(kind + 'FormError')));
    this.secretKeyInput = new SecretKeyInput(document.getElementById('modalKeyInput'), document.getElementById('modalPreviewToken'));
    document.getElementById('secretModal').addEventListener('gv-close', event => {
      HintLifecycle.hide(event.currentTarget);
      const page = document.getElementById('viewSecrets');
      const trigger = this.editingKey ? [...page.querySelectorAll('[data-action="secret-edit"]')].find(action => JSON.parse(action.dataset.args)[0] === this.editingKey) : document.getElementById('openAddModalBtn');
      event.currentTarget.setReturnFocus(trigger, page.querySelector('gv-page'));
      if (this.sensitive) {
        this.drafts.delete(this.editingKey || '');
        SecretPrivacy.clearField(document.getElementById('modalValInput'));
      } else if (!this.saved) this.drafts.set(this.editingKey || '', { key: Ui.read('modalKeyInput'), value: Ui.read('modalValInput'), description: Ui.read('modalDescInput') });
      this.saved = false;
      this.editingKey = null;
    });
    document.getElementById('patternModal').addEventListener('gv-close', event => { this.rulePreview.cancel(); HintLifecycle.hide(event.currentTarget); });
    window.addEventListener('pagehide', () => { if (this.sensitive) SecretPrivacy.clearField(document.getElementById('modalValInput')); });
  };

  openSecretModal = async (secretKey = null) => {
    const dialog = document.getElementById('secretModal');
    if (dialog.open) return;
    HintLifecycle.hide();
    this.editingKey = secretKey;
    const secret = [...this.app.manualSecrets, ...this.app.autoSecrets].find(item => item.key === secretKey);
    this.sensitive = Boolean(secret?.isSecret);
    this.protectedExisting = this.sensitive;
    this.committed = false;
    this.review = false;
    document.getElementById('modalEncryptInput').checked = this.protectedExisting;
    document.getElementById('secretForm').querySelectorAll('gv-field').forEach(field => { field.disabled = false; });
    document.querySelector('#secretForm gv-action[type="submit"]').label = 'Сохранить переменную';
    if (this.sensitive) SecretPrivacy.forget(this.app, secretKey);
    const key = document.getElementById('modalKeyInput');
    const draft = this.sensitive ? null : this.drafts.get(secretKey || '');
    key.value = secret ? draft?.key ?? secret.key : SecretKeyInput.normalize(draft?.key ?? '');
    key.readonly = Boolean(secret);
    key.label = secret ? 'Имя записи' : 'Имя подстановки';
    key.description = secret ? 'Имя и подстановка сохранятся. Для смены имени используйте «Переименовать» в списке.' : EditorViews.keyDescription;
    const restored = draft && (draft.key !== (secret?.key || '') || draft.value !== (secret?.realValue || '') || draft.description !== (secret?.description || ''));
    dialog.heading = (secret ? 'Изменить переменную' : 'Добавить переменную') + (restored ? ' · черновик' : '');
    document.getElementById('modalValInput').value = this.sensitive ? '' : draft?.value ?? secret?.realValue ?? '';
    document.getElementById('modalValInput').label = this.sensitive ? 'Новое значение' : 'Значение';
    this.storageNote();
    document.getElementById('modalDescInput').value = draft?.description ?? secret?.description ?? '';
    document.getElementById('modalPreviewToken').textContent = secret?.alias || EditorValidation.keyPreview(key.value);
    document.getElementById('modalPreviewLabel').textContent = secret ? 'Текущая подстановка' : 'В запросе';
    document.getElementById('secretSaveEffect').textContent = secret ? (secret.maskInAi ? 'Замена останется включена. ' : 'Замена останется выключена. ') + 'Имя и подстановка останутся прежними. Новые запросы используют сохранённое значение; уже начатые завершаются с прежним.' : 'Сохранение добавит и включит замену этого точного значения. Запрос к модели не выполняется.';
    Ui.error('secretFormError', '');
    document.getElementById('secretForm').querySelectorAll('gv-field').forEach(field => { field.error = ''; });
    dialog.show(document.activeElement, document.querySelector('#viewSecrets gv-page'));
  };

  closeSecretModal = () => { if (!this.pending.has('secret')) document.getElementById('secretModal').hide(); };

  storageNote = () => {
    const checkbox = document.getElementById('modalEncryptInput');
    checkbox.disabled = this.protectedExisting || this.pending.has('secret') || this.committed || this.review;
    document.getElementById('secretStorageNote').textContent = this.protectedExisting
      ? 'Значение зашифровано. Старое значение не загружается; введите новое для замены. Отключение шифрования пока не поддерживается.'
      : checkbox.checked ? 'Значение будет зашифровано средствами операционной системы. Ввод очищается после сохранения или отмены.' : 'Значение сохраняется на этом компьютере без шифрования.';
  };

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
    const refreshOnly = kind === 'secret' && (this.committed || this.review);
    const entries = refreshOnly ? [] : kind === 'secret' ? EditorValidation.secret(this.editingKey, [...this.app.manualSecrets, ...this.app.autoSecrets]) : EditorValidation.pattern();
    if (!refreshOnly && (!FormFeedback.check(entries, document.getElementById(kind + 'FormError')) || !event.currentTarget.reportValidity())) return;
    const dialog = document.getElementById(kind + 'Modal');
    const form = event.currentTarget;
    const button = form.querySelector('gv-action[type="submit"]');
    this.pending.add(kind);
    if (kind === 'secret') this.storageNote();
    dialog.closeDisabled = true;
    const cancel = form.querySelector('gv-action:not([type="submit"])');
    cancel.disabled = true;
    form.querySelectorAll('gv-field').forEach(field => { field.disabled = true; });
    button.busy = true;
    Ui.error(kind + 'FormError', '');
    try {
      if (kind === 'secret' && this.review) {
        await this.app.fetchData(true);
        Ui.error('secretFormError', 'Список обновлён. Проверьте запись и откройте форму заново перед повторным сохранением.');
        return;
      }
      const result = refreshOnly ? undefined : await operation();
      SecretCleanup.notice(this.app, result);
      if (kind === 'secret') { this.committed = true; this.saved = true; this.drafts.delete(this.editingKey || ''); }
      if (kind === 'secret' && this.sensitive) {
        this.drafts.delete(this.editingKey || '');
        SecretPrivacy.clearField(document.getElementById('modalValInput'));
      }
      await afterSave();
      if (kind === 'secret') { this.saved = true; this.drafts.delete(this.editingKey || ''); }
      this.pending.delete(kind);
      dialog.closeDisabled = false;
      dialog.hide();
    } catch (problem) {
      if (kind === 'secret') {
        this.review ||= !this.committed && (!problem.status || problem.status === 404);
        button.label = this.committed || this.review ? 'Обновить список' : 'Сохранить переменную';
      }
      Ui.error(kind + 'FormError', (kind === 'secret' && this.committed ? 'Значение сохранено. Не удалось обновить список: ' : 'Не удалось подтвердить сохранение: ') + SecretErrors.message(problem));
    }
    finally {
      this.pending.delete(kind);
      dialog.closeDisabled = false;
      cancel.disabled = false;
      form.querySelectorAll('gv-field').forEach(field => { field.disabled = kind === 'secret' && (this.committed || this.review); });
      if (kind === 'secret') this.storageNote();
      button.busy = false;
    }
  };

  handleSaveSecret = event => this.save(event, 'secret', () => {
    const payload = { key: this.editingKey ?? Ui.read('modalKeyInput'), realValue: Ui.read('modalValInput'), description: Ui.read('modalDescInput') };
    return document.getElementById('modalEncryptInput').checked
      ? this.api.saveProtectedSecret({ ...payload, operation: this.editingKey ? 'update' : 'create' }) : this.api.saveSecret(payload);
  }, async () => {
    await this.app.fetchData(true);
    this.app.showToast(this.app.cleanupPending ? 'Переменная сохранена. Очистка прежних копий ещё не завершена.' : 'Переменная сохранена');
  });

  handleSavePattern = event => this.save(event, 'pattern', () => this.api.createPattern({ name: Ui.read('patternNameInput'), pattern: Ui.read('patternRegexInput'), type: Ui.read('patternTypeInput') || 'custom', label_template: Ui.read('patternTemplateInput') || null }), async () => {
    document.getElementById('patternForm').reset();
    await this.app.fetchPatterns();
    this.app.showToast('Правило создано и включено');
  });
}
