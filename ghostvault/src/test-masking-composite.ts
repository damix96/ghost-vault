import assert from 'node:assert/strict';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';

class CompositeMaskingTests {
  public run = (): void => {
    const db = new VaultDatabase(':memory:');
    try {
      const vault = new VaultStore(db);
      const composite = 'qa-secret-prefix$${<PUBLIC>}qa-secret-suffix';
      const entry = vault.setManualSecret('COMPOSITE', composite);
      vault.setManualSecret('TOKEN_FRAGMENT', 'PUBLIC');
      assert.equal(vault.maskManualText(composite), entry.alias);
      assert.equal(vault.maskOutboundText(composite), entry.alias);
      assert.equal(vault.maskOutboundText('$${<PUBLIC>}'), '$${<PUBLIC>}');
      for (const form of new Set(Object.values(VaultStore.computeVariants(composite)))) {
        const text = 'leading|' + form + '|trailing';
        const masked = vault.maskOutboundText(text);
        assert.notEqual(masked, text);
        assert.equal(vault.unmaskInboundText(masked), text);
      }
      const manual = vault.setManualSecret('MANUAL', 'synthetic-manual-value');
      const automatic = vault.setAutoSecret('AUTO_COMPOSITE', manual.alias + '-tail');
      const text = manual.realValue + '-tail';
      assert.equal(vault.maskOutboundText(text), manual.alias + '-tail');
      assert.equal(vault.unmaskInboundText(vault.maskOutboundText(text)), text);
      assert.equal(vault.maskOutboundText(automatic.realValue), automatic.alias);
      assert.equal(vault.unmaskInboundText(automatic.alias), automatic.realValue);
      const short = vault.setManualSecret('SHORT_PRIORITY', 'private-core');
      vault.setAutoSecret('LONG_AUTO', 'prefix-private-core-suffix');
      assert.equal(vault.maskOutboundText('prefix-private-core-suffix'), 'prefix-' + short.alias + '-suffix');
      assert.equal(vault.unmaskInboundText(vault.maskOutboundText('prefix-private-core-suffix')), 'prefix-private-core-suffix');
      assert.equal(vault.maskOutboundText('ordinary complete text!'), 'ordinary complete text!');
    } finally { db.close(); }
    console.log('Composite token-like secret raw/encoded roundtrip, public token preservation, manual priority and no generated-token cascade PASS');
  };
}

new CompositeMaskingTests().run();
