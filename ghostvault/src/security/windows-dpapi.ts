import { createRequire } from 'node:module';
import { SecretProvider, SecretStorageError } from './secret-provider.js';

interface DpapiBinding {
  isPlatformSupported: boolean;
  Dpapi: {
    protectData: (value: Buffer, entropy: Buffer, scope: 'CurrentUser') => Buffer;
    unprotectData: (value: Buffer, entropy: Buffer, scope: 'CurrentUser') => Buffer;
  };
}

export class WindowsDpapi implements SecretProvider {
  readonly id = 'windows-dpapi' as const;
  constructor(private load: () => DpapiBinding = () => createRequire(import.meta.url)('@primno/dpapi')) {}

  private binding = (): DpapiBinding => {
    try {
      const binding = this.load();
      if (!binding.isPlatformSupported) throw new Error();
      return binding;
    } catch { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }
  };

  public encrypt = (plaintext: Buffer, context: Buffer): Buffer => {
    const binding = this.binding();
    try { return Buffer.from(binding.Dpapi.protectData(plaintext, context, 'CurrentUser')); }
    catch { throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }
  };

  public decrypt = (ciphertext: Buffer, context: Buffer): Buffer => {
    const binding = this.binding();
    try { return Buffer.from(binding.Dpapi.unprotectData(ciphertext, context, 'CurrentUser')); }
    catch { throw new SecretStorageError('SECRET_DECRYPTION_FAILED'); }
  };
}
