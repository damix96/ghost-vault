import { LitElement } from 'lit';
import type { KitEventMap } from './events.js';

export class GvElement extends LitElement {
  static kitVersion = '0.1.0';
  protected emit = <K extends keyof KitEventMap>(name: K, detail: KitEventMap[K]['detail']) => this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  protected choice = <T extends string>(value: T, allowed: readonly T[]): T => {
    if (!allowed.includes(value)) throw new TypeError(`Unsupported component option: ${value}`);
    return value;
  };
}

export class GvLightElement extends GvElement {
  createRenderRoot = () => this;
}
