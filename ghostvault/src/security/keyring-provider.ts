import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import { SecretProvider, SecretStorageError } from './secret-provider.js';

export interface SystemKeyEntry {
  getSecret: () => number[] | null;
  setSecret: (secret: Uint8Array) => void;
}

export class KeyringProvider implements SecretProvider {
  readonly id: 'macos-keychain' | 'linux-secret-service';
  private observedKey = false;
  constructor(private vaultId: string, private platform: 'darwin' | 'linux', private open?: () => SystemKeyEntry, private requireExistingKey = false) {
    this.id = platform === 'darwin' ? 'macos-keychain' : 'linux-secret-service';
  }

  private entry = (): SystemKeyEntry => {
    if (this.open) return this.open();
    const { Entry } = createRequire(import.meta.url)('@napi-rs/keyring');
    return new Entry('GhostVault.SecretStorage.v1', this.vaultId, this.platform === 'linux' ? { linux: { store: 'secret-service' } } : undefined);
  };

  private read = (entry: SystemKeyEntry): Buffer | null => {
    const bytes = entry.getSecret();
    if (!bytes) return null;
    const key = Buffer.from(bytes);
    bytes.fill(0);
    if (key.length === 32) return key;
    key.fill(0);
    throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
  };

  private key = (create: boolean): Buffer => {
    try {
      const entry = this.entry();
      const existing = this.read(entry);
      if (existing) { this.observedKey = true; return existing; }
      if (!create || this.observedKey || this.requireExistingKey) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
      const fresh = randomBytes(32);
      try {
        entry.setSecret(fresh);
        const stored = this.read(entry);
        if (!stored) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
        if (timingSafeEqual(fresh, stored)) { this.observedKey = true; return stored; }
        stored.fill(0);
        throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
      } finally { fresh.fill(0); }
    } catch { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }
  };

  public encrypt = (plaintext: Buffer, context: Buffer): Buffer => {
    const key = this.key(true);
    try {
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(context);
      const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return Buffer.concat([nonce, cipher.getAuthTag(), encrypted]);
    } catch { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }
    finally { key.fill(0); }
  };

  public decrypt = (ciphertext: Buffer, context: Buffer): Buffer => {
    if (ciphertext.length < 28) throw new SecretStorageError('SECRET_DECRYPTION_FAILED');
    const key = this.key(false);
    try {
      const cipher = createDecipheriv('aes-256-gcm', key, ciphertext.subarray(0, 12));
      cipher.setAAD(context);
      cipher.setAuthTag(ciphertext.subarray(12, 28));
      return Buffer.concat([cipher.update(ciphertext.subarray(28)), cipher.final()]);
    } catch { throw new SecretStorageError('SECRET_DECRYPTION_FAILED'); }
    finally { key.fill(0); }
  };
}
