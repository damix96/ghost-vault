import { HintLifecycle } from './hint-lifecycle.js';
import { ReadingPosition } from './reading-position.js';

export class ViewPreferences {
  constructor(app) {
    this.app = app;
    this.mode = this.read('interface-mode', 'simple', ['simple', 'advanced']);
    this.order = this.read('message-order', 'newest', ['newest', 'oldest']);
  }

  read = (key, fallback, allowed) => {
    let value = fallback;
    try { value = localStorage.getItem('ghostvault.' + key); } catch {}
    return allowed.includes(value) ? value : fallback;
  };

  init = () => {
    this.apply();
    document.getElementById('interfaceMode').addEventListener('change', event => this.set('mode', event.target.checked ? 'advanced' : 'simple'));
  };

  apply = () => {
    this.app.mode = this.mode;
    document.body.dataset.mode = this.mode;
    document.getElementById('interfaceMode').checked = this.mode === 'advanced';
  };

  set = (field, value) => {
    if (!({ mode: ['simple', 'advanced'], order: ['newest', 'oldest'] })[field]?.includes(value)) return;
    this[field] = value;
    const reading = new ReadingPosition(document.getElementById('overviewConversation'));
    try { localStorage.setItem('ghostvault.' + (field === 'mode' ? 'interface-mode' : 'message-order'), value); }
    catch { this.app.showToast('Выбор действует до закрытия страницы: браузер не разрешил сохранить настройку.'); }
    HintLifecycle.hide(document.getElementById('overviewConversation'));
    this.apply();
    this.app.overview.renderConversation(true, reading);
  };
}
