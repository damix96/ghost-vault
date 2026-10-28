import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const { GvHint, GvAction } = await import('@ghostvault/ui-kit');
customElements.define('gv-hint', GvHint);
customElements.define('gv-action', GvAction);

class InteractionFixture {
  hint = document.createElement('gv-hint');
  trigger = document.createElement('button');
  actions = 0;
  constructor() {
    this.hint.text = 'Synthetic contextual explanation';
    this.hint.label = 'Synthetic action';
    this.trigger.textContent = 'Synthetic action';
    this.hint.append(this.trigger);
    this.trigger.addEventListener('click', () => { this.actions++; });
  }
  mount = async () => {
    document.body.append(this.hint);
    await this.hint.updateComplete;
    await this.hint.updateComplete;
  };
  pointer = (type, options = {}) => this.trigger.dispatchEvent(new PointerEvent(type, { bubbles: true, composed: true, cancelable: true, pointerType: 'touch', pointerId: 1, isPrimary: true, button: 0, clientX: 10, clientY: 10, ...options }));
  click = () => this.trigger.dispatchEvent(new MouseEvent('click', { bubbles: true, composed: true, cancelable: true, detail: 1 }));
  key = key => this.trigger.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
  dispose = () => this.hint.remove();
}

test('preview has no pin button; pinned close stays inside the panel without activating the trigger', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const fixture = new InteractionFixture();
  await fixture.mount();
  assert.equal(fixture.hint.shadowRoot.querySelector('button, gv-icon'), null);
  fixture.pointer('pointerenter', { pointerType: 'mouse' });
  assert.equal(fixture.hint.readState().open, false);
  t.mock.timers.tick(350);
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.readState().mode, 'preview');
  let leaked = 0;
  fixture.hint.addEventListener('gv-activate', () => { leaked++; });
  assert.equal(fixture.hint.shadowRoot.querySelector('.panel gv-action, .panel button'), null);
  fixture.key('F1');
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.readState().pinned, true);
  const close = fixture.hint.shadowRoot.querySelector('.panel gv-action');
  assert.equal(close.label, 'Закрыть подсказку');
  close.dispatchEvent(new CustomEvent('gv-activate', { bubbles: true, composed: true }));
  assert.equal(fixture.hint.readState().open, false);
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.shadowRoot.querySelector('.panel gv-action'), null);
  assert.equal(leaked, 0);
  assert.equal(fixture.actions, 0);
  fixture.dispose();
});

test('optional pin button can be enabled and disabled without changing state or activating the trigger', async () => {
  const fixture = new InteractionFixture();
  await fixture.mount();
  fixture.pointer('pointerenter', { pointerType: 'mouse' });
  fixture.hint.setAttribute('pin-button', '');
  await fixture.hint.updateComplete;
  const pin = fixture.hint.shadowRoot.querySelector('.panel gv-action');
  assert.equal(pin.label, 'Закрепить подсказку');
  let leaked = 0;
  fixture.hint.addEventListener('gv-activate', () => { leaked++; });
  pin.dispatchEvent(new CustomEvent('gv-activate', { bubbles: true, composed: true }));
  assert.equal(fixture.hint.readState().pinned, true);
  fixture.hint.removeAttribute('pin-button');
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.readState().pinned, true);
  assert.equal(fixture.hint.shadowRoot.querySelector('.panel gv-action').label, 'Закрыть подсказку');
  fixture.hint.hide();
  fixture.pointer('pointerenter', { pointerType: 'mouse' });
  await fixture.hint.updateComplete;
  assert.equal(fixture.hint.shadowRoot.querySelector('.panel gv-action'), null);
  assert.equal(fixture.actions + leaked, 0);
  fixture.dispose();
});

test('action forwards only its public optional pin flag and retains the primary control', async () => {
  const action = document.createElement('gv-action');
  action.hint = 'Synthetic explanation';
  document.body.append(action);
  await action.updateComplete;
  const hint = action.querySelector('gv-hint');
  const control = action.querySelector('wa-button');
  assert.equal(hint.pinButton, false);
  action.setAttribute('hint-pin-button', '');
  await action.updateComplete;
  assert.equal(hint.pinButton, true);
  assert.equal(action.querySelector('wa-button'), control);
  action.hintPinButton = false;
  await action.updateComplete;
  assert.equal(hint.pinButton, false);
  action.remove();
});

test('ordinary first click acts immediately; F1 pins idempotently and Escape is consumed once', async () => {
  const fixture = new InteractionFixture();
  await fixture.mount();
  fixture.trigger.focus();
  assert.equal(fixture.hint.readState().mode, 'preview');
  assert.equal(fixture.click(), true);
  assert.equal(fixture.actions, 1);
  assert.equal(fixture.hint.readState().open, false);
  assert.equal(fixture.key('F1'), false);
  fixture.key('F1');
  assert.equal(fixture.hint.readState().pinned, true);
  let escaped = 0;
  const dialog = () => { escaped++; };
  document.addEventListener('keydown', dialog);
  assert.equal(fixture.key('Escape'), false);
  assert.equal(fixture.hint.readState().open, false);
  assert.equal(escaped, 0);
  assert.equal(document.activeElement, fixture.trigger);
  fixture.key('Escape');
  assert.equal(escaped, 1);
  document.removeEventListener('keydown', dialog);
  fixture.dispose();
});

test('recognized touch hold pins and consumes its click, never the next intentional action', async context => {
  const fixture = new InteractionFixture();
  await fixture.mount();
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  fixture.pointer('pointerdown');
  context.mock.timers.tick(599);
  assert.equal(fixture.hint.readState().open, false);
  context.mock.timers.tick(1);
  assert.equal(fixture.hint.readState().pinned, true);
  fixture.pointer('pointerup');
  assert.equal(fixture.click(), false);
  assert.equal(fixture.actions, 0);
  assert.equal(fixture.hint.readState().pinned, true);
  fixture.pointer('pointerdown', { pointerType: 'mouse', pointerId: 2 });
  assert.equal(fixture.click(), true);
  assert.equal(fixture.actions, 1);
  assert.equal(fixture.hint.readState().open, false);
  fixture.dispose();
});

test('tap, movement, scroll and cancellation never become a hold or swallow the normal tap', async context => {
  const fixture = new InteractionFixture();
  await fixture.mount();
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  fixture.pointer('pointerdown');
  context.mock.timers.tick(100);
  fixture.pointer('pointerup');
  assert.equal(fixture.click(), true);
  assert.equal(fixture.actions, 1);
  for (const cancel of [
    () => fixture.pointer('pointermove', { clientX: 19 }),
    () => document.dispatchEvent(new Event('scroll')),
    () => fixture.pointer('pointercancel')
  ]) {
    fixture.pointer('pointerdown');
    cancel();
    context.mock.timers.tick(700);
    assert.equal(fixture.hint.readState().pinned, false);
  }
  fixture.pointer('pointerdown');
  fixture.dispose();
  context.mock.timers.tick(700);
  assert.equal(fixture.hint.readState().open, false);
});

test('keyboard intent and fresh pointer clear stale touch suppression; mouse context menu stays native', async context => {
  const fixture = new InteractionFixture();
  await fixture.mount();
  context.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 10000 });
  fixture.pointer('pointerdown');
  context.mock.timers.tick(600);
  fixture.pointer('pointerup');
  fixture.key('Enter');
  assert.equal(fixture.trigger.dispatchEvent(new MouseEvent('click', { detail: 0, bubbles: true })), true);
  assert.equal(fixture.actions, 1);
  fixture.pointer('pointerdown', { pointerType: 'mouse', pointerId: 2 });
  assert.equal(fixture.trigger.dispatchEvent(new MouseEvent('contextmenu', { cancelable: true, bubbles: true })), true);
  fixture.dispose();
});

test.after(async () => { await GlobalRegistrator.unregister(); });
