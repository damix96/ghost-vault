import { GvAction } from './components/action.js';
import { GvField } from './components/field.js';
import { GvSelect } from './components/select.js';
import { GvIcon } from './components/icon.js';
import { GvHint } from './components/hint.js';
import { GvDialog } from './components/dialog.js';
import { GvDetails } from './components/details.js';
import { GvFeedback } from './components/feedback.js';
import { GvValue } from './components/value.js';
import { GvStack, GvGrid, GvPanel, GvPage } from './components/layout.js';

export interface RegisterOptions { iconBase?: string }
const definitions = { 'gv-action': GvAction, 'gv-field': GvField, 'gv-select': GvSelect, 'gv-icon': GvIcon, 'gv-hint': GvHint, 'gv-dialog': GvDialog, 'gv-details': GvDetails, 'gv-feedback': GvFeedback, 'gv-value': GvValue, 'gv-stack': GvStack, 'gv-grid': GvGrid, 'gv-panel': GvPanel, 'gv-page': GvPage };
let pending: Promise<void> | undefined;
let configuredBase = '';

export const registerKit = async (options: RegisterOptions = {}) => {
  if (typeof document === 'undefined' || typeof location === 'undefined' || typeof customElements === 'undefined') throw new Error('registerKit requires a browser DOM');
  const base = new URL(options.iconBase ?? './icons/', import.meta.url);
  if (base.origin !== location.origin || !['http:', 'https:'].includes(base.protocol)) throw new Error('Icons must be served from the local origin');
  if (!base.pathname.endsWith('/') || base.search || base.hash || base.username || base.password) throw new Error('Icon base must be a directory URL without query, fragment or credentials');
  if (pending && configuredBase !== base.href) throw new Error('Kit is already registered with a different icon base');
  for (const [name, constructor] of Object.entries(definitions)) {
    const existing = customElements.get(name);
    if (existing && existing !== constructor) throw new Error(`Custom element conflict: ${name}`);
  }
  if (pending) return pending;
  configuredBase = base.href;
  pending = (async () => {
    await Promise.all([
      import('@awesome.me/webawesome/dist/components/button/button.js'),
      import('@awesome.me/webawesome/dist/components/input/input.js'),
      import('@awesome.me/webawesome/dist/components/textarea/textarea.js'),
      import('@awesome.me/webawesome/dist/components/select/select.js'),
      import('@awesome.me/webawesome/dist/components/option/option.js'),
      import('@awesome.me/webawesome/dist/components/icon/icon.js'),
      import('@awesome.me/webawesome/dist/components/popup/popup.js'),
      import('@awesome.me/webawesome/dist/components/dialog/dialog.js'),
      import('@awesome.me/webawesome/dist/components/details/details.js'),
      import('@awesome.me/webawesome/dist/components/callout/callout.js'),
      import('@awesome.me/webawesome/dist/translations/ru.js')
    ]);
    const { registerIconLibrary } = await import('@awesome.me/webawesome/dist/components/icon/library.js');
    const allowed = ['info', 'x', 'copy', 'eye', 'eye-off', 'check', 'chevron-down', 'chevron-right', 'chevron-left'];
    const aliases: Record<string, string> = { xmark: 'x', 'circle-xmark': 'x', 'eye-slash': 'eye-off' };
    const resolver = (name: string) => new URL(`${allowed.includes(aliases[name] ?? name) ? aliases[name] ?? name : 'info'}.svg`, base).href;
    registerIconLibrary('gv-lucide', { resolver });
    registerIconLibrary('system', { resolver });
    registerIconLibrary('default', { resolver });
    for (const [name, constructor] of Object.entries(definitions)) if (!customElements.get(name)) customElements.define(name, constructor);
  })().catch(error => {
    pending = undefined;
    throw error;
  });
  await pending;
};
