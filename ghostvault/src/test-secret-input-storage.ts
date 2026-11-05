import assert from 'node:assert/strict';
import { ProtectedInputVault, VaultSecretInputStorage } from './secret-input/storage.js';

const exact = ' \r\nbytes-秘密 ';
let present = false;
let invalidReceipt = false;
let calls = 0;
const vault: ProtectedInputVault = {
  captureSecretTargets: names => names.map(name => ({ name, expectedRevision: present ? 'revision-one' : null })),
  commitProtectedManualBatch: input => {
    calls++;
    assert.deepEqual(input.entries, [{ name: 'KEY', value: exact, expectedRevision: 'revision-one' }]);
    return { requestId: input.requestId, variables: [{ name: 'KEY', token: invalidReceipt ? exact : '$${<KEY>}' }] };
  },
};
const storage = new VaultSecretInputStorage(vault);
assert.deepEqual(storage.inspect('new', ['KEY']), [{ name: 'KEY', expectedRevision: null }]);
assert.throws(() => storage.inspect('update', ['KEY']), { code: 'NAME_CONFLICT' });
present = true;
assert.throws(() => storage.inspect('new', ['KEY']), { code: 'NAME_CONFLICT' });
const snapshot = storage.inspect('update', ['KEY']);
assert.deepEqual(snapshot, [{ name: 'KEY', expectedRevision: 'revision-one' }]);
const receipt = storage.commit('update', snapshot.map(entry => ({ ...entry, value: exact })), 'request-one');
assert.equal(calls, 1);
assert.deepEqual(await receipt, { variables: [{ name: 'KEY', token: '$${<KEY>}' }] });
invalidReceipt = true;
await assert.rejects(storage.commit('update', snapshot.map(entry => ({ ...entry, value: exact })), 'request-one'), { code: 'STORE_FAILED' });
assert.throws(() => new VaultSecretInputStorage({ ...vault, captureSecretTargets: () => [] }).inspect('new', ['KEY']), { code: 'STORE_FAILED' });
console.log('Secret input agreed sync storage adapter/value/CAS receipt PASS');
