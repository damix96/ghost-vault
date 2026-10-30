export class DashboardActions {
  constructor(app) {
    this.app = app;
    this.handlers = new Map([
      ['secret-copy', value => app.copyText(value)],
      ['token-copy', value => app.copyText(value)],
      ['secret-edit', key => app.openModal(key)],
      ['secret-delete', key => app.handleDeleteSecret(key)],
      ['secret-promote', key => app.handlePromoteByKey(key)],
      ['pattern-toggle', id => app.handleTogglePattern(id)],
      ['pattern-delete', id => app.handleDeletePattern(id)],
      ['session-select', id => app.inspector.selectSession(id)],
      ['session-delete', id => app.inspector.handleDeleteSession(id)],
      ['step-select', index => app.inspector.selectStep(index)],
      ['outbound-mode', (id, mode) => app.inspector.setOutboundMode(id, mode)],
      ['feed-expand', id => app.feed.toggleExpand(id)],
      ['overview-refresh', () => app.overview.refresh()],
      ['overview-session', id => app.overview.selectSession(id)],
      ['page-open', page => app.switchMainTab(page)],
      ['found-secrets', () => { app.switchMainTab('secrets'); app.switchSecretsSubTab('auto'); }],
      ['route-open', (id, trigger) => app.connections.open(id, trigger)],
      ['route-settings', (id, trigger) => app.connections.open(id, trigger, 'settings')],
      ['route-template', id => app.connections.applyPreset(id)],


      ['route-create', () => app.connections.toggleCreate(true)],
      ['route-create-cancel', () => app.connections.toggleCreate(false)],
      ['route-delete', id => app.connections.remove(id)],
      ['route-copy', (id, field) => app.connections.copy(id, field)],
      ['rule-create', () => app.modals.togglePatternModal(true)],
      ['rule-edit', id => app.ruleEditor.open(id)],
    ]);
  }

  bind = () => document.addEventListener('gv-activate', this.handle);

  handle = async event => {
    if (!(event.target instanceof Element)) return;
    const target = event.target.closest('[data-action]');
    if (!target || target.busy) return;
    const handler = this.handlers.get(target.dataset.action);
    if (!handler) return;
    const focused = target.contains(document.activeElement);
    const identity = { action: target.dataset.action, args: target.dataset.args };
    target.busy = true;
    try {
      const args = JSON.parse(target.dataset.args || '[]');
      if (Array.isArray(args)) await handler(...args, target);
    } catch (error) { this.app.showToast((target.label || 'Действие') + ': ' + error.message); }
    finally {
      target.busy = false;
      if (focused && !target.isConnected && ![...document.querySelectorAll('gv-dialog')].some(dialog => dialog.open)) {
        const current = [...document.querySelectorAll('[data-action]')].find(node => node.dataset.action === identity.action && node.dataset.args === identity.args && !node.closest('[hidden]'));
        (current || document.querySelector('#view' + this.app.activeMainTab[0].toUpperCase() + this.app.activeMainTab.slice(1) + ' gv-page'))?.focus();
      }
    }
  };
}
