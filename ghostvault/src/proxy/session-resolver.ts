import { FastifyRequest } from 'fastify';
import { createHash } from 'node:crypto';

export interface RouteResolution {
  forwardPath: string;
  targetUrl: string;
  targetProvider: string;
}

export interface UpstreamMap {
  opencode?: string;
  go?: string;
  anthropic?: string;
  openai?: string;
  ollama?: string;
  chatBase?: string;
  anthropicBase?: string;
}

export class SessionResolver {
  private clientSessions = new Map<string, { sessionId: string; lastSeen: number }>();

  public resolveSessionId = (req: FastifyRequest, clientName: string): string => {
    const h = req.headers;
    const headerVal = h['x-session-id'] || h['x-opencode-session'] || h['session-id'] || h['x-conversation-id'];
    if (headerVal) return Array.isArray(headerVal) ? String(headerVal[0]) : String(headerVal);

    const body: any = req.body;
    let messages: any[] | undefined = undefined;
    let systemPrompt: string = '';
    if (body && typeof body === 'object') {
      if (Array.isArray(body.messages)) messages = body.messages;
      if (typeof body.system === 'string') systemPrompt = body.system;
      else if (Array.isArray(body.system)) systemPrompt = JSON.stringify(body.system);
    } else if (typeof body === 'string') {
      try {
        const parsed = JSON.parse(body);
        if (Array.isArray(parsed.messages)) messages = parsed.messages;
        if (typeof parsed.system === 'string') systemPrompt = parsed.system;
      } catch {}
    }

    if (messages && messages.length > 0) {
      const root = messages[0];
      const rootStr = typeof root === 'string' ? root : (typeof root.content === 'string' ? root.content : JSON.stringify(root.content || root));
      const seed = clientName + '::' + (systemPrompt ? systemPrompt.slice(0, 100) + '::' : '') + rootStr.slice(0, 200);
      const hash = createHash('sha256').update(seed).digest('hex').slice(0, 12);
      return 'sess_' + hash;
    }

    const ip = req.ip || '127.0.0.1';
    const clientKey = clientName + '::' + ip;
    const now = Date.now();
    const existing = this.clientSessions.get(clientKey);
    if (existing && (now - existing.lastSeen) < 15 * 60 * 1000) {
      existing.lastSeen = now;
      return existing.sessionId;
    }
    const newSessionId = 'sess_' + now.toString(36) + '_' + Math.random().toString(36).slice(2, 6);
    this.clientSessions.set(clientKey, { sessionId: newSessionId, lastSeen: now });
    return newSessionId;
  };

  public resolveProvider = (url: string, base: string, targetUrl: string): string => {
    if (base.toLowerCase().includes('ollama') || targetUrl.toLowerCase().includes('ollama')) return 'Ollama';
    if (base.toLowerCase().includes('openai') || targetUrl.toLowerCase().includes('openai')) return 'OpenAI';
    if (url.includes('chat') || base.toLowerCase().includes('opencode')) return 'OpenCode';
    if (base.toLowerCase().includes('anthropic') || targetUrl.toLowerCase().includes('anthropic')) return 'Anthropic';
    try {
      return new URL(targetUrl).hostname;
    } catch {
      return 'Custom';
    }
  };

  public resolveRoute = (
    rawUrl: string,
    upstreamsOrChatBase: UpstreamMap | string,
    anthropicBaseFallback?: string,
    customBase?: string
  ): RouteResolution => {
    const isObj = typeof upstreamsOrChatBase === 'object' && upstreamsOrChatBase !== null;
    const opencode = isObj ? (upstreamsOrChatBase.opencode || upstreamsOrChatBase.chatBase || 'https://opencode.ai/inference') : (upstreamsOrChatBase || 'https://opencode.ai/inference');
    const go = isObj ? (upstreamsOrChatBase.go || 'https://opencode.ai/inference/go') : 'https://opencode.ai/inference/go';
    const anthropic = isObj ? (upstreamsOrChatBase.anthropic || upstreamsOrChatBase.anthropicBase || 'https://api.anthropic.com') : (anthropicBaseFallback || 'https://api.anthropic.com');
    const openai = isObj ? (upstreamsOrChatBase.openai || 'https://api.openai.com') : 'https://api.openai.com';
    const ollama = isObj ? (upstreamsOrChatBase.ollama || 'http://127.0.0.1:11434') : 'http://127.0.0.1:11434';

    let forwardPath = rawUrl;
    let base = opencode;
    let provider = 'OpenCode';
    let matchedCustom = false;
    const dynamicRoutes = isObj ? (((upstreamsOrChatBase as any).routes || (upstreamsOrChatBase as any).customRoutes || []) as any[]) : [];
    for (const r of dynamicRoutes) {
      if (r.prefix && (rawUrl.startsWith('/' + r.prefix + '/') || rawUrl === '/' + r.prefix)) {
        forwardPath = rawUrl.replace(new RegExp('^/' + r.prefix), '') || '/';
        base = r.upstream_url || r.upstreamUrl || base;
        provider = r.name || this.resolveProvider(forwardPath, base, base + forwardPath);
        matchedCustom = true;
        break;
      }
    }

    if (matchedCustom) {
    } else if (/^\/opencode-go(?:\/|$)/.test(rawUrl)) {
      forwardPath = rawUrl.replace(/^\/opencode-go/, '') || '/';
      base = go;
      provider = 'OpenCode Go';
    } else if (rawUrl.startsWith('/anthropic')) {
      forwardPath = rawUrl.replace(/^\/anthropic/, '') || '/';
      base = anthropic;
      provider = 'Anthropic';
    } else if (rawUrl.startsWith('/opencode') || rawUrl.startsWith('/zen')) {
      forwardPath = rawUrl.replace(/^\/(opencode|zen)/, '') || '/';
      base = opencode;
      provider = 'OpenCode';
    } else if (rawUrl.startsWith('/openai')) {
      forwardPath = rawUrl.replace(/^\/openai/, '') || '/';
      base = openai;
      provider = 'OpenAI';
    } else if (rawUrl.startsWith('/ollama')) {
      forwardPath = rawUrl.replace(/^\/ollama/, '') || '/';
      base = ollama;
      provider = 'Ollama';
    } else if (rawUrl.startsWith('/v1/messages') || rawUrl.includes('/messages')) {
      forwardPath = rawUrl;
      base = anthropic;
      provider = 'Anthropic';
    } else if (rawUrl.startsWith('/v1/chat/completions') || rawUrl.includes('chat')) {
      forwardPath = rawUrl;
      base = opencode;
      provider = 'OpenCode';
    } else {
      forwardPath = rawUrl;
      base = opencode;
      provider = this.resolveProvider(rawUrl, base, base + rawUrl);
    }

    const effectiveBase = (process.env.TARGET_API_BASE || (customBase && customBase !== 'https://api.anthropic.com' ? customBase : base)).replace(/\/+$/, '');
    if (/^https:\/\/opencode\.ai\/(?:inference|zen)(?:\/go)?$/.test(effectiveBase)) {
      const gemini = /^\/v\d+(?:beta)?\/models\/[^/?]+:[^/?]+(?:\?|$)/.test(forwardPath);
      const family = gemini ? '/google' : /\/messages(?:\?|$)/.test(forwardPath) ? '/anthropic' : '/openai';
      forwardPath = family + forwardPath;
    }
    const targetUrl = effectiveBase + (effectiveBase.endsWith('/v1') ? forwardPath.replace(/^\/v1(?=\/|$)/, '') : forwardPath);
    return { forwardPath, targetUrl, targetProvider: provider };
  };
}
