import { Ui } from './ui-components.js';
import { ProtectedEditorView } from './protected-editor-view.js';
import { SecretValuesForm } from './secret-values-form.js';
import { SecretErrors } from './secret-errors.js';
import { SecretPrivacy } from './secret-privacy.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { SecretCleanup } from './secret-cleanup.js';

export class ProtectedEditor {
  pending = false;
  committed = false;
  key = null;
  review = false;

  constructor(app, commit) {
    this.app = app;
    this.commit = commit;
  }

  init = () => {
    document.getElementById('editorHost').insertAdjacentHTML('beforeend', ProtectedEditorView.shell());
    this.dialog = document.getElementById('protectedEditor');
    this.form = document.getElementById('protectedEditorForm');
    this.inputs = new SecretValuesForm(document.getElementById('protectedEditorRows'), 'protectedEditorValue');
    this.submit = this.form.querySelector('[type="submit"]');
    this.cancel = document.getElementById('protectedEditorCancel');
    this.form.addEventListener('submit', this.save);
    this.cancel.addEventListener('gv-activate', () => { if (!this.pending) this.dialog.hide(); });
    this.dialog.addEventListener('gv-close', this.closed);
    window.addEventListener('pagehide', this.clear);
  };

  clear = () => {
    this.inputs.clear();
    SecretPrivacy.clearField(document.getElementById('protectedDescription'));
  };

  open = (key = null, trigger = document.activeElement) => {
    if (this.dialog.open) return;
    const secret = this.app.manualSecrets.find(item => item.key === key);
    if (key && !secret?.isSecret) { this.app.showToast('Запись изменилась. Обновите список переменных.'); return; }
    this.key = key;
    this.committed = false;
    this.review = false;
    this.inputs.render(key ? [key] : [], Boolean(key));
    this.inputs.setPending(false);
    const description = document.getElementById('protectedDescription');
    description.value = secret?.description || '';
    description.disabled = false;
    this.dialog.heading = key ? 'Заменить секретное значение' : 'Добавить секрет';
    this.submit.label = key ? 'Заменить значение' : 'Сохранить секрет';
    this.cancel.label = 'Отменить';
    document.getElementById('protectedEditorHelp').textContent = key ? 'Новое значение заменит текущее сохранённое значение. Старое значение не загружается. Имя, подстановка и настройка замены сохранятся. Введённое значение очищается из формы после сохранения или отмены.' : 'Секрет будет храниться с системной защитой. Замена в запросах будет включена. Введённое значение очищается из формы после сохранения или отмены.';
    Ui.error('protectedEditorError', '');
    HintLifecycle.hide();
    this.dialog.show(trigger, document.querySelector('#viewSecrets gv-page'));
  };

  closed = () => {
    this.clear();
    const trigger = this.key ? [...document.querySelectorAll('[data-action="secret-edit"]')].find(node => JSON.parse(node.dataset.args)[0] === this.key) : document.getElementById('openProtectedCreateBtn');
    this.dialog.setReturnFocus(trigger, document.querySelector('#viewSecrets gv-page'));
    this.inputs.root.replaceChildren();
  };

  save = async event => {
    event.preventDefault();
    if (this.pending) return;
    if (!this.committed && !this.review && (!this.inputs.validate(document.getElementById('protectedEditorError')) || !this.form.reportValidity())) return;
    this.pending = true;
    this.dialog.closeDisabled = true;
    this.cancel.disabled = true;
    this.submit.busy = true;
    this.inputs.setPending(true);
    document.getElementById('protectedDescription').disabled = true;
    Ui.error('protectedEditorError', '');
    try {
      if (this.review) {
        await this.app.fetchData(true);
        Ui.error('protectedEditorError', 'Список обновлён. Результат этой попытки не подтверждён. Проверьте запись и откройте новую форму перед повторным вводом.');
        return;
      }
      if (!this.committed) {
        const entry = this.inputs.values()[0];
        const result = await this.commit({ key: this.key || entry.name, realValue: entry.value, description: Ui.read('protectedDescription'), operation: this.key ? 'update' : 'create' });
        this.committed = true;
        SecretCleanup.notice(this.app, result);
        this.clear();
      }
      await this.app.fetchData(true);
      this.app.showToast(this.app.cleanupPending ? 'Значение сохранено. Очистка прежних копий ещё не завершена.' : this.key ? 'Секретное значение обновлено. Подстановка сохранена.' : 'Секрет создан. Значение защищено.');
      this.dialog.closeDisabled = false;
      this.dialog.hide();
    } catch (error) {
      this.review ||= !this.committed && (!error.status || error.status === 404 || error.code === 'REVISION_CONFLICT');
      Ui.error('protectedEditorError', (this.committed ? 'Значение сохранено. Не удалось обновить список: ' : 'Не удалось подтвердить сохранение: ') + SecretErrors.message(error));
      this.submit.label = this.committed || this.review ? 'Обновить список' : this.key ? 'Заменить значение' : 'Сохранить секрет';
      this.cancel.label = this.committed ? 'Закрыть' : 'Отменить';
    } finally {
      this.pending = false;
      this.dialog.closeDisabled = false;
      this.cancel.disabled = false;
      this.submit.busy = false;
      this.inputs.setPending(this.committed || this.review);
      document.getElementById('protectedDescription').disabled = this.committed || this.review;
    }
  };
}
