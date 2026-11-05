import { Ui } from './ui-components.js';
import { FormFeedback } from './form-feedback.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { SecretCleanup } from './secret-cleanup.js';

export class SecretRename {
  drafts = new Map();
  pending = false;
  source = null;
  committed = null;
  needsReview = false;

  constructor(app) { this.app = app; }

  init = () => {
    const current = Ui.field('renameCurrentName', 'Текущее имя', '', 'readonly');
    const name = Ui.field('renameNewName', 'Новое имя', '', 'required autocomplete="off"', 'Латинские буквы A–Z, цифры и знак _. Значение и описание сохранятся.');
    const warning = '<p class="app-condition">Ссылки на прежнее имя могут перестать работать. Обновите их в инструкциях и сохранённых запросах. Уже начатые запросы завершаются с прежней подстановкой.</p>';
    const actions = '<div class="app-form-actions"><gv-action id="renameClose" label="Закрыть"></gv-action>' + Ui.submit('Переименовать') + '</div>';
    document.getElementById('editorHost').insertAdjacentHTML('beforeend', `<gv-dialog id="renameSecretModal" heading="Переименовать переменную"><form id="renameSecretForm" novalidate><gv-stack>${Ui.feedback('renameSecretError')}${current}${name}${warning}${actions}</gv-stack></form></gv-dialog>`);
    this.dialog = document.getElementById('renameSecretModal');
    this.form = document.getElementById('renameSecretForm');
    this.field = document.getElementById('renameNewName');
    this.submit = this.form.querySelector('[type="submit"]');
    this.close = document.getElementById('renameClose');
    this.form.addEventListener('submit', this.save);
    this.close.addEventListener('gv-activate', () => { if (!this.pending) this.dialog.hide(); });
    FormFeedback.bind(this.form, document.getElementById('renameSecretError'));
    this.dialog.addEventListener('gv-close', this.closed);
  };

  open = (key, trigger) => {
    if (this.dialog.open) return;
    const secret = this.app.manualSecrets.find(item => item.key === key);
    if (!secret) { this.app.showToast('Переменная больше не найдена. Обновите список.'); return; }
    HintLifecycle.hide();
    this.source = key;
    this.committed = null;
    this.needsReview = false;
    document.getElementById('renameCurrentName').value = key;
    this.field.value = this.drafts.get(key) ?? key;
    this.field.error = '';
    this.field.setCustomValidity?.('');
    this.field.disabled = false;
    this.field.readonly = false;
    this.submit.label = 'Переименовать';
    Ui.error('renameSecretError', '');
    this.dialog.show(trigger, document.querySelector('#viewSecrets gv-page'));
  };

  closed = () => {
    if (!this.committed) this.drafts.set(this.source, Ui.read('renameNewName'));
    const key = this.committed?.key || this.source;
    const trigger = [...document.querySelectorAll('[data-action="secret-rename"]')].find(node => JSON.parse(node.dataset.args)[0] === key);
    this.dialog.setReturnFocus(trigger, document.querySelector('#viewSecrets gv-page'));
    HintLifecycle.hide(this.dialog);
  };

  apply = secret => {
    const oldKey = this.source;
    this.committed = secret;
    this.drafts.delete(oldKey);
    if (secret.key !== oldKey) {
      const draft = this.app.modals.drafts.get(oldKey);
      if (draft) {
        this.app.modals.drafts.set(secret.key, { ...draft, key: secret.key });
        this.app.modals.drafts.delete(oldKey);
      }
      const opened = this.app.renderer.manual.opened;
      if (opened.delete('vault.' + oldKey)) opened.add('vault.' + secret.key);
    }
    this.app.manualSecrets = this.app.manualSecrets.map(item => item.key === oldKey ? secret : item);
    const query = this.app.searchQuery.trim().toLowerCase();
    if (![secret.key, secret.realValue, secret.alias, secret.description].some(value => String(value || '').toLowerCase().includes(query))) {
      this.app.searchQuery = '';
      document.getElementById('searchInput').value = '';
    }
    this.app.render();
  };

  save = async event => {
    event.preventDefault();
    if (this.pending) return;
    const name = Ui.read('renameNewName');
    if (!this.committed && !this.needsReview && (!FormFeedback.check([['renameNewName', name.length ? '' : 'Введите новое имя.']], document.getElementById('renameSecretError')) || !this.form.reportValidity())) return;
    this.pending = true;
    this.dialog.closeDisabled = true;
    this.close.disabled = true;
    this.field.disabled = true;
    this.submit.busy = true;
    Ui.error('renameSecretError', '');
    try {
      if (this.needsReview) {
        await this.app.fetchData(true);
        Ui.error('renameSecretError', 'Список обновлён. Результат переименования не подтверждён. Закройте окно и проверьте переменную перед новой попыткой; черновик сохранится.');
        return;
      }
      if (!this.committed) {
        const result = await this.app.api.renameSecret(this.source, name);
        SecretCleanup.notice(this.app, result);
        this.apply(result.secret);
      }
      await this.app.fetchData(true);
      this.app.showToast(this.source === this.committed.key ? 'Имя не изменилось' : 'Переменная переименована: ' + this.committed.key);
      this.dialog.closeDisabled = false;
      this.dialog.hide();
    } catch (error) {
      const message = this.committed ? 'Имя сохранено. Не удалось обновить список: ' : this.needsReview ? 'Не удалось обновить список: ' : 'Не удалось подтвердить переименование: ';
      this.needsReview ||= !this.committed && (!error.status || error.status === 404);
      const recovery = this.needsReview ? ' Обновите список, чтобы проверить текущее имя перед новой попыткой; черновик сохранится.' : '';
      Ui.error('renameSecretError', message + error.message + recovery);
      this.submit.label = this.committed || this.needsReview ? 'Обновить список' : 'Переименовать';
    } finally {
      this.pending = false;
      this.dialog.closeDisabled = false;
      this.close.disabled = false;
      this.field.disabled = Boolean(this.committed);
      this.field.readonly = this.needsReview;
      this.submit.busy = false;
    }
  };
}
