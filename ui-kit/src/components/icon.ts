import { html } from 'lit';
import { GvLightElement } from '../element.js';

export type IconName = 'info' | 'x' | 'copy' | 'eye' | 'eye-off' | 'check' | 'chevron-down' | 'chevron-right' | 'chevron-left';
export class GvIcon extends GvLightElement {
  static properties = { name: {}, label: {} };
  name: IconName = 'info';
  label = '';
  render = () => html`<wa-icon library="gv-lucide" .name=${this.choice(this.name, ['info', 'x', 'copy', 'eye', 'eye-off', 'check', 'chevron-down', 'chevron-right', 'chevron-left'])} .label=${this.label}></wa-icon>`;
}
