export class DisclosureState {
  root = null;
  opened = new Set();

  observe = event => {
    const target = event.target.closest('gv-details[data-detail-id]');
    if (!target) return;
    const key = target.dataset.detailId;
    event.detail.open ? this.opened.add(key) : this.opened.delete(key);
  };

  render = (root, html) => {
    if (root !== this.root) {
      this.root?.removeEventListener('gv-toggle', this.observe);
      this.root = root;
      root.addEventListener('gv-toggle', this.observe);
    }
    root.innerHTML = html;
    root.querySelectorAll('gv-details[data-detail-id]').forEach(details => { details.open = this.opened.has(details.dataset.detailId); });
  };

  dispose = () => {
    this.root?.removeEventListener('gv-toggle', this.observe);
    this.root = null;
    this.opened.clear();
  };
}
