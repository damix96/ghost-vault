import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VaultStore } from '../vault/store.js';

const name = z.string().regex(/^[A-Z0-9_]+$/);
const secret = z.object({ key: name, realValue: z.string().min(1), description: z.string().optional() });
const rename = z.object({ name });
const promote = z.object({ key: z.string().min(1) });

export class VariableApi {
  constructor(private app: FastifyInstance, private vault: VaultStore) {}

  public register = (): void => {
    this.app.post('/api/vault/secret', async (req, reply) => {
      const parsed = secret.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.setManualSecret(parsed.data.key, parsed.data.realValue, parsed.data.description);
      return { success: true, secret: entry };
    });
    this.app.patch<{ Params: { key: string } }>('/api/vault/secret/:key', async (req, reply) => {
      const parsed = rename.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.renameManualSecret(req.params.key, parsed.data.name);
      if (!entry) return reply.status(404).send({ error: 'Fixed variable not found', code: 'VARIABLE_NOT_FOUND' });
      return { success: true, secret: entry };
    });
    this.app.post('/api/vault/promote', async (req, reply) => {
      const parsed = promote.safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() });
      const entry = this.vault.promote(parsed.data.key);
      if (!entry) return reply.status(404).send({ error: 'Secret not found in auto vault' });
      return { success: true, secret: entry };
    });
    this.app.delete<{ Params: { key: string } }>('/api/vault/secret/:key', async (req, reply) => {
      const deleted = this.vault.deleteSecret(req.params.key);
      return reply.status(deleted ? 200 : 404).send({ success: deleted });
    });
  };
}
