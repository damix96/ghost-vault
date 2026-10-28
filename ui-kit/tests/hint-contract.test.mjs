import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const { GvHint } = await import('@ghostvault/ui-kit');
customElements.define('gv-hint', GvHint);

class HintFixture {
  hint = document.createElement('gv-hint');
  trigger = document.createElement('button');
  constructor(id) {
    this.hint.id = id;
    this.hint.text = 'Synthetic explanation';
    this.hint.label = 'Configure';
    this.trigger.textContent = 'Configure';
    this.hint.append(this.trigger);
  }
  mount = async (parent = document.body) => {
    parent.append(this.hint);
    await this.hint.updateComplete;
    await this.hint.updateComplete;
  };
  pin = () => this.trigger.dispatchEvent(new KeyboardEvent('keydown', { key: 'F1', bubbles: true, composed: true, cancelable: true }));
  dispose = () => this.hint.remove();
}

test('read-only snapshot and semantic notification are synchronous; repeated hide/preview do not duplicate', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = new HintFixture('synthetic-hint');
  const events = [];
  fixture.hint.addEventListener('gv-hint-state', event => {
    events.push(event.detail);
    assert.equal(event.bubbles && event.composed, true);
    assert.equal(event.cancelable, false);
    assert.deepEqual(fixture.hint.readState(), { mode: event.detail.mode, open: event.detail.open, pinned: event.detail.pinned });
    assert.equal(Object.isFrozen(event.detail), true);
  });
  const initial = fixture.hint.readState();
  assert.deepEqual(initial, { mode: 'closed', open: false, pinned: false });
  assert.throws(() => { initial.pinned = true; }, TypeError);
  await fixture.mount();
  fixture.trigger.dispatchEvent(new Event('pointerenter'));
  fixture.trigger.dispatchEvent(new Event('pointerenter'));
  assert.equal(fixture.hint.readState().open, false);
  t.mock.timers.tick(350);
  fixture.pin();
  assert.equal(fixture.hint.readState().pinned, true);
  fixture.hint.hide();
  fixture.hint.hide();
  assert.deepEqual(events.map(event => event.mode), ['preview', 'pinned', 'closed']);
  assert.equal(events.every(event => event.source === 'synthetic-hint'), true);
  assert.equal(initial.mode, 'closed');
  fixture.dispose();
});

test('displacing a pinned hint preserves observable pinned state until the replacement is open', async () => {
  const parent = document.createElement('div');
  document.body.append(parent);
  const first = new HintFixture('first');
  const second = new HintFixture('second');
  await first.mount(parent);
  await second.mount(parent);
  first.pin();
  const blocked = [];
  parent.addEventListener('gv-hint-state', () => {
    blocked.push([...parent.querySelectorAll('gv-hint')].some(hint => hint.readState().pinned));
  });
  second.pin();
  assert.equal(first.hint.readState().open, false);
  assert.equal(second.hint.readState().pinned, true);
  assert.deepEqual(blocked, [true, true]);
  second.hint.hide();
  assert.equal(blocked.at(-1), false);
  parent.remove();
});

test('navigation hide does not steal focus; removed anchors and disconnect clear pinned state', async () => {
  const fixture = new HintFixture('context');
  await fixture.mount();
  fixture.pin();
  const destination = document.createElement('button');
  document.body.append(destination);
  destination.focus();
  fixture.hint.hide();
  assert.equal(document.activeElement, destination);
  fixture.pin();
  fixture.trigger.remove();
  fixture.hint.shadowRoot.querySelector('slot').dispatchEvent(new Event('slotchange'));
  assert.equal(fixture.hint.readState().pinned, false);
  fixture.hint.append(fixture.trigger);
  fixture.hint.shadowRoot.querySelector('slot').dispatchEvent(new Event('slotchange'));
  fixture.pin();
  const direct = [];
  fixture.hint.addEventListener('gv-hint-state', event => { direct.push(event.detail.mode); });
  fixture.dispose();
  assert.deepEqual(direct, ['closed']);
  assert.equal(fixture.hint.readState().open, false);
  destination.remove();
});

test('consumer can synchronously hide on notification without resurrecting an old hint', async () => {
  const first = new HintFixture('old');
  const second = new HintFixture('new');
  await first.mount();
  await second.mount();
  first.pin();
  const modes = [];
  second.hint.addEventListener('gv-hint-state', event => {
    modes.push(event.detail.mode);
    if (event.detail.pinned) second.hint.hide();
  });
  second.pin();
  assert.deepEqual(modes, ['pinned', 'closed']);
  assert.equal(first.hint.readState().open || second.hint.readState().open, false);
  first.dispose();
  second.dispose();
});

test('multiline hint text contains only supplied whitespace, without template indentation', async () => {
  const fixture = new HintFixture('whitespace');
  fixture.hint.text = ' \nSynthetic\tline\n  ';
  await fixture.mount();
  fixture.trigger.dispatchEvent(new Event('pointerenter'));
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.shadowRoot.querySelector('[role="tooltip"]').textContent, fixture.hint.text);
  fixture.pin();
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.shadowRoot.querySelector('[role="dialog"] .text').textContent, fixture.hint.text);
  fixture.dispose();
});

test.after(async () => { await GlobalRegistrator.unregister(); });
