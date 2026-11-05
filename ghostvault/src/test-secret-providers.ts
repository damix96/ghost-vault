import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { SecretProtection } from './security/secret-protection.js';
import { WindowsDpapi } from './security/windows-dpapi.js';
import { KeyringProvider, SystemKeyEntry } from './security/keyring-provider.js';
import { SecretStorageError } from './security/secret-provider.js';

class KeyFixture implements SystemKeyEntry {
  stored: number[] | null = null;
  writes = 0;
  getSecret = (): number[] | null => this.stored?.slice() ?? null;
  setSecret = (key: Uint8Array): void => { this.stored = [...key]; this.writes++; };
}

class SecretProviderTests {
  readonly vaultId = randomUUID();
  readonly values = [' \u041f\u0430\u0440\u043e\u043b\u044c \u5bc6\u78bc \ud83d\udd10\r\n\n\tend\u0000 ', 'e\u0301 \u00e9', '\ud800', 'x'.repeat(65536)];
  readonly isCorrupt = (error: unknown): boolean => error instanceof SecretStorageError && error.code === 'SECRET_DECRYPTION_FAILED';
  readonly isUnavailable = (error: unknown): boolean => error instanceof SecretStorageError && error.code === 'SECRET_STORAGE_UNAVAILABLE';

  private roundtrip = (protection: SecretProtection): void => {
    for (const value of this.values) {
      const encrypted = protection.protect(value);
      assert.equal(protection.unprotect(encrypted), value);
      assert.notEqual(protection.protect(value), encrypted);
      assert.equal(encrypted.includes(value), false);
      const changed = JSON.parse(encrypted);
      const bytes = Buffer.from(changed.data, 'base64');
      bytes[bytes.length - 1] ^= 255;
      changed.data = bytes.toString('base64');
      assert.throws(() => protection.unprotect(JSON.stringify(changed)), this.isCorrupt);
    }
    assert.throws(() => protection.unprotect('{}'), this.isCorrupt);
    assert.throws(() => protection.unprotect('invalid'), this.isCorrupt);
    const unknown = JSON.parse(protection.protect('synthetic'));
    unknown.version = 999;
    assert.throws(() => protection.unprotect(JSON.stringify(unknown)), this.isCorrupt);
  };

  private keyring = (platform: 'darwin' | 'linux'): void => {
    const fixture = new KeyFixture();
    const provider = new KeyringProvider(this.vaultId, platform, () => fixture);
    const protection = new SecretProtection(this.vaultId, provider);
    this.roundtrip(protection);
    assert.equal(fixture.writes, 1);
    const encrypted = protection.protect('synthetic restart');
    const reopened = new SecretProtection(this.vaultId, new KeyringProvider(this.vaultId, platform, () => fixture));
    assert.equal(reopened.unprotect(encrypted), 'synthetic restart');
    assert.throws(() => new SecretProtection(randomUUID(), provider).unprotect(encrypted), this.isCorrupt);
    const saved = fixture.stored;
    fixture.stored = null;
    assert.throws(() => reopened.unprotect(encrypted), this.isUnavailable);
    assert.throws(() => protection.protect('synthetic after key loss'), this.isUnavailable);
    assert.equal(fixture.writes, 1);
    const missing = new KeyFixture();
    const required = new KeyringProvider(this.vaultId, platform, () => missing, true);
    assert.throws(() => new SecretProtection(this.vaultId, required).protect('synthetic existing vault'), this.isUnavailable);
    assert.equal(missing.writes, 0);
    fixture.stored = saved;
    const locked = new KeyringProvider(this.vaultId, platform, () => { throw new Error('synthetic private error'); });
    assert.throws(() => new SecretProtection(this.vaultId, locked).protect('synthetic'), error => this.isUnavailable(error) && !String(error).includes('private'));
    fixture.stored = [1, 2, 3];
    assert.throws(() => protection.protect('synthetic'), this.isUnavailable);
    assert.equal(fixture.writes, 1);
  };

  private windows = (): void => {
    const provider = new WindowsDpapi();
    const protection = new SecretProtection(this.vaultId, provider);
    this.roundtrip(protection);
    const encrypted = protection.protect('synthetic restart');
    assert.equal(new SecretProtection(this.vaultId, provider).unprotect(encrypted), 'synthetic restart');
    assert.throws(() => new SecretProtection(randomUUID(), provider).unprotect(encrypted), this.isCorrupt);
    const missing = new WindowsDpapi(() => { throw new Error('synthetic private error'); });
    assert.throws(() => new SecretProtection(this.vaultId, missing).protect('synthetic'), this.isUnavailable);
    const foreign = new SecretProtection(this.vaultId, new KeyringProvider(this.vaultId, 'linux', () => new KeyFixture()));
    assert.throws(() => foreign.unprotect(encrypted), this.isUnavailable);
  };

  public run = (): void => {
    this.keyring('darwin');
    this.keyring('linux');
    if (process.platform === 'win32') this.windows();
    assert.throws(() => new SecretProtection(this.vaultId, undefined, 'freebsd').protect('synthetic'), this.isUnavailable);
    console.log(JSON.stringify({ node: process.version, productionProviders: true, windowsRealDpapi: process.platform === 'win32', macosLinux: 'injected credential fixtures only', exactValues: true, tamperAndUnavailable: true }));
  };
}

new SecretProviderTests().run();
