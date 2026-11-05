import { Ui } from './ui-components.js';
import { ProtectedEditorView } from './protected-editor-view.js';
import { SecretPrivacy } from './secret-privacy.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { SecretErrors } from './secret-errors.js';
import { SecretCleanup } from './secret-cleanup.js';

export class SecretProtection {
  pending = false;
  committed = false;

  constructor(app) { this.app = app; }

  init = () => {
    document.getElementById('editorHost').insertAdjacentHTML('beforeend', ProtectedEditorView.protection());
    this.dialog = document.getElementById('protectExistingDialog');
    this.form = document.getElementById('protectExistingForm');
    this.cancel = document.getElementById('protectExistingCancel');
    this.submit = this.form.querySelector('[type="submit"]');
    this.form.addEventListener('submit', this.save);
    this.cancel.addEventListener('gv-activate', () => { if (!this.pending) this.dialog.hide(); });
    this.dialog.addEventListener('gv-close', () => {
      const action = this.committed ? 'secret-edit' : 'secret-protect';
      const trigger = [...document.querySelectorAll('[data-action="' + action + '"]')].find(node => JSON.parse(node.dataset.args)[0] === this.key);
      this.dialog.setReturnFocus(trigger, document.querySelector('#viewSecrets gv-page'));
    });
  };

  open = (key, trigger) => {
    if (this.dialog.open) return;
    const secret = this.app.manualSecrets.find(item => item.key === key);
    if (!secret || secret.isSecret) { this.app.showToast('Запись изменилась. Обновите список переменных.'); return; }
    this.key = key;
    this.committed = false;
    this.submit.label = 'Защитить значение';
    document.getElementById('protectExistingName').value = key;
    Ui.error('protectExistingError', '');
    HintLifecycle.hide();
    this.dialog.show(trigger, document.querySelector('#viewSecrets gv-page'));
  };

  save = async event => {
    event.preventDefault();
    if (this.pending) return;
    this.pending = true;
    this.dialog.closeDisabled = true;
    this.submit.busy = true;
    this.cancel.disabled = true;
    Ui.error('protectExistingError', '');
    try {
      if (!this.committed) {
        const result = await this.app.api.protectSecret(this.key);
        this.committed = true;
        SecretCleanup.notice(this.app, result);
        this.app.manualSecrets = this.app.manualSecrets.map(secret => secret.key === this.key ? result.secret : secret);
        SecretPrivacy.observe(this.app);
        SecretPrivacy.forget(this.app, this.key);
        SecretPrivacy.refresh(this.app);
      }
      await this.app.fetchData(true);
      this.app.showToast(this.app.cleanupPending ? 'Переменная защищена. Очистка прежних копий ещё не завершена.' : 'Переменная защищена. Имя и подстановка сохранены.');
      this.dialog.closeDisabled = false;
      this.dialog.hide();
    } catch (error) {
      Ui.error('protectExistingError', (this.committed ? 'Защита включена. Не удалось обновить список: ' : 'Не удалось подтвердить защиту: ') + SecretErrors.message(error));
      this.submit.label = this.committed ? 'Обновить список' : 'Защитить значение';
    } finally {
      this.pending = false;
      this.dialog.closeDisabled = false;
      this.submit.busy = false;
      this.cancel.disabled = false;
    }
  };
}
