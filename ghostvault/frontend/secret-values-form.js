import { Ui } from './ui-components.js';
import { FormFeedback } from './form-feedback.js';

export class SecretValuesForm {
  sequence = 0;
  locked = false;

  constructor(root, prefix = 'protectedValue') {
    this.root = root;
    this.prefix = prefix;
    root.addEventListener('change', this.change);
    root.addEventListener('gv-activate', this.activate);
    root.addEventListener('gv-input', event => { if (event.target.localName === 'gv-field') event.target.error = ''; });
  }

  add = (name = '', readonly = false) => {
    const id = this.prefix + this.sequence++;
    const row = document.createElement('section');
    row.className = 'app-secret-input-row';
    row.dataset.inputId = id;
    const key = Ui.field(id + 'Name', 'Имя переменной', name, (readonly ? 'readonly ' : '') + 'required autocomplete="off" placeholder="MY_API_KEY"', 'Латинские буквы A–Z, цифры и знак _.');
    const value = Ui.field(id + 'Value', 'Новое секретное значение', '', 'type="password" required autocomplete="new-password"', 'Старое значение не загружается. Пробелы сохраняются точно.');
    const multiline = '<label class="app-secret-input-option"><input type="checkbox" data-multiline> Многострочное значение</label>';
    const remove = readonly ? '' : '<gv-action data-remove-input label="Убрать поле" size="compact"></gv-action>';
    row.innerHTML = `<gv-stack>${key}${value}<div class="app-inline-actions">${multiline}${remove}</div></gv-stack>`;
    this.root.append(row);
    return row;
  };

  render = (names, readonly = true) => {
    this.clear();
    this.root.replaceChildren();
    (names.length ? names : ['']).forEach(name => this.add(name, readonly));
  };

  change = event => {
    const toggle = event.target.closest('[data-multiline]');
    if (!toggle || this.locked) return;
    const row = toggle.closest('[data-input-id]');
    const field = row.querySelector('#' + row.dataset.inputId + 'Value');
    const value = field.readValue();
    if (!toggle.checked && /[\r\n]/.test(value)) {
      toggle.checked = true;
      field.error = 'Уберите переносы строк перед переходом к однострочному вводу.';
      return;
    }
    field.type = toggle.checked ? 'textarea' : 'password';
    field.value = value;
    field.rows = 4;
  };

  activate = event => {
    const action = event.target.closest('[data-remove-input]');
    if (!action || this.locked) return;
    const row = action.closest('[data-input-id]');
    this.clearRow(row);
    row.remove();
    if (!this.root.children.length) this.add();
    this.root.querySelector('gv-field')?.focus();
  };

  values = () => [...this.root.querySelectorAll('[data-input-id]')].map(row => ({
    name: row.querySelector('#' + row.dataset.inputId + 'Name').readValue(),
    value: row.querySelector('#' + row.dataset.inputId + 'Value').readValue(),
  }));

  validate = summary => {
    const seen = new Set();
    const errors = [...this.root.querySelectorAll('[data-input-id]')].flatMap(row => {
      const name = row.querySelector('#' + row.dataset.inputId + 'Name').readValue();
      const value = row.querySelector('#' + row.dataset.inputId + 'Value').readValue();
      const error = !name ? 'Введите имя переменной.' : name.length > 128 ? 'Имя должно быть не длиннее 128 символов.' : !/^[A-Z0-9_]+$/.test(name) ? 'Используйте только A–Z, цифры и знак _.' : seen.has(name) ? 'Это имя уже есть в форме.' : '';
      seen.add(name);
      const valueError = !value.length ? 'Введите новое секретное значение.' : new TextEncoder().encode(value).byteLength > 65536 ? 'Одно значение не должно превышать 64 КиБ.' : '';
      return [[row.dataset.inputId + 'Name', error], [row.dataset.inputId + 'Value', valueError]];
    });
    return FormFeedback.check(errors, summary);
  };

  setPending = pending => {
    this.locked = pending;
    this.root.querySelectorAll('gv-field, gv-action, input').forEach(field => { field.disabled = pending; });
  };

  lockNames = () => this.root.querySelectorAll('gv-field[id$="Name"]').forEach(field => { field.readonly = true; });

  clearRow = row => row.querySelectorAll('gv-field').forEach(field => {
    if (!field.id.endsWith('Value')) return;
    field.value = '';
    field.initial = '';
    const empty = field.cloneNode(false);
    Object.assign(empty, { type: field.type, rows: field.rows, readonly: field.readonly, disabled: field.disabled });
    empty.setAttribute('value', '');
    empty.setAttribute('initial', '');
    empty.removeAttribute('error');
    field.replaceWith(empty);
  });

  clear = () => this.root.querySelectorAll('[data-input-id]').forEach(this.clearRow);
}
