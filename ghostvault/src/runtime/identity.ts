import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const RuntimeIdentitySchema = z.object({
  product: z.literal('ghostvault'),
  runtimeProtocol: z.literal(1),
  version: z.string(),
  instanceId: z.string().uuid(),
  startedAt: z.number().int(),
  pid: z.number().int().positive(),
  port: z.number().int().positive(),
  state: z.enum(['starting', 'ready', 'stopping']),
});

export type RuntimeIdentity = z.infer<typeof RuntimeIdentitySchema>;

export class RuntimeProof {
  public static token = (): string => randomBytes(32).toString('hex');
  public static sign = (key: string, challenge: string, identity: RuntimeIdentity): string => createHmac('sha256', key).update(challenge + '\n' + JSON.stringify(identity)).digest('hex');
  public static equal = (left: string, right: string): boolean => Buffer.byteLength(left) === Buffer.byteLength(right) && timingSafeEqual(Buffer.from(left), Buffer.from(right));
  public static validChallenge = (challenge: string): boolean => /^[a-f0-9]{64}$/.test(challenge);
}
