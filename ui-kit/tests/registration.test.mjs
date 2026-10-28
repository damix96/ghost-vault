import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const kit = await import('@ghostvault/ui-kit');

test('public import has no registration; setup is explicit and idempotent', async () => {
  assert.equal(customElements.get('gv-action'), undefined);
  const panel = document.createElement('gv-panel');
  panel.heading = 'Pre-upgrade heading';
  document.body.append(panel);
  await kit.registerKit({ iconBase: 'http://localhost:5178/icons/' });
  await kit.registerKit({ iconBase: 'http://localhost:5178/icons/' });
  assert.equal(customElements.get('gv-action'), kit.GvAction);
  assert.ok(customElements.get('wa-input'));
  assert.equal(customElements.get('gv-select'), kit.GvSelect);
  assert.ok(customElements.get('wa-textarea'));
  assert.ok(customElements.get('wa-select'));
  assert.equal(customElements.get('gv-details'), kit.GvDetails);
  assert.ok(customElements.get('wa-details'));
  await panel.updateComplete;
  assert.equal(panel.shadowRoot.querySelector('h2').textContent, 'Pre-upgrade heading');
  panel.remove();
  await assert.rejects(kit.registerKit({ iconBase: 'https://remote.invalid/icons/' }), /local origin/);
  await assert.rejects(kit.registerKit({ iconBase: 'http://localhost:5178/icons' }), /directory URL/);
  await assert.rejects(kit.registerKit({ iconBase: 'http://localhost:5178/other/' }), /different icon base/);
  const { getIconLibrary } = await import('@awesome.me/webawesome/dist/components/icon/library.js');
  for (const name of ['gv-lucide', 'system', 'default']) assert.equal(getIconLibrary(name).resolver('copy'), 'http://localhost:5178/icons/copy.svg');
  for (const name of ['chevron-right', 'chevron-left']) assert.equal(getIconLibrary('system').resolver(name), `http://localhost:5178/icons/${name}.svg`);
});

test.after(async () => { await GlobalRegistrator.unregister(); });
