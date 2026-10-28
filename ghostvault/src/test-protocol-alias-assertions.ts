import assert from 'node:assert/strict';
import { VaultStore } from './vault/store.js';

export class ProtocolAliasAssertions {
  public static verifyEncoded = (vault: VaultStore, alias: string, sourceForm: string): string => {
    assert.match(alias, /^\$\$\{<[A-Z0-9_]+>\}$/);
    assert.notEqual(alias, sourceForm);
    assert.equal(vault.unmaskInboundText(alias), sourceForm);
    return alias;
  };

  public static verifyDistinct = (aliases: string[]): void => assert.equal(new Set(aliases).size, aliases.length);
}
