import { SecretTableView } from './secret-table-view.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { DisclosureState } from './disclosure-state.js';

export class TableRenderer {
  manual = new DisclosureState();
  automatic = new DisclosureState();
  renderStatus = online => {
    const status = document.getElementById('gatewayStatus');
    status.textContent = online ? 'GhostVault работает' : 'Нет связи с GhostVault';
  };

  renderManualRows = (secrets, query) => {
    this.rows('manualTableBody', SecretTableView.rows(secrets || [], query), this.manual);
  };

  renderAutoRows = (secrets, query) => {
    this.rows('autoTableBody', SecretTableView.rows(secrets || [], query, true), this.automatic);
  };

  rows = (id, html, details) => {
    const root = document.getElementById(id);
    if (root.dataset.signature === html || HintLifecycle.pinned(root) || root.contains(document.activeElement) || window.getSelection()?.toString()) return;
    root.dataset.signature = html;
    details.render(root, html);
  };
}
