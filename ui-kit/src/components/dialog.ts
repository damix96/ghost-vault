import { css, html, type PropertyValues } from 'lit';
import type WaDialog from '@awesome.me/webawesome/dist/components/dialog/dialog.js';
import { GvElement } from '../element.js';

export class GvDialog extends GvElement {
  static properties = { heading: {}, open: { type: Boolean, reflect: true }, closeDisabled: { type: Boolean, attribute: 'close-disabled', reflect: true } };
  static styles = css`:host{display:contents}wa-dialog{--width:var(--gv-dialog-width,38rem)}::slotted(form){display:block;min-width:0}`;
  heading = '';
  open = false;
  closeDisabled = false;
  private trigger?: HTMLElement;
  private fallback?: HTMLElement;
  private closing = false;
  private returnTimer?: ReturnType<typeof setTimeout>;

  willUpdate(changes: PropertyValues) {
    super.willUpdate(changes);
    if (changes.get('open') === true && !this.open && this.closeDisabled && this.isConnected) this.open = true;
    if (changes.has('open') && this.open) {
      this.closing = false;
      if (!this.trigger) this.trigger = this.ownerDocument.activeElement as HTMLElement;
    }
  }

  private startClose = (event?: Event) => {
    if (event && event.target !== event.currentTarget || this.closing) return false;
    if (this.closeDisabled) {
      event?.preventDefault();
      this.open = true;
      return false;
    }
    this.closing = true;
    this.open = false;
    this.emit('gv-close', undefined);
    return true;
  };

  private afterHide = (event: Event) => {
    if (event.target !== event.currentTarget || this.open || (event.currentTarget as WaDialog).open) return;
    this.open = false;
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = setTimeout(() => {
      this.returnTimer = undefined;
      if (!this.isConnected || this.open) return;
      const target = this.trigger?.isConnected ? this.trigger : this.fallback;
      if (target?.isConnected) target.focus();
      this.trigger = undefined;
      this.fallback = undefined;
    }, 0);
  };

  show = (trigger?: HTMLElement, fallback?: HTMLElement) => {
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = undefined;
    this.closing = false;
    this.open = true;
    this.setReturnFocus(trigger ?? this.ownerDocument.activeElement as HTMLElement, fallback);
  };

  setReturnFocus = (trigger?: HTMLElement, fallback?: HTMLElement) => {
    this.trigger = trigger;
    this.fallback = fallback;
  };
  hide = () => this.startClose();
  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.returnTimer) clearTimeout(this.returnTimer);
    this.returnTimer = undefined;
    this.trigger = undefined;
    this.fallback = undefined;
    this.open = false;
  }
  focus(options?: FocusOptions) { this.shadowRoot?.querySelector<WaDialog>('wa-dialog')?.focus(options); }
  render = () => html`<wa-dialog .label=${this.heading} .open=${this.open} .lightDismiss=${!this.closeDisabled} @wa-hide=${this.startClose} @wa-after-hide=${this.afterHide}><slot></slot><slot name="footer" slot="footer"></slot></wa-dialog>`;
}
