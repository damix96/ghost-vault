import { SecretInputError } from './errors.js';
import { inputNotice, InputRevision, SecretInputReceipt, SecretInputStorage } from './schema.js';

export interface ProtectedInputVault {
  captureSecretTargets: (names: string[]) => InputRevision[];
  commitProtectedManualBatch: (input: {
    requestId: string;
    entries: Array<InputRevision & { value: string; description?: string }>;
  }) => SecretInputReceipt & { requestId: string };
}

export class VaultSecretInputStorage implements SecretInputStorage {
  constructor(private vault: ProtectedInputVault) {}

  public inspect = (operation: 'new' | 'update', names: string[]): InputRevision[] => {
    const targets = this.vault.captureSecretTargets(names);
    if (targets.length !== names.length || new Set(targets.map(target => target.name)).size !== names.length || targets.some(target => !names.includes(target.name))) throw new SecretInputError('STORE_FAILED');
    if (targets.some(target => operation === 'new' ? target.expectedRevision !== null : target.expectedRevision === null)) throw new SecretInputError('NAME_CONFLICT');
    return targets.map(target => ({ name: target.name, expectedRevision: target.expectedRevision }));
  };

  public commit = async (_operation: 'new' | 'update', entries: Array<InputRevision & { value: string }>, requestId: string): Promise<SecretInputReceipt> => {
    const receipt = this.vault.commitProtectedManualBatch({ requestId, entries });
    const result = receipt.variables;
    if (receipt.requestId !== requestId || result.length !== entries.length || new Set(result.map(entry => entry.name)).size !== entries.length || result.some(entry => !entries.some(expected => expected.name === entry.name) || entry.token !== '$${<' + entry.name + '>}')) throw new SecretInputError('STORE_FAILED');
    return { variables: result.map(entry => ({ name: entry.name, token: entry.token })), ...(receipt.notice ? { notice: { ...inputNotice } } : {}) };
  };
}
