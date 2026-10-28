import test from 'node:test';
import assert from 'node:assert/strict';
import { EditorSession } from '@ghostvault/ui-kit/models';
import { ClipboardTask } from '@ghostvault/ui-kit/clipboard';
import { HintState } from '@ghostvault/ui-kit/hint-state';

test('draft survives refresh; returning to baseline clears dirty', () => {
  const editor = new EditorSession('a', { url: 'saved' });
  editor.set('url', 'draft');
  editor.observe({ url: 'remote' });
  assert.equal(editor.draft.url, 'draft');
  assert.equal(editor.conflict, true);
  editor.set('url', 'saved');
  assert.equal(editor.dirty(), false);
});

test('late save cannot overwrite another entity or a closed editor', () => {
  const editor = new EditorSession('a', { url: 'a' });
  const ticket = editor.begin();
  editor.select('b', { url: 'b' });
  assert.equal(editor.complete(ticket), false);
  assert.deepEqual(editor.draft, { url: 'b' });
  const next = editor.begin();
  editor.close();
  assert.equal(editor.complete(next), false);
});

test('save of an older draft confirms only that snapshot', () => {
  const editor = new EditorSession('a', { url: 'base' });
  editor.set('url', 'submitted');
  const ticket = editor.begin();
  editor.set('url', 'newer');
  assert.equal(editor.complete(ticket), true);
  assert.equal(editor.baseline.url, 'submitted');
  assert.equal(editor.draft.url, 'newer');
  assert.equal(editor.dirty(), true);
});

test('duplicate submit rejected and old error cannot invalidate new draft', () => {
  const editor = new EditorSession('a', { url: '' });
  const ticket = editor.begin();
  assert.throws(editor.begin, /already pending/);
  editor.set('url', 'fixed');
  editor.fail(ticket, 'Old validation error');
  assert.equal(editor.error, '');
  assert.equal(editor.pending, false);
});

test('instances and immutable save snapshots do not alias inputs', () => {
  const values = { url: 'base' };
  const first = new EditorSession('a', values);
  const second = new EditorSession('a', values);
  first.set('url', 'changed');
  assert.equal(second.draft.url, 'base');
  const ticket = first.begin();
  assert.throws(() => { ticket.values.url = 'mutation'; }, TypeError);
  assert.equal(values.url, 'base');
});

test('copy captures exact raw text and failure has explicit state', async () => {
  const written = [];
  const copy = new ClipboardTask(async value => { written.push(value); });
  assert.equal(await copy.copy('raw', ' \t<value>\n'), true);
  assert.deepEqual(written, [' \t<value>\n']);
  const denied = new ClipboardTask(async () => { throw new Error('Denied'); });
  assert.equal(await denied.copy('raw', 'synthetic'), false);
  assert.equal(denied.state, 'failed');
});

test('disposed copy cannot publish stale success', async () => {
  let resolve;
  const copy = new ClipboardTask(() => new Promise(done => { resolve = done; }));
  const pending = copy.copy('old', 'synthetic');
  await assert.rejects(copy.copy('other', 'other'), /already pending/);
  copy.dispose();
  resolve();
  assert.equal(await pending, false);
  assert.equal(copy.state, 'idle');
});

test('pinned hint survives leave; close always releases it', () => {
  const hint = new HintState();
  hint.preview();
  hint.pin();
  hint.leave();
  assert.equal(hint.pinned(), true);
  hint.close();
  assert.equal(hint.active(), false);
});
