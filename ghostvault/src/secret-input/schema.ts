import { z } from 'zod';

export const inputNames = z.array(z.string().regex(/^[A-Z0-9_]+$/).max(128)).min(1).max(32)
  .refine(names => new Set(names).size === names.length && names.join(',').length <= 4096);
export const inputRequestSchema = z.object({ operation: z.enum(['new', 'update']), names: inputNames, idempotencyKey: z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const inputIdSchema = z.object({ requestId: z.string().uuid() }).strict();
export const inputSubmitSchema = z.object({ submissionId: z.string().uuid(), values: z.array(z.object({ name: z.string(), value: z.string().min(1).refine(value => Buffer.byteLength(value) <= 65536) }).strict()).min(1).max(32) }).strict();
export const inputNotice = { code: 'SECRET_STORAGE_CLEANUP_PENDING' as const, message: 'Protected values were saved. Cleanup of earlier plaintext copies in the current database could not be confirmed when saved. Check Vault for current cleanup status. Do not resubmit values.' };
export const inputViewSchema = z.object({
  requestId: z.string().uuid(), operation: z.enum(['new', 'update']), names: inputNames,
  state: z.enum(['awaiting_input', 'committing', 'completed', 'cancelled', 'expired', 'failed']),
  expiresAt: z.number(), launch: z.enum(['attempted', 'unavailable', 'not_requested']),
  result: z.array(z.object({ name: z.string(), token: z.string() })).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
  notice: z.object({ code: z.literal('SECRET_STORAGE_CLEANUP_PENDING'), message: z.string() }).optional(),
});
export type SecretInputRequest = z.infer<typeof inputRequestSchema>;
export type SecretInputView = z.infer<typeof inputViewSchema>;
export type SecretInputSubmission = z.infer<typeof inputSubmitSchema>;
export interface InputRevision { name: string; expectedRevision: string | null }
export interface SecretInputReceipt { variables: Array<{ name: string; token: string }>; notice?: { code: 'SECRET_STORAGE_CLEANUP_PENDING'; message: string } }
export interface SecretInputStorage {
  inspect: (operation: 'new' | 'update', names: string[]) => InputRevision[];
  commit: (operation: 'new' | 'update', values: Array<InputRevision & { value: string }>, requestId: string) => Promise<SecretInputReceipt>;
}
