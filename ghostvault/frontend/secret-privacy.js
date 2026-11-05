import { SecretCache } from './secret-cache.js';

export class SecretPrivacy {
  static clearField = field => {
    if (!field) return;
    field.value = '';
    field.initial = '';
    const empty = field.cloneNode(false);
    empty.setAttribute('value', '');
    empty.setAttribute('initial', '');
    Object.assign(empty, { type: field.type, rows: field.rows, readonly: field.readonly, disabled: field.disabled });
    field.replaceWith(empty);
  };

  static forget = (app, key) => {
    app.modals.drafts.delete(key);
    if (app.secretRename.committed?.key === key) app.secretRename.committed = app.manualSecrets.find(secret => secret.key === key && secret.isSecret) || null;
    if (document.getElementById('modalKeyInput')?.value === key && (!app.modals.sensitive || !document.getElementById('secretModal')?.open)) SecretPrivacy.clearField(document.getElementById('modalValInput'));
  };

  static refresh = app => {
    app.vaultSignature = '';
    app.renderer.replaceManualRows(app.manualSecrets, app.searchQuery);
  };

  static observe = app => {
    const protectedEntries = app.manualSecrets.filter(secret => secret.isSecret);
    const changed = protectedEntries.some(secret => !app.protectedKeys?.has(secret.key));
    app.protectedKeys = new Set(protectedEntries.map(secret => secret.key));
    if (changed) SecretCache.invalidate(app);
    protectedEntries.forEach(secret => {
    SecretPrivacy.forget(app, secret.key);
    const row = [...document.querySelectorAll('[data-secret-record]')].find(node => node.dataset.secretRecord === secret.key);
    if (row && row.dataset.secretProtected !== 'true') SecretPrivacy.refresh(app);
    if (app.modals.editingKey === secret.key && !app.modals.sensitive && !app.modals.pending.has('secret')) {
      app.modals.saved = true;
      document.getElementById('secretModal').hide();
      app.showToast('Переменная защищена. Для изменения откройте «Заменить значение».');
    }
    });
  };
}
