import { VaultDatabase } from '../vault/sqlite-db.js';
import { OpenCodeConfig } from '../clients/opencode-config.js';
import { RouteAvailability } from './route-availability.js';

export interface RouteDefinition {
  id: string;
  name: string;
  prefix: string;
  cliUrl: string;
  suffix: string;
  upstreamUrl: string;
  commandExample: string;
  description: string;
  isCustom: boolean;
  isUnusedPreset: boolean;
}

export class RouteRegistry {
  constructor(private db: VaultDatabase, private hostPort: string = 'http://127.0.0.1:8765') {}

  public static validateUrl = (value: string): string => {
    const url = new URL(value.trim());
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Укажите HTTP(S) адрес без пароля, query и fragment');
    return url.href.replace(/\/+$/, '');
  };

  public getRoutes = (baseUrl: string = this.hostPort): RouteDefinition[] =>
    this.db.getAllRoutes().map(r => {
      const suffix = this.db.getSetting('route_suffix_' + r.id, '');
      const cliUrl = baseUrl + '/' + r.prefix + suffix;
      const providerId = r.id === 'opencode' ? 'ghostvault-zen' : (r.id === 'opencode-go' ? 'ghostvault-go' : 'ghostvault-test');
      const modelId = r.prefix === 'ghostvault-test' ? 'zen-mock' : 'YOUR_MODEL_ID';
      const commandExample = r.id.startsWith('opencode') || r.prefix === 'ghostvault-test'
        ? JSON.stringify(OpenCodeConfig.create({ id: providerId, name: r.name + ' via GhostVault', baseUrl: cliUrl, modelId, ...(r.id === 'opencode' ? { canonical: 'opencode' } : {}), ...(providerId === 'ghostvault-test' ? { apiKey: 'local-test-only' } : {}) }), null, 2)
        : (r.id === 'anthropic' ? '$env:ANTHROPIC_BASE_URL="' + cliUrl + '"; claude' : '$env:OPENAI_BASE_URL="' + cliUrl + '"');
      return { id: r.id, name: r.name, prefix: r.prefix, suffix, cliUrl, upstreamUrl: r.upstream_url, commandExample, description: r.description, isCustom: Boolean(r.is_custom), isUnusedPreset: new RouteAvailability(this.db).isUnusedPreset(r) };
    });

  public getSettings = () => {
    const routes = this.db.getAllRoutes();
    const find = (id: string): string => routes.find(r => r.id === id)?.upstream_url || '';
    return { opencode: find('opencode'), go: find('opencode-go'), anthropic: find('anthropic'), openai: find('openai'), ollama: find('ollama'), chatBase: find('opencode'), anthropicBase: find('anthropic'), routes };
  };

  public updateSettings = (settings: Record<string, string | undefined>) => {
    const aliases: Record<string, string> = { chatBase: 'opencode', anthropicBase: 'anthropic', go: 'opencode-go' };
    const changes = Object.entries(settings).filter(([, value]) => value !== undefined).map(([key, value]) => [aliases[key] || key, RouteRegistry.validateUrl(value || '')]);
    for (const [id, url] of changes) {
      if (this.db.getAllRoutes().some(r => r.id === id)) this.updateRoute(id, url);
    }
    return this.getSettings();
  };

  public static validateSuffix = (value: string): string => {
    const suffix = value.trim();
    if (!/^(?:\/[a-zA-Z0-9._~-]+)*\/?$/.test(suffix) || suffix.split('/').some(part => part === '.' || part === '..')) throw new Error('Укажите путь, например /v1, /api/v2, или оставьте пустым');
    return suffix.replace(/\/$/, '');
  };

  public createCustomRoute = (data: { name: string; prefix: string; upstreamUrl: string; description?: string; suffix?: string }, baseUrl: string = this.hostPort): RouteDefinition => {
    const suffix = RouteRegistry.validateSuffix(data.suffix ?? '');
    const prefix = data.prefix.trim().toLowerCase().replace(/^\/+|\/+$/g, '');
    if (!/^[a-z0-9-]+$/.test(prefix) || ['api', 'health', 'dashboard', 'zen'].includes(prefix)) throw new Error('Недопустимый префикс маршрута');
    const existing = this.db.getAllRoutes().find(r => r.prefix === prefix);
    if (existing && !new RouteAvailability(this.db).isUnusedPreset(existing)) throw new Error('Этот префикс уже используется');
    const upstreamUrl = RouteRegistry.validateUrl(data.upstreamUrl);
    const name = data.name.trim();
    if (!name) throw new Error('Укажите название маршрута');
    const id = existing?.id || 'custom-' + prefix;
    this.db.upsertRoute({ id, name, prefix, upstream_url: upstreamUrl, description: data.description?.trim() || name, is_custom: 1 });
    this.db.setSetting('route_suffix_' + id, suffix);
    return this.getRoutes(baseUrl).find(r => r.id === id)!;
  };

  public updateRoute = (id: string, upstreamUrl: string, baseUrl: string = this.hostPort, name?: string, suffix?: string): RouteDefinition | null => {
    const cleanSuffix = suffix === undefined ? undefined : RouteRegistry.validateSuffix(suffix);
    const cleanUrl = RouteRegistry.validateUrl(upstreamUrl);
    const canonicalId = id === 'claude' ? 'anthropic' : id;
    const existing = this.db.getAllRoutes().find(r => r.id === canonicalId);
    if (!existing) return null;
    if (name !== undefined && !name.trim()) throw new Error('Укажите название соединения');
    this.db.upsertRoute({ ...existing, upstream_url: cleanUrl, name: name?.trim() || existing.name });
    if (cleanSuffix !== undefined) this.db.setSetting('route_suffix_' + canonicalId, cleanSuffix);
    this.db.setSetting('upstream_' + canonicalId, cleanUrl);
    if (canonicalId === 'opencode') this.db.setSetting('upstream_chat_base', cleanUrl);
    if (canonicalId === 'anthropic') this.db.setSetting('upstream_anthropic_base', cleanUrl);
    return this.getRoutes(baseUrl).find(r => r.id === canonicalId) || null;
  };

  public deleteRoute = (id: string): boolean => this.db.deleteRoute(id === 'claude' ? 'anthropic' : id);
}
