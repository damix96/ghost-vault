import { z } from 'zod';
import { SecretStorageNotice } from '../security/secret-provider.js';
import { randomUUID } from 'node:crypto';
import { SecretRepresentations } from './secret-representations.js';

const name = z.string().regex(/^[A-Z0-9_]+$/);
const revision = z.string().max(128).nullable();
const value = z.string().min(1).refine(SecretRepresentations.isWellFormed).refine(input => Buffer.byteLength(input, 'utf8') <= 65536);

export const protectedTargets = z.array(name).min(1).max(32).refine(names => new Set(names).size === names.length);
export const protectedBatch = z.object({
  requestId: z.string().min(1).max(128),
  entries: z.array(z.object({ name, value, expectedRevision: revision, description: z.string().optional() }).strict()).min(1).max(32),
}).strict().refine(input => new Set(input.entries.map(entry => entry.name)).size === input.entries.length && input.entries.reduce((bytes, entry) => bytes + Buffer.byteLength(entry.value, 'utf8'), 0) <= 1048576);

export type ProtectedManualBatch = z.infer<typeof protectedBatch>;
export interface ProtectedTarget { key: string; revision: string | null }
export interface ProtectedManualTarget { name: string; expectedRevision: string | null }
export interface ProtectedReceipt { requestId: string; variables: Array<{ name: string; token: string }>; notice?: SecretStorageNotice }

const protectedValues = z.object({
  values: z.array(z.object({ key: name, realValue: value, description: z.string().optional() }).strict()).min(1).max(32),
  expected: z.array(z.object({ key: name, revision }).strict()).min(1).max(32),
}).strict().refine(input => new Set(input.values.map(entry => entry.key)).size === input.values.length && new Set(input.expected.map(entry => entry.key)).size === input.expected.length && input.values.length === input.expected.length && input.values.every(entry => input.expected.some(expected => entry.key === expected.key)));

export type ProtectedValuesInput = z.infer<typeof protectedValues>;

export class ProtectedWrites {
  public static batch = (input: ProtectedValuesInput): ProtectedManualBatch => {
    const parsed = protectedValues.safeParse(input);
    if (!parsed.success) throw Object.assign(new Error('Invalid secret input.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const revisions = new Map(parsed.data.expected.map(entry => [entry.key, entry.revision]));
    return { requestId: randomUUID(), entries: parsed.data.values.map(entry => ({ name: entry.key, value: entry.realValue, description: entry.description, expectedRevision: revisions.get(entry.key)! })) };
  };
}
