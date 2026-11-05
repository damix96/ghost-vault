export type SecretProviderId = 'windows-dpapi' | 'macos-keychain' | 'linux-secret-service';

export interface SecretProvider {
  readonly id: SecretProviderId;
  encrypt: (plaintext: Buffer, context: Buffer) => Buffer;
  decrypt: (ciphertext: Buffer, context: Buffer) => Buffer;
}

export interface SecretStorageNotice {
  code: 'SECRET_STORAGE_CLEANUP_PENDING';
  message: string;
}

export class SecretStorageError extends Error {
  constructor(public code: 'SECRET_STORAGE_UNAVAILABLE' | 'SECRET_DECRYPTION_FAILED', public statusCode = code === 'SECRET_STORAGE_UNAVAILABLE' ? 503 : 422) {
    super(code === 'SECRET_STORAGE_UNAVAILABLE' ? 'System secret storage is unavailable or locked.' : 'Protected value could not be decrypted.');
  }
}
