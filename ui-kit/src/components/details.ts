import { css, html } from 'lit';
import { GvElement } from '../element.js';

export class GvDetails extends GvElement {
  static properties = { heading: {}, open: { type: Boolean, reflect: true } };
  static styles = css`
    :host{display:block;min-width:0;overflow-wrap:anywhere}
    ::slotted(*){min-width:0}
    wa-details::part(base){border:0;border-radius:0;background:transparent}
    wa-details::part(header){padding:.55rem 0;color:var(--gv-muted);font-size:var(--gv-size-label,.875rem);gap:.5rem}
    wa-details::part(header):hover{color:var(--gv-text)}
    wa-details::part(content){padding:.5rem 0 .75rem;border-top:1px solid var(--gv-border)}
    wa-details::part(summary-icon){order:-1}
  `;
  heading = '';
  open = false;

  private toggled = (event: Event) => {
    if (event.target !== event.currentTarget) return;
    const open = event.type === 'wa-show';
    if (this.open === open) return;
    this.open = open;
    this.emit('gv-toggle', Object.freeze({ source: this.id, open }));
  };

  render = () => html`<wa-details .summary=${this.heading} .open=${this.open} @wa-show=${this.toggled} @wa-hide=${this.toggled}><slot></slot></wa-details>`;
}
