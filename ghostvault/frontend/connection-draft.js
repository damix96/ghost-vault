import { Ui } from './ui-components.js';
import { FormFeedback } from './form-feedback.js';
import slugify from 'slugify';

export class ConnectionDraft {
  static reserved = ['api', 'health', 'dashboard', 'zen'];

  static used = routes => new Set([...ConnectionDraft.reserved, ...routes.map(route => route.prefix?.replace(/^\/+|\/+$/g, '') || new URL(route.cliUrl || route.incomingUrl).pathname.replace(/^\/|\/v1\/?$/g, ''))]);

  static read = routes => {
    const upstreamUrl = Ui.read('connectionUpstream').trim();
    const error = FormFeedback.httpError(upstreamUrl);
    const name = Ui.read('connectionName').trim();
    const used = ConnectionDraft.used(routes.filter(route => !route.isUnusedPreset));
    const base = slugify(name || 'opencode', { lower: true, strict: true }) || 'connection';
    let automatic = base;
    let number = 2;
    while (used.has(automatic)) automatic = base + '-' + number++;
    return { payload: { name, prefix: automatic, upstreamUrl, suffix: '' }, errors: [['connectionName', name ? '' : 'Введите название'], ['connectionUpstream', error]] };
  };
}
