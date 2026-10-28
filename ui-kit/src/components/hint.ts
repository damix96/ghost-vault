import { css, html } from 'lit';
import { GvElement } from '../element.js';
import { HintState, type HintViewState } from '../models/hint-state.js';
import { HintTouch } from '../hint-touch.js';

export class GvHint extends GvElement {
  static properties = { text: {}, label: {}, copyValue: { attribute: 'copy-value' }, pinButton: { type: Boolean, attribute: 'pin-button' } };
  static styles = css`
    :host{display:inline-flex;align-items:center;white-space:normal}
    .panel{box-sizing:border-box;width:max-content;min-width:12rem;max-width:min(30rem,var(--auto-size-available-width,90vw));max-height:min(28rem,var(--auto-size-available-height,70vh));overflow:auto;background:var(--gv-hint-surface,#252b36);color:var(--gv-text);border:1px solid #526079;border-radius:.75rem;padding:1rem 1.1rem;box-shadow:0 8px 32px #0006,0 1px 3px #0004;font:400 .8125rem/1.65 var(--gv-font);text-align:left;overflow-wrap:anywhere}
    .title{font-size:.72rem;font-weight:600;color:#aabbd6;margin-bottom:.55rem;max-width:26rem;overflow-wrap:anywhere}
    .text{white-space:pre-wrap;max-width:28rem}
    .controls{display:flex;align-items:center;flex-wrap:wrap;gap:.5rem;margin-top:.8rem;padding-top:.7rem;border-top:1px solid #465064;white-space:normal}
    .copy-status{font-size:.75rem;color:#bdcfee}
    wa-popup::part(popup){z-index:1000}`;
  private static current?: GvHint;
  text = '';
  label = '';
  copyValue = '';
  private copyStatus = '';
  private copy = async () => {
    try { await navigator.clipboard.writeText(this.copyValue); this.copyStatus = '???????????'; }
    catch { this.copyStatus = '?? ??????? ???????????'; }
    this.requestUpdate();
  };
  pinButton = false;
  private readonly state = new HintState();
  private readonly touch = new HintTouch(() => this.pin());
  private anchor?: HTMLElement;
  private description?: HTMLSpanElement;
  private timer?: ReturnType<typeof setTimeout>;
  private previewTimer?: ReturnType<typeof setTimeout>;
  private restoringFocus = false;
  readonly readState = (): HintViewState => Object.freeze({ mode: this.state.mode, open: this.state.active(), pinned: this.state.pinned() });
  hide = () => this.close();

  private updateState = (action: () => void) => {
    if (this.timer) clearTimeout(this.timer);
    const before = this.state.mode;
    action();
    this.anchor?.setAttribute('aria-expanded', String(this.state.active()));
    const control = this.anchor as HTMLElement & { button?: HTMLElement };
    control?.button?.setAttribute('aria-expanded', String(this.state.active()));
    if (this.state.mode === before) return;
    const displaced = this.state.active() ? GvHint.current : undefined;
    if (this.state.active()) {
      GvHint.current = this;
    } else if (GvHint.current === this) GvHint.current = undefined;
    this.requestUpdate();
    this.emit('gv-hint-state', Object.freeze({ ...this.readState(), source: this.id }));
    if (displaced && displaced !== this) displaced.hide();
  };

  private preview = (event?: Event) => {
    if (this.restoringFocus || (event as PointerEvent | undefined)?.pointerType === 'touch') return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    if (event?.type === 'pointerenter' && !this.state.active()) this.previewTimer = setTimeout(() => this.updateState(this.state.preview), 350);
    else this.updateState(this.state.preview);
  };
  private leave = () => {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.timer = setTimeout(() => {
      if (!this.matches(':hover') && !this.shadowRoot?.activeElement && this.ownerDocument.activeElement !== this.anchor) this.updateState(this.state.leave);
    }, 150);
  };
  private pin = () => {
    if (!this.state.pinned()) this.updateState(this.state.pin);
  };
  private close = (focus = false) => {
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.touch.cancelPending();
    this.updateState(this.state.close);
    if (focus) {
      this.restoringFocus = true;
      this.anchor?.focus();
      this.restoringFocus = false;
    }
  };
  private key = (event: KeyboardEvent) => {
    if (event.composedPath().includes(this)) {
      this.touch.reset();
      if (this.anchor?.hasAttribute('data-hint-only') && ['Enter', ' '].includes(event.key)) {
        event.preventDefault();
        this.state.pinned() ? this.close(true) : this.pin();
        return;
      }
      if (event.key === 'F1' && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault();
        event.stopImmediatePropagation();
        this.pin();
        return;
      }
    }
    if (event.key !== 'Escape' || GvHint.current !== this) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.close(true);
  };
  private outside = (event: PointerEvent) => {
    this.touch.observeDown(event);
    if (this.state.active() && !event.composedPath().includes(this)) this.close();
  };
  private activated = () => {
    if (this.anchor?.hasAttribute('data-hint-only')) this.state.pinned() ? this.close(true) : this.pin();
    else this.close();
  };
  private panelAction = (event: Event) => {
    event.stopPropagation();
    if (this.state.pinned()) this.close(true);
    else this.pin();
  };
  private panelClick = (event: Event) => event.stopPropagation();

  private detach = () => {
    if (!this.anchor || !this.description) return;
    this.anchor.removeEventListener('pointerenter', this.preview);
    this.anchor.removeEventListener('pointerleave', this.leave);
    this.anchor.removeEventListener('focusin', this.preview);
    this.anchor.removeEventListener('focusout', this.leave);
    this.anchor.removeEventListener('click', this.activated);
    this.anchor.removeEventListener('click', this.touch.consumeClick, true);
    this.anchor.removeEventListener('pointerdown', this.touch.start);
    this.anchor.removeEventListener('contextmenu', this.touch.context);
    this.touch.reset();
    const remaining = (this.anchor.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(id => id && id !== this.description?.id);
    if (remaining.length) this.anchor.setAttribute('aria-describedby', remaining.join(' '));
    else this.anchor.removeAttribute('aria-describedby');
    this.description.remove();
    this.description = undefined;
    this.anchor = undefined;
  };

  private attach = () => {
    if (!this.isConnected) return;
    const anchor = this.shadowRoot?.querySelector('slot')?.assignedElements().find(element => element !== this.description) as HTMLElement | undefined;
    if (anchor === this.anchor) return;
    if (this.state.active()) this.hide();
    this.detach();
    if (!anchor || !this.isConnected || !anchor.isConnected) return;
    this.anchor = anchor;
    const description = this.ownerDocument.createElement('span');
    description.id = `gv-hint-${crypto.randomUUID()}`;
    description.hidden = true;
    description.slot = 'accessible-description';
    description.textContent = this.text;
    this.description = description;
    this.append(description);
    anchor.setAttribute('aria-describedby', [anchor.getAttribute('aria-describedby'), description.id].filter(Boolean).join(' '));
    anchor.setAttribute('aria-expanded', 'false');
    anchor.addEventListener('pointerenter', this.preview);
    anchor.addEventListener('pointerleave', this.leave);
    anchor.addEventListener('focusin', this.preview);
    anchor.addEventListener('focusout', this.leave);
    anchor.addEventListener('click', this.activated);
    anchor.addEventListener('click', this.touch.consumeClick, true);
    anchor.addEventListener('pointerdown', this.touch.start);
    anchor.addEventListener('contextmenu', this.touch.context);
    this.requestUpdate();
  };

  connectedCallback() {
    super.connectedCallback();
    this.ownerDocument.addEventListener('pointerdown', this.outside);
    this.ownerDocument.addEventListener('keydown', this.key, true);
    this.ownerDocument.addEventListener('pointermove', this.touch.move, { passive: true });
    this.ownerDocument.addEventListener('pointerup', this.touch.end);
    this.ownerDocument.addEventListener('pointercancel', this.touch.end);
    this.ownerDocument.addEventListener('scroll', this.touch.cancelPending, true);
    this.ownerDocument.defaultView?.addEventListener('blur', this.touch.reset);
    void this.updateComplete.then(this.attach);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.ownerDocument.removeEventListener('pointerdown', this.outside);
    this.ownerDocument.removeEventListener('keydown', this.key, true);
    this.ownerDocument.removeEventListener('pointermove', this.touch.move);
    this.ownerDocument.removeEventListener('pointerup', this.touch.end);
    this.ownerDocument.removeEventListener('pointercancel', this.touch.end);
    this.ownerDocument.removeEventListener('scroll', this.touch.cancelPending, true);
    this.ownerDocument.defaultView?.removeEventListener('blur', this.touch.reset);
    this.touch.reset();
    if (this.timer) clearTimeout(this.timer);
    this.close();
    this.detach();
  }

  updated() {
    if (this.description) this.description.textContent = this.text;
    if (this.anchor && !this.anchor.isConnected) this.close();
  }

  render = () => html`
    <slot @slotchange=${this.attach}></slot>
    <wa-popup .anchor=${this.anchor} .active=${Boolean(this.anchor) && this.state.active()} placement="top" flip shift hover-bridge auto-size="both" distance="8" @pointerenter=${this.preview} @pointerleave=${this.leave}>
      <div id="panel" class="panel" role=${this.state.pinned() ? 'dialog' : 'group'} aria-label=${this.label} @focusout=${this.leave}>
        <div class="title">${this.label}</div><div class="text" role=${this.state.pinned() ? 'none' : 'tooltip'}>${this.text}</div>
        ${this.state.pinned() || this.pinButton || this.copyValue ? html`<div class="controls" @click=${this.panelClick}>${this.copyValue ? html`<gv-action size="compact" label="?????????? ????????" @gv-activate=${this.copy}></gv-action><span class="copy-status" role="status">${this.copyStatus}</span>` : ''}<gv-action size="compact" .label=${this.state.pinned() ? 'Закрыть подсказку' : 'Закрепить подсказку'} @gv-activate=${this.panelAction}></gv-action></div>` : ''}
      </div>
    </wa-popup>`;
}
