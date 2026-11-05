import { SecretEntry, SecretPublicEntry } from '../types/index.js';
import { SecretRow } from './database-types.js';

export class SecretProjection {
  public static entry = (entry: SecretEntry): SecretPublicEntry => entry.isSecret ? {
    key: entry.key, alias: entry.alias, isSecret: true, maskInAi: entry.maskInAi,
    description: entry.description, createdAt: entry.createdAt, updatedAt: entry.updatedAt,
    storage: entry.storage, retainedVersions: entry.retainedVersions,
  } : { ...entry, isSecret: false };

  public static row = (row: SecretRow) => row.is_secret ? {
    key: row.key, alias: row.alias, isSecret: true, is_secret: 1, valueOmitted: true,
    mask_in_ai: row.mask_in_ai, description: row.description, created_at: row.created_at, updated_at: row.updated_at,
  } : {
    key: row.key, real_value: row.real_value, alias: row.alias, mask_in_ai: row.mask_in_ai,
    description: row.description, created_at: row.created_at, updated_at: row.updated_at,
  };
}
