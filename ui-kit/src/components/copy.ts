import { css, html, type PropertyValues } from 'lit';
import { GvElement } from '../element.js';
import { ClipboardTask } from '../models/clipboard-task.js';

export class GvCopy extends GvElement {
  static properties = { value: {}, label: {}, compact: { type: Boolean }, status: { state: true }, pending: { state: true } };
  static styles = css`
    :host{display:inline-flex;max-width:100%;vertical-align:middle}
    .control{display:flex;flex-wrap:wrap;align-items:center;gap:.4rem;max-width:100%}
    button{display:inline-flex;align-items:center;justify-content:center;gap:.4rem;min-height:2.25rem;padding:.35rem .6rem;border:1px solid transparent;border-radius:.4rem;background:transparent;color:var(--gv-muted,#a0a7b5);font:inherit;font-size:.78rem;cursor:pointer}
    button:hover{background:var(--gv-hint-surface,#2b2f39);color:var(--gv-text,#d7dbe5)}
    button:focus-visible{outline:2px solid var(--gv-focus,#8aabfa);outline-offset:2px}
    button:disabled{cursor:progress;opacity:.65}
    button[data-copied]{color:#b9d9c6}
    gv-icon{width:1rem;height:1rem}
    .label{display:grid}.label span{grid-area:1/1}.label .measure{visibility:hidden}
    .status{font-size:.75rem;color:var(--gv-text,#d7dbe5);max-width:20rem;overflow-wrap:anywhere}
    .sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
    @media(pointer:coarse){button{min-height:2.75rem;min-width:2.75rem}}
  `;
  value = '';
  label = 'Копировать';
  compact = true;
  status = '';
  pending = false;
  private timer?: ReturnType<typeof setTimeout>;
  private generation = 0;
  private readonly task = new ClipboardTask(value => navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('Clipboard unavailable')));

  private copy = async (event: Event) => {
    event.stopPropagation();
    if (this.pending) return;
    clearTimeout(this.timer);
    const value = this.value;
    const label = this.label;
    const generation = ++this.generation;
    this.pending = true;
    this.status = '';
    const copied = await this.task.copy(label, value);
    if (!this.isConnected || generation !== this.generation || value !== this.value || label !== this.label) return;
    this.pending = false;
    this.status = copied ? 'copied' : 'failed';
    this.emit('gv-copy-result', { source: label, copied });
    if (copied) this.timer = setTimeout(() => { this.status = ''; }, 2000);
  };

  willUpdate(changes: PropertyValues) {
    if (changes.has('value') || changes.has('label')) {
      clearTimeout(this.timer);
      this.generation++;
      this.task.dispose();
      this.pending = false;
      this.status = '';
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    clearTimeout(this.timer);
    this.generation++;
    this.task.dispose();
    this.pending = false;
    this.status = '';
  }

  render = () => html`<span class="control"><button type="button" aria-label=${this.label} title=${this.label} ?disabled=${this.pending} ?data-copied=${this.status === 'copied'} @click=${this.copy}><gv-icon .name=${this.status === 'copied' ? 'check' : 'copy'}></gv-icon>${this.compact ? '' : html`<span class="label"><span class="measure" aria-hidden="true">${this.label.length > 11 ? this.label : 'Скопировано'}</span><span>${this.status === 'copied' ? 'Скопировано' : this.label}</span></span>`}</button><span role="status" class=${this.status === 'failed' ? 'status' : 'sr-only'}>${this.status === 'copied' ? this.label + ': скопировано в буфер обмена' : this.status === 'failed' ? 'Не удалось скопировать. Выделите текст и скопируйте вручную.' : ''}</span></span>`;
}
