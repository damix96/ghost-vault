import { SecretInputView } from './secret-input-view.js';
import { SecretValuesForm } from './secret-values-form.js';
import { SecretErrors } from './secret-errors.js';
import { Ui } from './ui-components.js';
import { SecretCleanup } from './secret-cleanup.js';

export class SecretInputPage {
  generation = 0;
  pending = false;
  review = false;
  finished = false;

  constructor(adapter) { this.adapter = adapter; }

  init = async () => {
    document.body.innerHTML = SecretInputView.shell();
    this.form = document.getElementById('secretInputForm');
    this.inputs = new SecretValuesForm(document.getElementById('secretInputRows'), 'intakeValue');
    this.submit = this.form.querySelector('[type="submit"]');
    this.cancel = document.getElementById('secretInputCancel');
    this.add = document.getElementById('secretInputAdd');
    this.form.hidden = true;
    this.form.addEventListener('submit', this.save);
    this.cancel.addEventListener('gv-activate', this.cancelInput);
    this.add.addEventListener('gv-activate', () => { if (!this.pending) this.inputs.add().querySelector('gv-field').focus(); });
    window.addEventListener('pagehide', this.dispose);
    const generation = ++this.generation;
    this.status('Открываем форму…', 'loading');
    try {
      const context = await this.adapter.load();
      if (generation !== this.generation) return;
      if (this.terminal(context.state, context.error, context.notice)) return;
      this.inputs.render(context.names || [], !context.editableNames);
      this.add.hidden = !context.editableNames;
      document.getElementById('secretInputPage').heading = context.operation === 'update' ? 'Обновить секретные значения' : 'Добавить секретные значения';
      if (context.operation === 'update') document.getElementById('secretInputExplanation').textContent = 'Новые значения заменят сохранённые значения указанных переменных. Обычные переменные тоже станут защищёнными. Старые значения в эту форму не загружаются.';
      this.review = Boolean(context.review);
      this.submit.label = this.review ? 'Проверить результат' : 'Сохранить значения';
      this.lock(false);
      this.form.hidden = false;
      this.status('');
      if (this.review) this.status('Сохранение ещё выполняется. Проверьте результат; повторно отправлять значения не нужно.');
      if (context.error) Ui.error('secretInputError', context.error);
      this.inputs.root.querySelector('gv-field')?.focus();
    } catch (error) {
      if (generation !== this.generation) return;
      if (!this.terminal(error.terminal, SecretErrors.message(error))) this.status('Не удалось открыть форму: ' + SecretErrors.message(error), 'error');
    }
  };

  status = (message, state = 'info') => {
    const status = document.getElementById('secretInputStatus');
    status.state = state;
    status.message = message;
    status.hidden = !message;
  };

  terminal = (state, message = '', notice) => {
    const outcomes = {
      completed: ['Секретные значения сохранены', 'Значения защищены и доступны через соответствующие подстановки. Можно закрыть страницу.'],
      cancelled: ['Ввод отменён', 'Введённые значения очищены из формы. Можно закрыть страницу.'],
      expired: ['Срок действия формы истёк', 'Введённые значения очищены. Откройте новую форму для продолжения.'],
      unavailable: ['Форма больше недоступна', 'Введённые значения очищены. Проверьте переменные перед повторным вводом: сервер мог перезапуститься после сохранения.'],
      failed: ['Значения не сохранены', (message || 'Не удалось завершить сохранение.') + ' Введённые значения очищены. После устранения причины откройте новую форму.'],
    };
    if (!outcomes[state]) return false;
    this.finished = true;
    this.review = false;
    this.inputs.clear();
    this.inputs.root.replaceChildren();
    this.form.hidden = true;
    this.status('');
    const result = document.getElementById('secretInputResult');
    result.innerHTML = SecretInputView.result(...outcomes[state], ['expired', 'unavailable', 'failed'].includes(state) ? this.adapter.restartUrl?.() : '');
    if (state === 'completed' && notice?.code === 'SECRET_STORAGE_CLEANUP_PENDING') {
      const warning = document.createElement('gv-feedback');
      warning.id = 'secretInputCleanupNotice';
      warning.state = 'unknown';
      warning.message = notice.historical ? 'Значения сохранены и защищены. После записи не удалось подтвердить очистку прежних открытых копий в рабочей базе. Проверьте актуальное состояние очистки на странице переменных.' : SecretCleanup.message;
      result.append(warning);
    }
    result.hidden = false;
    result.focus();
    this.adapter.forget?.();
    return true;
  };

  lock = pending => {
    this.pending = pending;
    this.inputs.setPending(pending || this.review);
    this.submit.busy = pending;
    this.cancel.disabled = pending;
    this.add.disabled = pending || this.review || Boolean(this.adapter.namesLocked?.());
    if (this.adapter.namesLocked?.()) this.inputs.lockNames();
  };

  save = async event => {
    event.preventDefault();
    if (this.pending || this.finished) return;
    if (!this.review && (!this.inputs.validate(document.getElementById('secretInputError')) || !this.form.reportValidity())) return;
    const generation = this.generation;
    this.lock(true);
    Ui.error('secretInputError', '');
    try {
      const outcome = this.review ? await this.adapter.status() : await this.adapter.save(this.inputs.values());
      if (generation !== this.generation) return;
      if (!this.terminal(outcome.state, outcome.error, outcome.notice)) {
        this.review = Boolean(outcome.review);
        Ui.error('secretInputError', this.review ? 'Результат пока не подтверждён. Проверьте его ещё раз; значения не отправляются повторно.' : 'Сохранение не завершено. Проверьте введённые значения и повторите попытку.');
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if (!this.terminal(error.terminal, SecretErrors.message(error))) {
        this.review ||= Boolean(error.uncertain);
        Ui.error('secretInputError', SecretErrors.message(error) + (this.review ? ' Проверьте результат перед повторным вводом.' : ''));
      }
    } finally {
      if (generation === this.generation) {
        this.submit.label = this.review ? 'Проверить результат' : 'Сохранить значения';
        this.lock(false);
      }
    }
  };

  cancelInput = async () => {
    if (this.pending || this.finished) return;
    this.inputs.clear();
    const generation = this.generation;
    this.lock(true);
    try {
      const outcome = await this.adapter.cancel();
      if (generation === this.generation && !this.terminal(outcome.state, outcome.error, outcome.notice)) {
        this.review = true;
        this.submit.label = 'Проверить результат';
        Ui.error('secretInputError', 'Значения очищены. Отмена пока не подтверждена; проверьте результат.');
      }
    } catch (error) {
      if (generation !== this.generation) return;
      if (!this.terminal(error.terminal, SecretErrors.message(error))) {
        this.review ||= Boolean(error.uncertain);
        this.submit.label = this.review ? 'Проверить результат' : 'Сохранить значения';
        Ui.error('secretInputError', 'Введённые значения очищены. Не удалось подтвердить отмену: ' + SecretErrors.message(error));
      }
    } finally { if (generation === this.generation) this.lock(false); }
  };

  dispose = () => {
    this.generation++;
    this.inputs.clear();
    this.inputs.root.replaceChildren();
    this.adapter.forget?.();
  };
}
