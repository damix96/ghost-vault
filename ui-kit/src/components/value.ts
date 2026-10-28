import { html, type PropertyValues } from 'lit';
import { GvLightElement } from '../element.js';
import { ClipboardTask } from '../models/clipboard-task.js';

export class GvValue extends GvLightElement {
  static properties = { value: {}, source: {}, label: {}, sensitive: { type: Boolean }, revealed: { state: true }, status: { state: true } };
  value = '';
  source = '';
  label = 'Значение';
  sensitive = false;
  revealed = false;
  status = '';
  private readonly task = new ClipboardTask(value => navigator.clipboard?.writeText(value) ?? Promise.reject(new Error('Clipboard unavailable')));

  private reveal = () => { this.revealed = !this.revealed; };
  private copy = async () => {
    if (this.task.state === 'pending') return;
    const source = this.source;
    const value = this.value;
    this.status = 'Копирование';
    const copied = await this.task.copy(source, value);
    if (!this.isConnected) return;
    this.requestUpdate();
    if (source !== this.source || value !== this.value) return;
    this.status = copied ? 'Значение скопировано' : 'Не удалось скопировать. Выделите показанный текст и скопируйте вручную.';
    this.emit('gv-copy-result', { source, copied });
  };

  updated(changes: PropertyValues) {
    super.updated(changes);
    if (changes.has('source') || changes.has('value')) {
      this.task.dispose();
      this.revealed = false;
      this.status = '';
    }
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this.task.dispose();
    this.revealed = false;
    this.status = '';
  }

  render = () => html`<section class="gv-value"><div class="flex flex-wrap items-center justify-between gap-3"><strong>${this.label}</strong><div class="flex flex-wrap items-center gap-2">${this.sensitive ? html`<gv-action size="compact" .label=${this.revealed ? 'Скрыть' : 'Показать'} .icon=${this.revealed ? 'eye-off' : 'eye'} @gv-activate=${this.reveal}></gv-action>` : ''}<gv-action size="compact" .label=${this.sensitive ? 'Копировать значение' : 'Копировать'} icon="copy" .busy=${this.task.state === 'pending'} @gv-activate=${this.copy}></gv-action></div></div>${this.sensitive && !this.revealed ? html`<p class="gv-value-hidden" aria-label="Значение скрыто">••••••••</p>` : html`<pre class="whitespace-pre-wrap break-words overflow-auto max-h-80">${this.value}</pre>`}<span role="status">${this.status}</span></section>`;
}
