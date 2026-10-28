import { css, html } from 'lit';
import { GvElement } from '../element.js';

export class GvStack extends GvElement {
  static properties = { direction: { reflect: true }, gap: { reflect: true } };
  static styles = css`:host{display:flex;flex-direction:column;gap:var(--gv-space);min-width:0;overflow-wrap:anywhere}:host([direction="row"]){flex-direction:row;align-items:center;flex-wrap:wrap}:host([gap="small"]){gap:var(--gv-space-small)}:host([gap="large"]){gap:var(--gv-space-large)}::slotted(*){min-width:0}`;
  direction: 'column' | 'row' = 'column';
  gap: 'small' | 'normal' | 'large' = 'normal';
  render = () => html`<slot data-direction=${this.choice(this.direction, ['column', 'row'])} data-gap=${this.choice(this.gap, ['small', 'normal', 'large'])}></slot>`;
}

export class GvGrid extends GvElement {
  static properties = { columns: { reflect: true } };
  static styles = css`:host{display:grid;grid-template-columns:minmax(0,1fr);gap:var(--gv-space-large);min-width:0}@media(min-width:48rem){:host([columns="two"]){grid-template-columns:repeat(2,minmax(0,1fr))}}::slotted(*){min-width:0}`;
  columns: 'one' | 'two' = 'two';
  render = () => html`<slot data-columns=${this.choice(this.columns, ['one', 'two'])}></slot>`;
}

export class GvPanel extends GvElement {
  static properties = { heading: {}, description: {} };
  static styles = css`:host{display:block;background:var(--gv-panel,var(--gv-surface));border:1px solid var(--gv-border);border-radius:var(--gv-radius);padding:var(--gv-space-large);min-width:0}h2{font:600 .95rem/1.4 var(--gv-font);margin:0 0 1rem;letter-spacing:.01em}p{color:var(--gv-muted);font-size:.875rem;line-height:1.6;margin:0 0 var(--gv-space)}section{min-width:0}`;
  heading = '';
  description = '';
  render = () => html`<section><h2>${this.heading}</h2>${this.description ? html`<p>${this.description}</p>` : ''}<slot></slot></section>`;
}

export class GvPage extends GvElement {
  static properties = { heading: {}, description: {} };
  static styles = css`:host{display:block;margin:auto;font-family:var(--gv-font);color:var(--gv-text)}header{display:flex;justify-content:space-between;align-items:center;gap:var(--gv-space);flex-wrap:wrap;margin-bottom:1.75rem}h1{font-size:1.5rem;line-height:1.3;font-weight:600;letter-spacing:-.035em;margin:0}p{color:var(--gv-muted);font-size:.9rem;line-height:1.6;max-width:52rem;margin:.5rem 0 0}main{min-width:0}`;
  heading = '';
  description = '';
  focus(options?: FocusOptions) { this.shadowRoot?.querySelector('h1')?.focus(options); }
  render = () => html`<header><div><h1 tabindex="-1">${this.heading}</h1>${this.description ? html`<p>${this.description}</p>` : ''}</div><slot name="actions"></slot></header><main><slot></slot></main>`;
}
