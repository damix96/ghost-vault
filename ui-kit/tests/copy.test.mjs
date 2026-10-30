import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const { GvCopy } = await import('@ghostvault/ui-kit');
customElements.define('gv-copy', GvCopy);

const activate = async copy => {
  const done = new Promise(resolve => copy.addEventListener('gv-copy-result', resolve, { once: true }));
  copy.shadowRoot.querySelector('button').click();
  await done;
  await copy.updateComplete;
};

test('copy preserves empty/raw text, reports failure locally and clears feedback on new value', async () => {
  let copied;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async value => { copied = value; } } });
  const copy = document.createElement('gv-copy');
  copy.label = 'Копировать исходное';
  document.body.append(copy);
  await copy.updateComplete;
  await activate(copy);
  assert.equal(copied, '');
  assert.equal(copy.status, 'copied');
  copy.value = ' \nraw\t ';
  await copy.updateComplete;
  assert.equal(copy.status, '');
  await activate(copy);
  assert.equal(copied, ' \nraw\t ');
  navigator.clipboard.writeText = async () => { throw new Error('denied'); };
  await activate(copy);
  assert.equal(copy.status, 'failed');
  assert.match(copy.shadowRoot.querySelector('[role="status"]').textContent, /Выделите текст/);
  copy.remove();
});

test('pending copy rejects duplicate activation and cannot publish after value changes away and back', async () => {
  let finish;
  let calls = 0;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => { calls++; return new Promise(resolve => { finish = resolve; }); } } });
  const copy = document.createElement('gv-copy');
  copy.value = 'first';
  document.body.append(copy);
  await copy.updateComplete;
  copy.shadowRoot.querySelector('button').click();
  copy.shadowRoot.querySelector('button').click();
  assert.equal(calls, 1);
  copy.value = 'second';
  await copy.updateComplete;
  copy.value = 'first';
  await copy.updateComplete;
  finish();
  await Promise.resolve();
  await copy.updateComplete;
  assert.equal(copy.status, '');
  assert.equal(copy.pending, false);
  copy.remove();
});
