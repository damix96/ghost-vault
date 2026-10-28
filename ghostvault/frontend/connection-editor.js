import { ConnectionEditorView } from './connection-editor-view.js';
import { Ui } from './ui-components.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { ClientInstructions } from './client-instructions.js';
import { FormFeedback } from './form-feedback.js';

export class ConnectionEditor {
  saving = false;
  source = null;
  drafts = new Map();

  constructor(app, api, onSaved) {
    this.app = app;
    this.api = api;
    this.onSaved = onSaved;
  }

  init = () => {
    document.getElementById('connectionSettingsHost').innerHTML = ConnectionEditorView.shell();
    this.dialog = document.getElementById('connectionSettingsDialog');
    this.dialog.addEventListener('submit', this.save);
    this.dialog.addEventListener('gv-activate', event => { if (event.target.closest('[data-settings-close]')) this.close(); });
    this.dialog.addEventListener('gv-close', this.restore);
  };

  isOpen = () => Boolean(this.dialog?.open);

  open = (route, trigger, mode = 'help') => {
    if (this.isOpen()) return;
    HintLifecycle.hide();
    this.route = { ...route };
    this.source = {
      trigger: trigger || document.activeElement, page: this.app.activeMainTab, id: route.id,
      x: window.scrollX, y: window.scrollY,
      scroll: ['overviewConversation', 'overviewSessions'].map(id => {
        const el = document.getElementById(id);
        return { id, top: el.scrollTop, left: el.scrollLeft };
      }),
    };
    this.mode = mode;
    this.dialog.heading = (mode === 'settings' ? 'Настройки · ' : 'Как подключить · ') + (route.name || route.title || route.id);
    this.dialog.innerHTML = ConnectionEditorView.content(this.route, mode);
    const draft = this.drafts.get(route.id);
    if (draft) { document.getElementById('connectionSettingsTarget').value = draft.target; document.getElementById('connectionSettingsName').value = draft.name; }
    FormFeedback.bind(document.getElementById('connectionSettingsForm'), document.getElementById('connectionSettingsError'));
    this.dialog.show(this.source.trigger, document.querySelector('#view' + this.source.page[0].toUpperCase() + this.source.page.slice(1) + ' gv-page'));
  };

  close = () => { if (!this.saving) this.dialog.hide(); };

  showCopyResult = (copied, field) => {
    const status = document.getElementById('connectionCopyStatus');
    status.state = copied ? 'success' : 'error';
    status.message = copied ? ClientInstructions.copyMessage(this.route, field) : 'Не удалось скопировать. Выделите показанный текст и скопируйте вручную.';
    status.hidden = false;
  };

  restore = () => {
    HintLifecycle.hide(this.dialog);
    const source = this.source;
    if (this.mode === 'settings' && !this.saved) this.drafts.set(this.route.id, { target: Ui.read('connectionSettingsTarget'), name: Ui.read('connectionSettingsName') });
    this.saved = false;
    this.source = null;
    if (!source) return;
    const page = document.getElementById('view' + source.page.charAt(0).toUpperCase() + source.page.slice(1));
    const replacement = [...page.querySelectorAll('[data-action="route-open"]')].find(button => JSON.parse(button.dataset.args || '[]')[0] === source.id);
    const trigger = source.trigger?.isConnected ? source.trigger : replacement;
    this.dialog.setReturnFocus(trigger, page.querySelector('gv-page'));
    source.scroll.forEach(position => {
      const el = document.getElementById(position.id);
      el.scrollTop = position.top;
      el.scrollLeft = position.left;
    });
    window.scrollTo(source.x, source.y);
  };

  save = async event => {
    event.preventDefault();
    if (this.saving) return;
    const value = Ui.read('connectionSettingsTarget').trim();
    if (!FormFeedback.check([['connectionSettingsTarget', FormFeedback.httpError(value)]], document.getElementById('connectionSettingsError')) || !document.getElementById('connectionSettingsForm').reportValidity()) return;
    const status = document.getElementById('connectionSettingsStatus');
    const button = this.dialog.querySelector('gv-action[type="submit"]');
    this.saving = true;
    this.dialog.closeDisabled = true;
    this.dialog.querySelector('[data-settings-close]').disabled = true;
    this.dialog.querySelectorAll('gv-field').forEach(field => { field.disabled = true; });
    button.busy = true;
    Ui.error('connectionSettingsError', '');
    status.message = 'Сохраняем адрес этого подключения…';
    status.hidden = false;
    let saved = false;
    try {
      await this.api.updateRoute(this.route.id, value, Ui.read('connectionSettingsName').trim());
      saved = true;
      this.saved = true;
      this.drafts.delete(this.route.id);
      this.onSaved(this.route.id, value);
      this.saving = false;
      this.dialog.closeDisabled = false;
      this.close();
      this.app.showToast('Соединение сохранено');
    } catch (problem) {
      if (saved) {
        this.saving = false;
        this.dialog.closeDisabled = false;
        this.close();
        this.app.showToast('Адрес сохранён, но отображение не обновилось. Обновите страницу.');
      } else {
        [...this.dialog.querySelectorAll('gv-details')].find(details => details.dataset.detailId === 'service-address.' + this.route.id)?.setAttribute('open', '');
        Ui.error('connectionSettingsError', 'Не удалось подтвердить сохранение: ' + problem.message);
        status.message = 'Черновик остался в открытой форме. Исправьте ошибку или повторите сохранение.';
      }
    } finally {
      this.saving = false;
      this.dialog.closeDisabled = false;
      this.dialog.querySelector('[data-settings-close]').disabled = false;
      this.dialog.querySelectorAll('gv-field').forEach(field => { field.disabled = false; });
      button.busy = false;
    }
  };
}
