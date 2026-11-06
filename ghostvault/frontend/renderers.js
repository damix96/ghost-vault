import { SecretTableView } from './secret-table-view.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { DisclosureState } from './disclosure-state.js';
import { SecretGroups } from './secret-groups.js';
import { SecretGroupState } from './secret-group-state.js';
import { ReadingPosition } from './reading-position.js';

export class TableRenderer {
  manual = new DisclosureState();
  automatic = new DisclosureState();
  groups = new SecretGroupState();
  pending = new Map();

  constructor() {
    document.addEventListener('focusout', this.schedule);
    document.addEventListener('selectionchange', this.schedule);
    document.addEventListener('gv-hint-state', this.schedule);
  }

  schedule = () => queueMicrotask(this.flush);
  flush = () => {
    for (const [id, update] of this.pending) this.rows(id, ...update);
  };
  renderStatus = online => {
    const status = document.getElementById('gatewayStatus');
    status.hidden = online;
    status.textContent = online ? '' : 'Нет связи с GhostVault';
  };

  renderManualRows = (secrets, query) => {
    this.rows('manualTableBody', SecretTableView.rows(secrets || [], query), this.manual);
  };

  replaceManualRows = (secrets, query) => {
    const root = document.getElementById('manualTableBody');
    this.pending.clear();
    HintLifecycle.hide(root);
    root.dataset.signature = '';
    this.manual.render(root, SecretTableView.rows(secrets || [], query));
  };

  renderAutoRows = (secrets, query) => {
    const prefixes = SecretGroups.collect(secrets || []).groups.map(group => group.prefix);
    this.rows('autoTableBody', SecretTableView.rows(secrets || [], query, true), this.automatic, { prefixes, query });
  };

  rows = (id, html, details, groups = null) => {
    const root = document.getElementById(id);
    const signature = JSON.stringify([html, groups]);
    if (root.dataset.signature === signature) { this.pending.delete(id); return; }
    if (HintLifecycle.pinned(root) || root.contains(document.activeElement) || window.getSelection()?.toString()) {
      this.pending.set(id, [html, details, groups]);
      return;
    }
    this.pending.delete(id);
    const reading = new ReadingPosition(root);
    root.dataset.signature = signature;
    details.render(root, html);
    if (groups) this.groups.render(root, groups.prefixes, groups.query);
    reading.restore();
  };
}
