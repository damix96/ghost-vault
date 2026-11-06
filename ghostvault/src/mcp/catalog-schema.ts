import { z } from 'zod';

export const catalogInputShape = {
  includeAutomatic: z.boolean().default(false).describe('Include eligible automatically detected variables only when explicitly needed; eligible fixed/manual variables are included by default.'),
  names: z.array(z.string()).optional().describe('Optional exact, case-sensitive variable names; omit to discover the complete eligible catalog.'),
};

export const catalogSchema = z.object({
  revision: z.string(),
  variables: z.array(z.object({
    name: z.string().regex(/^[A-Z0-9_]+$/),
    description: z.string().optional(),
    source: z.enum(['fixed', 'automatic']),
  })),
});

export const catalogSourceSchema = catalogSchema.extend({
  variables: z.array(catalogSchema.shape.variables.element.extend({ token: z.string().regex(/^\$\$\{<[A-Z0-9_]+>\}$/) })),
});

export interface VaultCatalogProvider {
  listVariables: (input?: { includeAutomatic?: boolean; names?: string[] }) => z.output<typeof catalogSourceSchema>;
}
