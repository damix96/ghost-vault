import { css, html } from 'lit';
import { GvElement } from '../element.js';

export class GvDetails extends GvElement {
  static properties = { heading: {}, open: { type: Boolean, reflect: true } };
  static styles = css`:host{display:block;min-width:0;overflow-wrap:anywhere}::slotted(*){min-width:0}`;
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
