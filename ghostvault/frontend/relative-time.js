import { Ui } from './ui-components.js';

export class RelativeTime {
  static render = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return 'Время не сохранено';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const [unit, scale] = Math.abs(seconds) < 60 ? ['second', 1] : Math.abs(seconds) < 3600 ? ['minute', 60] : Math.abs(seconds) < 86400 ? ['hour', 3600] : ['day', 86400];
    const label = Math.abs(seconds) < 10 ? 'только что' : new Intl.RelativeTimeFormat('ru', { numeric: 'always' }).format(Math.trunc(seconds / scale), unit);
    return `<span data-relative-time="${date.toISOString()}">${Ui.explain(label, date.toLocaleString('ru-RU', { dateStyle: 'full', timeStyle: 'long' }))}</span>`;
  };

  static update = () => document.querySelectorAll('[data-relative-time]').forEach(node => {
    if (node.querySelector('gv-hint')?.readState?.().open || node.contains(document.activeElement)) return;
    const html = RelativeTime.render(node.dataset.relativeTime);
    const wrapper = document.createElement('template');
    wrapper.innerHTML = html;
    const next = wrapper.content.firstElementChild.innerHTML;
    if (node.innerHTML !== next) node.innerHTML = next;
  });
}
