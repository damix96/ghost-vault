import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { WindowsDpapi } from './windows-dpapi.js';
import { KeyringProvider } from './keyring-provider.js';
import { SecretProvider, SecretStorageError } from './secret-provider.js';

const envelope = z.object({ version: z.literal(1), provider: z.enum(['windows-dpapi', 'macos-keychain', 'linux-secret-service']), id: z.string().uuid(), data: z.string().min(1).max(2097152).regex(/^[A-Za-z0-9+/]+={0,2}$/) }).strict();
const payload = z.object({ version: z.literal(1), vaultId: z.string().uuid(), id: z.string().uuid(), value: z.string() }).strict();

export class SecretProtection {
  constructor(private vaultId: string, private provider?: SecretProvider, private platform: NodeJS.Platform = process.platform, private requireExistingKey = false) {}

  private system = (): SecretProvider => {
    if (this.provider) return this.provider;
    if (this.platform === 'win32') this.provider = new WindowsDpapi();
    else if (this.platform === 'darwin' || this.platform === 'linux') this.provider = new KeyringProvider(this.vaultId, this.platform, undefined, this.requireExistingKey);
    else throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
    return this.provider;
  };

  private context = (id: string): Buffer => Buffer.from('GhostVault.SecretStorage.v1|' + this.vaultId + '|' + id);

  public protect = (value: string): string => {
    const provider = this.system();
    const id = randomUUID();
    const bytes = Buffer.from(JSON.stringify({ version: 1, vaultId: this.vaultId, id, value }));
    try { return JSON.stringify({ version: 1, provider: provider.id, id, data: provider.encrypt(bytes, this.context(id)).toString('base64') }); }
    catch (error) { throw error instanceof SecretStorageError ? error : new SecretStorageError('SECRET_STORAGE_UNAVAILABLE'); }
    finally { bytes.fill(0); }
  };

  public unprotect = (serialized: string): string => {
    let bytes: Buffer | undefined;
    try {
      const saved = envelope.parse(JSON.parse(serialized));
      const provider = this.system();
      if (saved.provider !== provider.id) throw new SecretStorageError('SECRET_STORAGE_UNAVAILABLE');
      const ciphertext = Buffer.from(saved.data, 'base64');
      if (ciphertext.toString('base64') !== saved.data) throw new SecretStorageError('SECRET_DECRYPTION_FAILED');
      bytes = provider.decrypt(ciphertext, this.context(saved.id));
      const decoded = payload.parse(JSON.parse(bytes.toString('utf8')));
      if (decoded.vaultId !== this.vaultId || decoded.id !== saved.id) throw new SecretStorageError('SECRET_DECRYPTION_FAILED');
      return decoded.value;
    } catch (error) { throw error instanceof SecretStorageError ? error : new SecretStorageError('SECRET_DECRYPTION_FAILED'); }
    finally { bytes?.fill(0); }
  };
}
