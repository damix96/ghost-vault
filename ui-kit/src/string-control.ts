import type { PropertyDeclarations, PropertyValues } from 'lit';
import { GvLightElement } from './element.js';

export type VendorStringControl = HTMLElement & { value: string | string[] | null; updateComplete?: Promise<unknown>; setCustomValidity: (message: string) => void };

export class GvStringControl extends GvLightElement {
  static properties: PropertyDeclarations = { name: {}, label: {}, value: {}, initial: {}, description: {}, error: {}, placeholder: {}, required: { type: Boolean }, disabled: { type: Boolean } };
  name = '';
  label = '';
  value = '';
  initial = '';
  description = '';
  error = '';
  placeholder = '';
  required = false;
  disabled = false;
  private form?: HTMLFormElement;
  private previousControl?: VendorStringControl;
  protected control = () => this.querySelector<VendorStringControl>('wa-input,wa-textarea,wa-select');
  readValue = () => {
    const value = this.control()?.value;
    if (Array.isArray(value)) throw new TypeError('This control only supports one string value');
    return value ?? this.value;
  };

  protected input = () => {
    this.value = this.readValue();
    this.emit('gv-input', { name: this.name, value: this.value });
  };

  private reset = (event: Event) => queueMicrotask(() => {
    if (event.defaultPrevented || !this.isConnected) return;
    this.value = this.control() ? this.readValue() : this.initial;
    this.emit('gv-input', { name: this.name, value: this.value, reason: 'reset' });
  });

  connectedCallback() {
    super.connectedCallback();
    this.form = this.closest('form') ?? undefined;
    this.form?.addEventListener('reset', this.reset);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.form?.removeEventListener('reset', this.reset);
    this.form = undefined;
    this.previousControl = undefined;
  }

  updated(changes: PropertyValues) {
    super.updated(changes);
    const control = this.control();
    if (control && (changes.has('error') || control !== this.previousControl)) {
      void (control.updateComplete ?? Promise.resolve()).then(() => {
        if (this.isConnected && this.control() === control) control.setCustomValidity(this.error);
      });
    }
    this.previousControl = control ?? undefined;
  }

  focus(options?: FocusOptions) { this.control()?.focus(options); }
}
