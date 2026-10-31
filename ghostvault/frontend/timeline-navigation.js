export class TimelineNavigation {
  static render = order => '<nav class="app-timeline-navigation" aria-label="Навигация по сообщениям">' + ['start', 'end'].map((edge, index) => {
    const newest = order === 'newest' ? index === 0 : index === 1;
    const label = newest ? 'Самое новое сообщение' : 'Самое раннее сообщение';
    return `<button type="button" data-timeline-edge="${edge}" aria-label="${label}" title="${label}"><gv-icon name="chevron-down" class="${index === 0 ? 'app-nav-up' : ''}" aria-hidden="true"></gv-icon></button>`;
  }).join('') + '</nav>';

  static navigate = (root, edge) => {
    const items = [...root.querySelectorAll('[data-timeline-item]')].filter(node => node.getClientRects().length);
    const target = edge === 'start' ? items[0] : items.at(-1);
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'start', behavior: 'instant' });
  };
}
