import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { VaultDatabase } from '../vault/sqlite-db.js';
import { HookManager } from '../hooks/manager.js';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DefaultRoutes } from '../vault/default-routes.js';
import { GhostVaultConfig } from '../types/index.js';

export class WorkspaceApi {
  constructor(private app: FastifyInstance, private db: VaultDatabase, private hooks: HookManager, private proxyConfig: Partial<GhostVaultConfig>) {}

  private state = () => {
    const routes = this.db.getAllRoutes();
    const history = this.db.getTransactions(1000);
    let saved: { visible?: string[]; selected?: string } = {};
    try { saved = JSON.parse(this.db.getSetting('dashboard_workspace', '{}')); } catch {}
    const known = new Set(routes.filter(route => {
      const original = DefaultRoutes.definitions.find(item => item[0] === route.id);
      return route.is_custom || !original || route.upstream_url !== original[3] || route.name !== original[1] || history.some(tx => tx.url === '/' + route.prefix || tx.url.startsWith('/' + route.prefix + '/'));
    }).map(route => route.id));
    const visible = [...new Set(saved.visible || [...known])].filter(id => routes.some(route => route.id === id));
    return { visible, selected: visible.includes(saved.selected || '') ? saved.selected : visible[0] || '' };
  };

  public register = () => {
    this.app.get('/api/workspace', async () => this.state());
    this.app.get('/api/client-help', async () => ({ zenPlugin: pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../opencode/zen-connection')).href }));
    this.app.post('/api/workspace', async (req, reply) => {
      const parsed = z.object({ visible: z.array(z.string()).max(1000), selected: z.string() }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: 'Не удалось сохранить выбор соединений' });
      const ids = this.db.getAllRoutes().map(route => route.id);
      if (parsed.data.visible.some(id => !ids.includes(id)) || (parsed.data.selected && !parsed.data.visible.includes(parsed.data.selected))) return reply.code(400).send({ error: 'Соединение не найдено' });
      this.db.setSetting('dashboard_workspace', JSON.stringify(parsed.data));
      return this.state();
    });
    this.app.get<{ Querystring: { group?: string; groups?: string; id?: string } }>('/api/export', async (req, reply) => {
      const { group = 'all', id } = req.query;
      const groups: Record<string, unknown[]> = {
        connections: this.db.getAllRoutes().map(route => ({ ...route, suffix: this.db.getSetting('route_suffix_' + route.id, '') })),
        patterns: this.db.getPatterns(),
        secrets: [...this.db.getSecrets().map(entry => ({ ...entry, origin: 'manual' })), ...this.db.getAutoSecrets().map(entry => ({ ...entry, origin: 'auto' }))],
        hooks: this.hooks.exportConfiguration(),
        proxy: [{ id: 'proxy', ...this.proxyConfig }],
        settings: Object.entries(this.db.getAllSettings()).map(([key, value]) => ({ key, value })),
      };
      if (req.query.groups !== undefined) {
        const selected = [...new Set(req.query.groups.split(','))];
        if (id || !selected.length || selected.some(key => !Object.hasOwn(groups, key))) return reply.code(400).send({ error: 'Выберите разделы для экспорта' });
        const data = Object.fromEntries(selected.map(key => [key, key === 'settings' ? this.db.getAllSettings() : groups[key]]));
        return { format: 'ghostvault-settings', version: 1, exportedAt: new Date().toISOString(), scope: 'selected', included: selected, data };
      }
      if (group !== 'all' && !Object.hasOwn(groups, group)) return reply.code(400).send({ error: 'Неизвестная группа экспорта' });
      const data: Record<string, unknown> = group === 'all' ? { ...groups, settings: this.db.getAllSettings() } : {
        [group]: id ? groups[group].filter(entry => {
          const item = entry as { id?: string; key?: string; name?: string };
          return (item.id || item.key || item.name) === id;
        }) : groups[group],
      };
      if (id && !(data[group] as unknown[])?.length) return reply.code(404).send({ error: 'Объект экспорта больше не существует' });
      return { format: 'ghostvault-settings', version: 1, exportedAt: new Date().toISOString(), scope: group, data, note: 'Настройки GhostVault. История разговоров и настройки внешних приложений не включены. Хуки, переданные программно, требуют исходного кода приложения.' };
    });
  };
}
