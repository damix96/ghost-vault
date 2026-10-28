import { Ui } from './ui-components.js';

export class RelativeTime {
  static render = value => {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '????? ?? ?????????';
    const seconds = Math.round((date.getTime() - Date.now()) / 1000);
    const [unit, scale] = Math.abs(seconds) < 60 ? ['second', 1] : Math.abs(seconds) < 3600 ? ['minute', 60] : Math.abs(seconds) < 86400 ? ['hour', 3600] : ['day', 86400];
    const label = Math.abs(seconds) < 10 ? '?????? ???' : new Intl.RelativeTimeFormat('ru', { numeric: 'always' }).format(Math.trunc(seconds / scale), unit);
    return Ui.explain(label, date.toLocaleString('ru-RU', { dateStyle: 'full', timeStyle: 'long' }));
  };
}
