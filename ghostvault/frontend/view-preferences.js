import { HintLifecycle } from './hint-lifecycle.js';
import { ReadingPosition } from './reading-position.js';
import { SecretCache } from './secret-cache.js';

export class ViewPreferences {
  constructor(app) {
    this.app = app;
    this.mode = this.read('interface-mode', 'simple', ['simple', 'advanced']);
    this.order = this.read('message-order', 'newest', ['newest', 'oldest']);
    this.hideEncrypted = this.read('hide-encrypted', 'false', ['true', 'false']) === 'true';
  }

  read = (key, fallback, allowed) => {
    let value = fallback;
    try { value = localStorage.getItem('ghostvault.' + key); } catch {}
    return allowed.includes(value) ? value : fallback;
  };

  init = () => {
    this.apply();
    document.getElementById('interfaceSettingsBtn').addEventListener('gv-activate', () => document.getElementById('interfaceSettings').show());
    document.getElementById('interfaceMode').addEventListener('change', event => this.set('mode', event.target.checked ? 'advanced' : 'simple'));
    document.getElementById('hideEncrypted').addEventListener('change', event => this.setPrivacy(event.target.checked));
  };

  apply = () => {
    this.app.mode = this.mode;
    document.body.dataset.mode = this.mode;
    document.getElementById('interfaceMode').checked = this.mode === 'advanced';
    document.getElementById('hideEncrypted').checked = this.hideEncrypted;
    this.app.api.hideEncrypted = this.hideEncrypted;
  };

  setPrivacy = async hidden => {
    this.hideEncrypted = hidden;
    try { localStorage.setItem('ghostvault.hide-encrypted', String(hidden)); }
    catch { this.app.showToast('Настройка действует до закрытия страницы.'); }
    this.apply();
    this.app.vaultRequest++;
    this.app.manualSecrets = [];
    this.app.autoSecrets = [];
    this.app.vaultSignature = '';
    this.app.renderer.replaceManualRows([], '');
    SecretCache.invalidate(this.app);
    this.app.connectEvents();
    await this.app.fetchData();
    await this.app.overview.refresh();
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
