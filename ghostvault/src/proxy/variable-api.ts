import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VaultStore } from '../vault/store.js';
import { SecretEntry } from '../types/index.js';
import { SecretRepresentations } from '../vault/secret-representations.js';

const name = z.string().regex(/^[A-Z0-9_]+$/);
const secret = z.object({ key: name, realValue: z.string().min(1).refine(SecretRepresentations.isWellFormed), description: z.string().optional(), isSecret: z.boolean().optional(), operation: z.enum(['create', 'update']).optional() });
const rename = z.object({ name });
const protect = z.object({ isSecret: z.boolean(), realValue: z.string().min(1).refine(SecretRepresentations.isWellFormed).optional(), description: z.string().optional() }).strict();
const promote = z.object({ key: z.string().min(1) });

export class VariableApi {
  constructor(private app: FastifyInstance, private vault: VaultStore) {}

  private success = (entry: SecretEntry) => ({ success: true, secret: this.vault.publicEntry(entry), notice: this.vault.getSecretStorageNotice() });

  private write = (input: z.infer<typeof secret>): SecretEntry => {
    if (input.isSecret === undefined || input.isSecret === false && !input.operation) {
      if (input.operation) throw Object.assign(new Error('Operation requires an explicit encryption flag.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
      return this.vault.setManualSecret(input.key, input.realValue, input.description, input.isSecret);
    }
    if (!input.operation) throw Object.assign(new Error('Choose create or update.'), { statusCode: 400, code: 'INVALID_SECRET_INPUT' });
    const target = this.vault.captureProtectedTargets([input.key])[0];
    if (input.operation === 'create' && target.revision !== null) throw Object.assign(new Error('A fixed variable already exists.'), { statusCode: 409, code: 'SECRET_ALREADY_EXISTS' });
    if (input.operation === 'update' && target.revision === null) throw Object.assign(new Error('Fixed variable not found.'), { statusCode: 404, code: 'VARIABLE_NOT_FOUND' });
    if (input.isSecret) this.vault.commitProtectedSecrets({ values: [{ key: input.key, realValue: input.realValue, description: input.description }], expected: [target] });
    else this.vault.setManualSecret(input.key, input.realValue, input.description ?? this.vault.getManualSecrets().find(entry => entry.key === input.key)?.description, false, target.revision);
    return this.vault.getManualSecrets().find(entry => entry.key === input.key)!;
  };

  public register = (): void => {
    this.app.post('/api/vault/secret', async (req, reply) => {
      const parsed = secret.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Invalid secret input.', code: 'INVALID_SECRET_INPUT' });
      return this.success(this.write(parsed.data));
    });
    this.app.patch<{ Params: { key: string } }>('/api/vault/secret/:key', async (req, reply) => {
      const parsed = z.union([rename.strict(), protect]).safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: 'Choose one valid operation.', code: 'INVALID_SECRET_INPUT' });
      const entry = 'name' in parsed.data ? this.vault.renameManualSecret(req.params.key, parsed.data.name) : this.vault.setManualProtection(req.params.key, parsed.data);
      if (!entry) return reply.status(404).send({ error: 'Fixed variable not found', code: 'VARIABLE_NOT_FOUND' });
      return this.success(entry);
    });
    this.app.post('/api/vault/promote', async (req, reply) => {
      const parsed = promote.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.promote(parsed.data.key);
      if (!entry) return reply.status(404).send({ error: 'Secret not found in auto vault' });
      return this.success(entry);
    });
    this.app.delete<{ Params: { key: string } }>('/api/vault/secret/:key', async (req, reply) => {
      const deleted = this.vault.deleteSecret(req.params.key);
      return reply.status(deleted ? 200 : 404).send({ success: deleted, notice: this.vault.getSecretStorageNotice() });
    });
  };
}
