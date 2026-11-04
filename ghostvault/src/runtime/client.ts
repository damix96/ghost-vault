import { RuntimeSettings } from './settings.js';
import { RuntimeCredentials, RuntimeRecord } from './credentials.js';
import { RuntimeIdentity, RuntimeIdentitySchema, RuntimeProof } from './identity.js';

export interface VerifiedRuntime {
  identity: RuntimeIdentity;
  record: RuntimeRecord;
}

export class RuntimeClient {
  public credentials: RuntimeCredentials;

  constructor(public settings: RuntimeSettings) {
    this.credentials = new RuntimeCredentials(settings);
  }

  public inspect = async (retry = true): Promise<VerifiedRuntime | undefined> => {
    const challenge = RuntimeProof.token();
    const previousRecord = this.credentials.read();
    let response: Response;
    try { response = await fetch(this.settings.url + '/.ghostvault/identity?challenge=' + challenge, { signal: AbortSignal.timeout(700), redirect: 'error' }); }
    catch (error) {
      const code = (error as { cause?: { code?: string } }).cause?.code;
      if (code === 'ECONNREFUSED') return undefined;
      if (retry && ['ECONNRESET', 'UND_ERR_SOCKET'].includes(code ?? '')) return this.inspect(false);
      throw new Error('Port already in use: endpoint could not be verified');
    }
    const latestRecord = this.credentials.read();
    try {
      if (!response.ok) throw new Error('Invalid runtime');
      const text = await response.text();
      if (text.length > 4096) throw new Error('Invalid identity');
      const body = JSON.parse(text);
      const identity = RuntimeIdentitySchema.parse(body.identity);
      const record = [previousRecord, latestRecord].find(candidate => candidate && candidate.port === this.settings.port && this.settings.matchesDatabasePath(candidate.databasePath) && candidate.instanceId === identity.instanceId && identity.port === this.settings.port && typeof body.proof === 'string' && RuntimeProof.equal(body.proof, RuntimeProof.sign(candidate.controlToken, challenge, identity)));
      if (!record) throw new Error('Invalid proof');
      return { identity, record };
    } catch { throw new Error('Port already in use: endpoint could not be verified'); }
  };

  public shutdown = async (runtime: VerifiedRuntime): Promise<void> => {
    let response: Response;
    try {
      response = await fetch(this.settings.url + '/.ghostvault/shutdown', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + runtime.record.controlToken, 'x-ghostvault-instance': runtime.identity.instanceId },
        signal: AbortSignal.timeout(1000),
        redirect: 'error',
      });
    } catch (error) {
      if (['ECONNREFUSED', 'ECONNRESET', 'UND_ERR_SOCKET'].includes((error as { cause?: { code?: string } }).cause?.code ?? '')) return;
      throw new Error('Runtime shutdown request failed');
    }
    if (response.status !== 202) {
      const current = await this.inspect();
      if (!current || current.identity.instanceId !== runtime.identity.instanceId) return;
      throw new Error('Runtime shutdown was rejected');
    }
    const result = await response.json() as { instanceId?: string };
    if (result.instanceId !== runtime.identity.instanceId) throw new Error('Runtime shutdown identity changed');
  };
}
