import { html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { GvStringControl } from '../string-control.js';

export interface SelectOption { readonly value: string; readonly label: string; readonly disabled?: boolean }
export class GvSelect extends GvStringControl {
  static properties = { options: { attribute: false } };
  options: readonly SelectOption[] = [];

  private validate = () => {
    const seen = new Set<string>();
    for (const option of this.options) {
      if (typeof option.value !== 'string' || typeof option.label !== 'string' || /\s/.test(option.value) || seen.has(option.value)) throw new TypeError('Select options require unique string values without whitespace and text labels');
      seen.add(option.value);
    }
    return this.options;
  };

  render = () => html`<wa-select .name=${this.name} .label=${this.label} .value=${this.value} .defaultValue=${this.initial} .multiple=${false} .placeholder=${this.placeholder} .hint=${this.error || this.description} .required=${this.required} .disabled=${this.disabled} @change=${this.input}>${repeat(this.validate(), option => option.value, option => html`<wa-option .value=${option.value} .disabled=${option.disabled ?? false}>${option.label}</wa-option>`)}</wa-select>`;
}
