export class ReadingPosition {
  constructor(root) {
    this.root = root;
    this.x = window.scrollX;
    this.y = window.scrollY;
    const candidates = [...root.querySelectorAll('[data-reading-key]')].filter(item => item.getBoundingClientRect().height > 0);
    const node = candidates.find(item => { const box = item.getBoundingClientRect(); return box.top >= 0 && box.top < innerHeight; }) || candidates.find(item => item.getBoundingClientRect().bottom > 100);
    this.key = node?.dataset.readingKey;
    this.offset = node?.getBoundingClientRect().top;
  }

  restore = () => {
    const node = [...this.root.querySelectorAll('[data-reading-key]')].find(item => item.dataset.readingKey === this.key);
    window.scrollTo(this.x, node && this.offset !== undefined ? window.scrollY + node.getBoundingClientRect().top - this.offset : this.y);
  };
}
