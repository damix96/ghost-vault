import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const kit = await import('@ghostvault/ui-kit');
const { html, render } = await import('lit');
class InputContractDouble extends HTMLElement {
  value = '';
  validationMessage = '';
  setCustomValidity = message => { this.validationMessage = message; };
}
customElements.define('wa-input', InputContractDouble);
customElements.define('gv-action', kit.GvAction);
customElements.define('gv-field', kit.GvField);
customElements.define('gv-value', kit.GvValue);
customElements.define('gv-hint', kit.GvHint);
customElements.define('gv-dialog', kit.GvDialog);

test('action emits a semantic event once; busy and submit do not emit it', async () => {
  const action = document.createElement('gv-action');
  action.label = 'Configure';
  action.id = 'synthetic-route';
  document.body.append(action);
  await action.updateComplete;
  const observed = [];
  action.addEventListener('gv-activate', event => { observed.push(event); });
  action.querySelector('wa-button').dispatchEvent(new Event('click'));
  assert.equal(observed.length, 1);
  assert.deepEqual(observed[0].detail, { source: 'synthetic-route' });
  assert.equal(observed[0].bubbles && observed[0].composed, true);
  action.busy = true;
  await action.updateComplete;
  action.querySelector('wa-button').dispatchEvent(new Event('click'));
  action.busy = false;
  action.type = 'submit';
  await action.updateComplete;
  action.querySelector('wa-button').dispatchEvent(new Event('click'));
  assert.equal(observed.length, 1);
  action.remove();
});

test('unchanged input retains control identity; input publishes exact value', async () => {
  const host = document.createElement('div');
  document.body.append(host);
  const paint = value => render(html`<gv-field name="query" label="Query" .value=${value}></gv-field>`, host);
  paint('synthetic');
  const field = host.querySelector('gv-field');
  await field.updateComplete;
  const input = field.querySelector('wa-input');
  paint('synthetic');
  await field.updateComplete;
  assert.equal(field.querySelector('wa-input'), input);
  const observed = [];
  field.addEventListener('gv-input', event => { observed.push(event.detail); });
  input.value = '  draft <tag>  ';
  input.dispatchEvent(new Event('input'));
  assert.deepEqual(observed, [{ name: 'query', value: '  draft <tag>  ' }]);
  assert.equal(field.readValue(), '  draft <tag>  ');
  host.remove();
});

test('unknown payload is escaped and a masked secret is absent from rendered text', async () => {
  const value = document.createElement('gv-value');
  value.value = '<img src=x onerror=alert(1)>';
  value.source = 'synthetic:v1';
  document.body.append(value);
  await value.updateComplete;
  assert.equal(value.querySelector('img'), null);
  assert.equal(value.querySelector('pre').textContent, value.value);
  value.sensitive = true;
  await value.updateComplete;
  assert.equal(value.querySelector('pre'), null);
  assert.equal(value.textContent.includes(value.value), false);
  value.remove();
});

test('hint description is in the same DOM scope and is removed on disconnect', async () => {
  const hint = document.createElement('gv-hint');
  hint.text = 'Contextual explanation';
  hint.label = 'Configure';
  const trigger = document.createElement('button');
  trigger.textContent = 'Configure';
  hint.append(trigger);
  document.body.append(hint);
  await hint.updateComplete;
  const id = trigger.getAttribute('aria-describedby');
  assert.equal(document.getElementById(id)?.textContent, hint.text);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, composed: true, cancelable: true }));
  await hint.updateComplete;
  assert.equal(hint.readState().pinned, true);
  trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, composed: true }));
  await hint.updateComplete;
  assert.equal(hint.shadowRoot.querySelector('wa-popup').active, false);
  assert.equal(trigger.getAttribute('aria-expanded'), 'false');
  hint.remove();
  assert.equal(trigger.hasAttribute('aria-describedby'), false);
  assert.equal(document.getElementById(id), null);
});

test('dialog close invalidates consumer work before animation; repeated hide is idempotent', async () => {
  const dialog = document.createElement('gv-dialog');
  document.body.append(dialog);
  const closed = [];
  dialog.addEventListener('gv-close', event => { closed.push(event); });
  dialog.show();
  await dialog.updateComplete;
  dialog.hide();
  assert.equal(closed.length, 1);
  assert.equal(dialog.open, false);
  dialog.hide();
  assert.equal(closed.length, 1);
  await dialog.updateComplete;
  dialog.remove();
});

test('late hide animation cannot close a reopened dialog context', async () => {
  const dialog = document.createElement('gv-dialog');
  document.body.append(dialog);
  dialog.show();
  await dialog.updateComplete;
  dialog.hide();
  await dialog.updateComplete;
  const vendor = dialog.shadowRoot.querySelector('wa-dialog');
  dialog.show();
  vendor.dispatchEvent(new Event('wa-after-hide'));
  assert.equal(dialog.open, true);
  await dialog.updateComplete;
  dialog.remove();
});

test.after(async () => { await GlobalRegistrator.unregister(); });
