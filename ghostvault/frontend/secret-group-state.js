export class SecretGroupState {
  root = null;
  opened = new Set();
  searched = new Map();
  applied = new WeakMap();
  query = '';

  observe = event => {
    const group = event.target;
    if (!group.matches?.('details[data-secret-group]') || !this.root.contains(group) || this.applied.get(group) === group.open) return;
    this.applied.set(group, group.open);
    const prefix = group.dataset.secretGroup;
    if (this.query) this.searched.set(prefix, group.open);
    else group.open ? this.opened.add(prefix) : this.opened.delete(prefix);
  };

  render = (root, prefixes, query) => {
    if (root !== this.root) {
      this.root?.removeEventListener('toggle', this.observe, true);
      this.root = root;
      root.addEventListener('toggle', this.observe, true);
    }
    const next = (query || '').toLowerCase().trim();
    if (next !== this.query) this.searched.clear();
    this.query = next;
    const present = new Set(prefixes);
    for (const prefix of this.opened) if (!present.has(prefix)) this.opened.delete(prefix);
    for (const prefix of this.searched.keys()) if (!present.has(prefix)) this.searched.delete(prefix);
    root.querySelectorAll('details[data-secret-group]').forEach(group => {
      const prefix = group.dataset.secretGroup;
      const open = this.query ? this.searched.get(prefix) ?? true : this.opened.has(prefix);
      this.applied.set(group, open);
      group.open = open;
    });
  };

  reveal = card => {
    const group = card.closest('details[data-secret-group]');
    if (!group) return;
    this.opened.add(group.dataset.secretGroup);
    if (this.query) this.searched.set(group.dataset.secretGroup, true);
    this.applied.set(group, true);
    group.open = true;
  };
}
