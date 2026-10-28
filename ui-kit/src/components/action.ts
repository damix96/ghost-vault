import { html, type PropertyValues } from 'lit';
import type WaButton from '@awesome.me/webawesome/dist/components/button/button.js';
import { GvLightElement } from '../element.js';

export type ActionTone = 'primary' | 'neutral' | 'danger';
export type ActionSize = 'normal' | 'compact';
export class GvAction extends GvLightElement {
  static properties = { label: {}, tone: {}, type: {}, disabled: { type: Boolean }, busy: { type: Boolean }, hint: {}, hintPinButton: { type: Boolean, attribute: 'hint-pin-button' }, icon: {}, size: {}, pressed: { attribute: false }, current: { type: Boolean } };
  label = '';
  tone: ActionTone = 'neutral';
  type: 'button' | 'submit' = 'button';
  disabled = false;
  busy = false;
  hint = '';
  hintPinButton = false;
  icon = '';
  size: ActionSize = 'normal';
  pressed: boolean | undefined = undefined;
  current = false;

  private activate = () => {
    if (this.disabled || this.busy || this.type === 'submit') return;
    this.emit('gv-activate', { source: this.id });
  };

  private control = () => html`<wa-button .type=${this.choice(this.type, ['button', 'submit'])} .variant=${this.tone === 'neutral' && (this.pressed || this.current) ? 'brand' : { primary: 'brand', neutral: 'neutral', danger: 'danger' }[this.choice(this.tone, ['primary', 'neutral', 'danger'])]} .appearance=${this.tone === 'neutral' && !this.pressed && !this.current ? 'outlined' : 'filled'} .size=${this.choice(this.size, ['normal', 'compact']) === 'compact' ? 's' : 'm'} .disabled=${this.disabled || this.busy} .loading=${this.busy} @click=${this.activate}>${this.icon ? html`<gv-icon slot="start" .name=${this.icon}></gv-icon>` : ''}${this.label}</wa-button>`;

  updated(changes: PropertyValues) {
    super.updated(changes);
    const control = this.querySelector<WaButton>('wa-button');
    void Promise.resolve(control?.updateComplete).then(() => {
      if (!this.isConnected || this.querySelector('wa-button') !== control) return;
      const target = control?.button;
      if (!target) return;
      if (this.pressed === undefined) target.removeAttribute('aria-pressed');
      else target.setAttribute('aria-pressed', String(this.pressed));
      if (this.current) target.setAttribute('aria-current', 'page');
      else target.removeAttribute('aria-current');
      if (this.hint) target.setAttribute('aria-keyshortcuts', 'F1');
      else target.removeAttribute('aria-keyshortcuts');
    });
  }

  focus(options?: FocusOptions) { this.querySelector<HTMLElement>('wa-button')?.focus(options); }

  render = () => this.hint ? html`<gv-hint .text=${this.hint} .label=${this.label} .pinButton=${this.hintPinButton}>${this.control()}</gv-hint>` : this.control();
}
