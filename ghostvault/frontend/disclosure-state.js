export class DisclosureState {
  root = null;
  opened = new Set();

  nativeToggle = event => {
    const target = event.target;
    if (!target.matches?.('details[data-detail-id]')) return;
    target.open ? this.opened.add(target.dataset.detailId) : this.opened.delete(target.dataset.detailId);
  };

  observe = event => {
    const target = event.target.closest('gv-details[data-detail-id]');
    if (!target) return;
    const key = target.dataset.detailId;
    event.detail.open ? this.opened.add(key) : this.opened.delete(key);
  };

  render = (root, html) => {
    if (root !== this.root) {
      this.root?.removeEventListener('gv-toggle', this.observe);
      this.root?.removeEventListener('toggle', this.nativeToggle, true);
      this.root = root;
      root.addEventListener('gv-toggle', this.observe);
      root.addEventListener('toggle', this.nativeToggle, true);
    }
    root.innerHTML = html;
    root.querySelectorAll('gv-details[data-detail-id]').forEach(details => { details.open = this.opened.has(details.dataset.detailId); });
    root.querySelectorAll('details[data-detail-id]').forEach(details => { details.open = this.opened.has(details.dataset.detailId); });
  };

  dispose = () => {
    this.root?.removeEventListener('gv-toggle', this.observe);
    this.root?.removeEventListener('toggle', this.nativeToggle, true);
    this.root = null;
    this.opened.clear();
  };
}
