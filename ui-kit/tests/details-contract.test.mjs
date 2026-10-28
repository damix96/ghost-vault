import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const { GvDetails } = await import('@ghostvault/ui-kit');
customElements.define('gv-details', GvDetails);

test('programmatic open/heading updates retain slotted content and do not echo toggle events', async () => {
  const details = document.createElement('gv-details');
  details.heading = 'Pattern regex';
  const content = document.createElement('pre');
  content.textContent = 'Synthetic pattern';
  details.append(content);
  document.body.append(details);
  await details.updateComplete;
  const control = details.shadowRoot.querySelector('wa-details');
  const observed = [];
  details.addEventListener('gv-toggle', event => { observed.push(event.detail); });
  details.open = true;
  details.heading = 'CLI instruction';
  await details.updateComplete;
  control.dispatchEvent(new Event('wa-show'));
  assert.equal(control.summary, 'CLI instruction');
  assert.equal(control.open, true);
  assert.equal(details.hasAttribute('open'), true);
  details.open = false;
  await details.updateComplete;
  control.dispatchEvent(new Event('wa-hide'));
  assert.equal(observed.length, 0);
  assert.equal(content.isConnected, true);
  assert.equal(details.firstElementChild, content);
  assert.equal(details.shadowRoot.querySelector('wa-details'), control);
  details.remove();
});

test('vendor toggle updates open synchronously and emits one immutable semantic event per transition', async () => {
  const details = document.createElement('gv-details');
  details.id = 'payload-json';
  document.body.append(details);
  await details.updateComplete;
  const control = details.shadowRoot.querySelector('wa-details');
  const events = [];
  details.addEventListener('gv-toggle', event => {
    assert.equal(details.open, event.detail.open);
    assert.equal(event.bubbles && event.composed, true);
    assert.equal(event.cancelable, false);
    assert.equal(Object.isFrozen(event.detail), true);
    events.push(event.detail);
  });
  control.open = true;
  control.dispatchEvent(new Event('wa-show'));
  control.dispatchEvent(new Event('wa-show'));
  control.open = false;
  control.dispatchEvent(new Event('wa-hide'));
  assert.deepEqual(events, [{ source: 'payload-json', open: true }, { source: 'payload-json', open: false }]);
  const nested = document.createElement('div');
  control.append(nested);
  nested.dispatchEvent(new Event('wa-show', { bubbles: true, composed: true }));
  assert.equal(events.length, 2);
  assert.equal(details.open, false);
  details.remove();
});

test.after(async () => { await GlobalRegistrator.unregister(); });
