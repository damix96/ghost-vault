import assert from 'node:assert/strict';
import { SecretGroups } from '../frontend/secret-groups.js';
import { SecretTableView } from '../frontend/secret-table-view.js';

class SecretGroupsCheck {
  entry = key => ({ key, alias: '$${<' + key + '>}', realValue: 'synthetic-' + key, description: '', isSecret: false, maskInAi: true });
  run = () => {
    const keys = ['FIX_123_321', 'FIX_123_333', 'FIX_232_333', 'FIX_232_553', 'FIX_121_222', 'FIX_456_455'];
    const entries = keys.map(this.entry);
    const before = JSON.stringify(entries);
    const result = SecretGroups.collect(entries);
    assert.deepEqual(result.groups.map(group => [group.prefix, group.entries.map(entry => entry.key)]), [['FIX_123', keys.slice(0, 2)], ['FIX_232', keys.slice(2, 4)]]);
    assert.deepEqual(result.singles.map(entry => entry.key), keys.slice(4));
    const varied = SecretGroups.collect(['FIX_RAND_RAND', 'FIX_RAND_X', 'FIX_RAND_LONGERTHANSIX', 'SOLO', '_EDGE', 'EDGE_', 'FIX__a', 'FIX__b'].map(this.entry));
    assert.deepEqual(varied.groups.map(group => group.prefix), ['FIX_', 'FIX_RAND']);
    assert.deepEqual(varied.singles.map(entry => entry.key), ['EDGE_', 'SOLO', '_EDGE']);
    const filtered = SecretGroups.collect(entries, '321');
    assert.equal(filtered.groups[0].total, 2);
    assert.deepEqual(filtered.groups[0].entries.map(entry => entry.key), ['FIX_123_321']);
    assert.equal(SecretGroups.collect(entries.slice(1)).groups.some(group => group.prefix === 'FIX_123'), false);
    assert.ok(SecretGroups.collect(entries.slice(1)).singles.some(entry => entry.key === 'FIX_123_333'));
    assert.equal(JSON.stringify(entries), before);
    const html = SecretTableView.rows(entries, '321', true);
    assert.match(html, /data-secret-group="FIX_123"/);
    assert.match(html, /Записей: 1 из 2/);
    assert.doesNotMatch(html, /data-secret-group="FIX"/);
    assert.doesNotMatch(SecretTableView.rows(entries, '', false), /data-secret-group/);
    const protectedEntry = { ...this.entry('PRIVATE_KEY'), isSecret: true, realValue: undefined };
    assert.match(SecretTableView.rows([protectedEntry], '', true), /Зашифрованное значение/);
    assert.doesNotMatch(SecretTableView.rows([protectedEntry], '', true), /Копировать исходное значение/);
    assert.equal(SecretGroups.matches({ ...protectedEntry, realValue: 'hidden-canary' }, 'hidden-canary'), false);
    console.log('PASS exact6case, variable suffix/last underscore, invalid edges, full-dataset membership/search, dissolution, immutable aliases, manual/protected rendering');
  };
}
new SecretGroupsCheck().run();
