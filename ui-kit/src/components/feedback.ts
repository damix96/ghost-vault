import { html } from 'lit';
import { GvLightElement } from '../element.js';

export type FeedbackState = 'info' | 'loading' | 'empty' | 'unknown' | 'stale' | 'error' | 'success';
export class GvFeedback extends GvLightElement {
  static properties = { state: {}, message: {} };
  state: FeedbackState = 'info';
  message = '';
  render = () => html`<wa-callout .variant=${{ info: 'neutral', loading: 'neutral', empty: 'neutral', unknown: 'warning', stale: 'warning', error: 'danger', success: 'success' }[this.choice(this.state, ['info', 'loading', 'empty', 'unknown', 'stale', 'error', 'success'])]} role=${this.state === 'error' ? 'alert' : 'status'}>${this.message}</wa-callout>`;
}
