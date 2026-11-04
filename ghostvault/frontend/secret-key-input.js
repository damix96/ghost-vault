import { EditorValidation } from './editor-validation.js';

export class SecretKeyInput {
  composing = false;
  static normalize = value => value.replace(/[a-z]/g, letter => letter.toUpperCase()).replace(/\s/g, '_').replace(/[^A-Z0-9_]/g, '');
  constructor(field, preview) {
    this.field = field;
    this.preview = preview;
    field.addEventListener('compositionstart', () => { this.composing = true; }, true);
    field.addEventListener('compositionend', () => { this.composing = false; queueMicrotask(this.update); }, true);
    field.addEventListener('gv-input', this.update);
  }
  update = async () => {
    if (this.composing || this.field.readonly) return;
    const control = this.field.querySelector('wa-input');
    const input = control?.shadowRoot?.querySelector('input');
    const raw = this.field.value;
    const value = SecretKeyInput.normalize(raw);
    const start = SecretKeyInput.normalize(raw.slice(0, input?.selectionStart ?? raw.length)).length;
    const end = SecretKeyInput.normalize(raw.slice(0, input?.selectionEnd ?? raw.length)).length;
    this.field.value = value;
    this.field.error = '';
    this.preview.textContent = EditorValidation.keyPreview(value);
    if (raw !== value && control) {
      control.value = value;
      await control.updateComplete;
      if (this.field.value === value && input && document.activeElement === control) input.setSelectionRange(start, end);
    }
  };
}
