import { nothing } from 'lit';
import { html, literal } from 'lit/static-html.js';
import { GvStringControl } from '../string-control.js';

export type FieldType = 'text' | 'password' | 'url' | 'email' | 'search' | 'textarea';
export class GvField extends GvStringControl {
  static properties = { type: {}, readonly: { type: Boolean }, autocomplete: {}, pattern: {}, rows: { type: Number } };
  type: FieldType = 'text';
  readonly = false;
  autocomplete = 'off';
  pattern = '';
  rows = 4;

  render = () => {
    this.choice(this.type, ['text', 'password', 'url', 'email', 'search', 'textarea']);
    const multiline = this.type === 'textarea';
    if (multiline && this.pattern) throw new TypeError('Textarea does not support native pattern; use error for domain validation');
    if (!Number.isInteger(this.rows) || this.rows < 1) throw new TypeError('Rows must be a positive integer');
    const tag = multiline ? literal`wa-textarea` : literal`wa-input`;
    return html`<${tag} .name=${this.name} .label=${this.label} .value=${this.value} .defaultValue=${this.initial} type=${multiline ? nothing : this.type} rows=${multiline ? this.rows : nothing} resize=${multiline ? 'vertical' : nothing} pattern=${!multiline && this.pattern ? this.pattern : nothing} .placeholder=${this.placeholder} .hint=${this.error} .required=${this.required} .disabled=${this.disabled} .readonly=${this.readonly} .autocomplete=${this.autocomplete} @input=${this.input}>${this.description ? html`<span slot="label"><gv-hint .label=${this.label} .text=${this.description}><span tabindex="0" role="button" data-hint-only style="border-bottom:1px dotted var(--gv-muted);cursor:help">${this.label}</span></gv-hint></span>` : nothing}</${tag}>`;
  };
}
