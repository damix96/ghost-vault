import { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { PatternEngine } from '../vault/pattern-engine.js';
import { LabelTemplate } from '../vault/label-template.js';

export const patternFields = z.object({ label_template: z.string().min(1).max(512).nullable().optional(), name: z.string().trim().min(1), pattern: z.string().min(1).refine(value => !/^\/.*\/[a-z]*$/s.test(value) && PatternEngine.isValidRegex(value), 'Введите regex source без /…/ и флагов'), type: z.string().trim().min(1).default('custom'), enabled: z.union([z.literal(0), z.literal(1)]) });

export class PatternEditorApi {
  constructor(private app: FastifyInstance, private engine: PatternEngine) {}

  register = () => {
    this.app.post('/api/patterns', async (req, reply) => {
      const parsed = patternFields.omit({ enabled: true }).safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map(issue => issue.message).join('; ') });
      try {
        LabelTemplate.validate(parsed.data.pattern, parsed.data.label_template);
        return { success: true, pattern: this.engine.addPattern(parsed.data.name, parsed.data.pattern, parsed.data.type, parsed.data.label_template ?? null) };
      } catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
    });
    this.app.put('/api/patterns/:id', async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
      const parsed = patternFields.extend({ baseline: z.object({ label_template: z.string().nullable().optional(), name: z.string(), pattern: z.string(), type: z.string(), enabled: z.union([z.literal(0), z.literal(1)]) }) }).safeParse(req.body);
      if (!parsed.success) return reply.status(400).send({ error: parsed.error.issues.map(issue => issue.message).join('; ') });
      const current = this.engine.getPatterns().find(row => row.id === req.params.id);
      if (!current) return reply.status(404).send({ error: 'Правило удалено. Черновик сохранён в редакторе.' });
      const keys = ['name', 'pattern', 'type', 'enabled'] as const;
      if (keys.some(key => current[key] !== parsed.data.baseline[key])) return reply.status(409).send({ error: 'Правило изменилось после открытия. Черновик сохранён. Закройте редактор через «Отмена» и откройте актуальную запись.' });
      if ((current.label_template ?? null) !== (parsed.data.baseline.label_template ?? null)) return reply.status(409).send({ error: 'Шаблон изменился после открытия. Откройте актуальную запись.' });
      const { baseline, ...draft } = parsed.data;
      try {
        const updated = this.engine.updatePattern(req.params.id, { ...draft, label_template: draft.label_template === undefined ? current.label_template : draft.label_template });
        return { success: true, pattern: updated };
      } catch (error) { return reply.status(400).send({ error: (error as Error).message }); }
    });
  };
}
