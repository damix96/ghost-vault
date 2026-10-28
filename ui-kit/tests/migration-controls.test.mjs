import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const kit = await import('@ghostvault/ui-kit');
class StringControlDouble extends HTMLElement {
  value = '';
  validationMessage = '';
  updateComplete = Promise.resolve(true);
  setCustomValidity = message => { this.validationMessage = message; };
}
class InputDouble extends StringControlDouble {}
class TextareaDouble extends StringControlDouble {}
class SelectDouble extends StringControlDouble {}
class ButtonDouble extends HTMLElement {
  button = document.createElement('button');
  updateComplete = Promise.resolve(true);
  connectedCallback() { this.append(this.button); }
}
customElements.define('wa-input', InputDouble);
customElements.define('wa-textarea', TextareaDouble);
customElements.define('wa-select', SelectDouble);
customElements.define('wa-button', ButtonDouble);
customElements.define('gv-field', kit.GvField);
customElements.define('gv-select', kit.GvSelect);
customElements.define('gv-action', kit.GvAction);
customElements.define('gv-dialog', kit.GvDialog);

test('multiline editor preserves exact whitespace and delegates focus and placeholder', async () => {
  const field = document.createElement('gv-field');
  field.type = 'textarea';
  field.name = 'synthetic-secret';
  field.value = ' \tfirst\n\nsecond  ';
  field.placeholder = 'Multiline value';
  document.body.append(field);
  await field.updateComplete;
  const control = field.querySelector('wa-textarea');
  assert.equal(field.readValue(), ' \tfirst\n\nsecond  ');
  assert.equal(control.getAttribute('rows'), '4');
  assert.equal(control.placeholder, field.placeholder);
  let focused = false;
  control.focus = () => { focused = true; };
  field.focus();
  assert.equal(focused, true);
  const values = [];
  field.addEventListener('gv-input', event => { values.push(event.detail.value); });
  control.value = '\n edited\t\n';
  control.dispatchEvent(new Event('input'));
  assert.deepEqual(values, ['\n edited\t\n']);
  field.remove();
});

test('single-line native pattern and placeholder do not rewrite draft text', async () => {
  const field = document.createElement('gv-field');
  field.pattern = '[A-Z]+';
  field.placeholder = 'NAME';
  field.value = ' lowercase ';
  document.body.append(field);
  await field.updateComplete;
  assert.equal(field.querySelector('wa-input').getAttribute('pattern'), '[A-Z]+');
  assert.equal(field.readValue(), ' lowercase ');
  field.error = 'Domain validation';
  await field.updateComplete;
  assert.equal(field.querySelector('wa-input').validationMessage, 'Domain validation');
  field.remove();
});

test('select publishes one string event, escapes labels and retains keyed option identity', async () => {
  const select = document.createElement('gv-select');
  select.name = 'filter';
  select.value = 'all';
  select.options = [{ value: 'all', label: 'All' }, { value: 'error', label: '<img src=x>' }];
  document.body.append(select);
  await select.updateComplete;
  const options = select.querySelectorAll('wa-option');
  assert.equal(select.querySelector('img'), null);
  assert.equal(options[1].textContent, '<img src=x>');
  select.options = [{ value: 'all', label: 'Everything' }, { value: 'error', label: 'Errors', disabled: true }];
  await select.updateComplete;
  assert.equal(select.querySelector('wa-option'), options[0]);
  assert.equal(options[1].disabled, true);
  const events = [];
  select.addEventListener('gv-input', event => { events.push(event.detail); });
  const control = select.querySelector('wa-select');
  control.value = 'error';
  control.dispatchEvent(new Event('input'));
  control.dispatchEvent(new Event('change'));
  assert.deepEqual(events, [{ name: 'filter', value: 'error' }]);
  assert.equal(select.readValue(), 'error');
  select.remove();
});

test('shared reset adapter notifies model and stops listening after disconnect', async () => {
  const form = document.createElement('form');
  const select = document.createElement('gv-select');
  select.name = 'filter';
  select.initial = 'all';
  form.append(select);
  document.body.append(form);
  await select.updateComplete;
  const events = [];
  select.addEventListener('gv-input', event => { events.push(event.detail); });
  select.querySelector('wa-select').value = 'all';
  form.dispatchEvent(new Event('reset'));
  await Promise.resolve();
  assert.deepEqual(events, [{ name: 'filter', value: 'all', reason: 'reset' }]);
  select.remove();
  form.dispatchEvent(new Event('reset'));
  await Promise.resolve();
  assert.equal(events.length, 1);
  form.remove();
});

test('compact toggle and current semantics reach the actual button and remain app-controlled', async () => {
  const action = document.createElement('gv-action');
  action.size = 'compact';
  action.pressed = false;
  document.body.append(action);
  await action.updateComplete;
  const control = action.querySelector('wa-button');
  assert.equal(control.size, 's');
  assert.equal(control.button.getAttribute('aria-pressed'), 'false');
  control.button.click();
  assert.equal(action.pressed, false);
  action.pressed = true;
  action.current = true;
  await action.updateComplete;
  assert.equal(control.button.getAttribute('aria-pressed'), 'true');
  assert.equal(control.button.getAttribute('aria-current'), 'page');
  assert.equal(control.appearance, 'filled');
  action.pressed = undefined;
  action.current = false;
  await action.updateComplete;
  assert.equal(control.button.hasAttribute('aria-pressed'), false);
  assert.equal(control.button.hasAttribute('aria-current'), false);
  action.hint = 'Synthetic explanation';
  await action.updateComplete;
  assert.equal(action.querySelector('wa-button').button.getAttribute('aria-keyshortcuts'), 'F1');
  action.hint = '';
  await action.updateComplete;
  assert.equal(action.querySelector('wa-button').button.hasAttribute('aria-keyshortcuts'), false);
  action.remove();
});

test('pending dialog blocks cancelable vendor dismissal and imperative close; targets can refresh', async () => {
  const dialog = document.createElement('gv-dialog');
  const trigger = document.createElement('button');
  const fallback = document.createElement('button');
  document.body.append(trigger, fallback, dialog);
  dialog.closeDisabled = true;
  dialog.show(trigger, fallback);
  await dialog.updateComplete;
  const control = dialog.shadowRoot.querySelector('wa-dialog');
  const closed = [];
  dialog.addEventListener('gv-close', event => { closed.push(event); });
  const dismiss = new Event('wa-hide', { cancelable: true });
  control.dispatchEvent(dismiss);
  assert.equal(dismiss.defaultPrevented, true);
  assert.equal(dialog.hide(), false);
  assert.equal(dialog.open, true);
  assert.equal(closed.length, 0);
  dialog.open = false;
  dialog.heading = 'Changed entity';
  await dialog.updateComplete;
  assert.equal(dialog.open, true);
  assert.equal(control.label, 'Changed entity');
  assert.equal(control.lightDismiss, false);
  const focused = [];
  fallback.focus = () => { focused.push('fallback'); };
  trigger.remove();
  dialog.setReturnFocus(trigger, fallback);
  dialog.closeDisabled = false;
  assert.equal(dialog.hide(), true);
  await dialog.updateComplete;
  control.dispatchEvent(new Event('wa-after-hide'));
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.deepEqual(focused, ['fallback']);
  assert.equal(closed.length, 1);
  dialog.remove();
  fallback.remove();
});

test('unsupported textarea constraint and duplicate option identities reject instead of silently degrading', async () => {
  const field = document.createElement('gv-field');
  field.type = 'textarea';
  field.pattern = '[A-Z]+';
  document.body.append(field);
  await assert.rejects(field.updateComplete, /does not support native pattern/);
  field.remove();
  const select = document.createElement('gv-select');
  select.options = [{ value: 'same', label: 'First' }, { value: 'same', label: 'Second' }];
  document.body.append(select);
  await assert.rejects(select.updateComplete, /unique string values/);
  select.remove();
});

test.after(async () => { await GlobalRegistrator.unregister(); });
