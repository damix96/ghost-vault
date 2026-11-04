import { createHash } from 'node:crypto';
import { SecretEntry } from '../types/index.js';

export interface CatalogInput { includeAutomatic?: boolean; names?: string[] }
export interface CatalogVariable { name: string; token: string; description?: string; source: 'fixed' | 'automatic' }
export interface VariableCatalogResult { revision: string; variables: CatalogVariable[] }

export class VariableCatalog {
  public static list = (manual: SecretEntry[], automatic: SecretEntry[], input: CatalogInput = {}): VariableCatalogResult => {
    const project = (entries: SecretEntry[], source: CatalogVariable['source']): CatalogVariable[] => entries.filter(entry => entry.maskInAi).map(entry => ({ name: entry.key, token: entry.alias, ...(entry.description ? { description: entry.description } : {}), source }));
    const variables = [...project(manual, 'fixed'), ...(input.includeAutomatic ? project(automatic, 'automatic') : [])].sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
    const revision = createHash('sha256').update(JSON.stringify(variables)).digest('hex');
    const names = input.names ? new Set(input.names) : undefined;
    return { revision, variables: names ? variables.filter(variable => names.has(variable.name)) : variables };
  };
}
