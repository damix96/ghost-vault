import { SecretEntry, SecretPublicEntry } from '../types/index.js';
import { SecretRow } from './database-types.js';

export class SecretProjection {
  private static object = (value: unknown): Record<string, unknown> | undefined => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

  private static ordinary = (source: unknown, projected: unknown): unknown => {
    const row = SecretProjection.object(source);
    const safe = SecretProjection.object(projected);
    if (!row || !safe || row.isSecret === true || row.is_secret === 1 || row.valueOmitted === true) return projected;
    const fields = ['realValue', 'real_value'].filter(key => typeof row[key] === 'string');
    if (!fields.length) return projected;
    const result = { ...safe };
    for (const key of fields) result[key] = row[key];
    const variants = SecretProjection.object(row.variants);
    if (variants) result.variants = { ...SecretProjection.object(safe.variants), ...Object.fromEntries(Object.entries(variants).filter(([, value]) => typeof value === 'string')) };
    if (Array.isArray(row.representations) && Array.isArray(safe.representations)) result.representations = row.representations.map((form, index) => {
      const original = SecretProjection.object(form);
      const mapped = SecretProjection.object((safe.representations as unknown[])[index]);
      return original && mapped && typeof original.value === 'string' ? { ...mapped, value: original.value } : (safe.representations as unknown[])[index];
    });
    return result;
  };

  private static rows = (source: unknown, projected: unknown, archives = false): unknown => Array.isArray(source) && Array.isArray(projected) ? source.map((row, index) => {
    const safe = SecretProjection.ordinary(row, projected[index]);
    const original = SecretProjection.object(row);
    const result = SecretProjection.object(safe);
    return archives && original && result && Array.isArray(original.versions) ? { ...result, versions: SecretProjection.rows(original.versions, result.versions) } : safe;
  }) : projected;

  public static admin = (kind: 'vault' | 'mutation' | 'export', source: unknown, projected: unknown): unknown => {
    const original = SecretProjection.object(source);
    const safe = SecretProjection.object(projected);
    if (!original || !safe) return projected;
    if (kind === 'mutation') return Object.hasOwn(original, 'secret') ? { ...safe, secret: SecretProjection.ordinary(original.secret, safe.secret) } : safe;
    if (kind === 'vault') return { ...safe, ...Object.fromEntries(['manual', 'manualSecrets', 'auto', 'autoSecrets'].filter(key => Object.hasOwn(original, key)).map(key => [key, SecretProjection.rows(original[key], safe[key])])) };
    const data = SecretProjection.object(original.data);
    const projectedData = SecretProjection.object(safe.data);
    if (!data || !projectedData) return safe;
    return { ...safe, data: { ...projectedData, ...Object.fromEntries(['secrets', 'orphanedSecretVersions'].filter(key => Object.hasOwn(data, key)).map(key => [key, SecretProjection.rows(data[key], projectedData[key], true)])) } };
  };

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
