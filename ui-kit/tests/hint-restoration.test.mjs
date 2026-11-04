import test from 'node:test';
import assert from 'node:assert/strict';
import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ url: 'http://localhost:5178/' });
const { GvHint } = await import('@ghostvault/ui-kit');
customElements.define('gv-hint', GvHint);

test('inbound evidence keeps exact copy values and describes restoration direction without requiring a live secret', async () => {
  const hint = document.createElement('gv-hint');
  hint.direction = 'inbound';
  hint.label = '$${<VERSIONED_ALIAS>}';
  hint.copyValue = 'old value / encoded';
  hint.append(document.createElement('button'));
  document.body.append(hint);
  await hint.updateComplete;
  const rows = hint.shadowRoot.querySelectorAll('.value-row');
  assert.equal(rows[0].querySelector('span').textContent, 'От модели');
  assert.equal(rows[1].querySelector('span').textContent, 'Приложению');
  assert.deepEqual([...hint.shadowRoot.querySelectorAll('gv-copy')].map(copy => copy.value), ['$${<VERSIONED_ALIAS>}', 'old value / encoded']);
  assert.equal(hint.shadowRoot.querySelector('[data-secret-open]'), null);
  hint.remove();
});
