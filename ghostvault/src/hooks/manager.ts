import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  GhostVaultHook,
  RequestContext,
  ResponseContext,
  StreamChunkContext,
  StreamEndContext,
} from './types.js';

export class HookManager {
  private hooks: GhostVaultHook[] = [];
  private sources = new Map<GhostVaultHook, { path: string; source: string }>();

  constructor(hooks: GhostVaultHook[] = []) {
    this.hooks = [...hooks];
  }

  public registerHook = (hook: GhostVaultHook): void => {
    this.hooks.push(hook);
  };

  public getHooks = (): GhostVaultHook[] => this.hooks;

  public exportConfiguration = () => this.hooks.map((hook, index) => ({ name: (hook as GhostVaultHook & { name?: string }).name || 'hook-' + index, ...(this.sources.get(hook) || { source: null, note: 'Зарегистрирован программно; исходный модуль не предоставлен' }) }));

  public loadHooksFromDir = async (dirPath: string): Promise<void> => {
    if (!fs.existsSync(dirPath)) return;
    const entries = fs.readdirSync(dirPath).sort();
    for (const file of entries) {
      if (file.endsWith('.js') || file.endsWith('.mjs') || file.endsWith('.ts')) {
        const fullPath = path.resolve(dirPath, file);
        try {
          const mod = await import(pathToFileURL(fullPath).href);
          const hook = mod.default || mod.hook;
          if (hook && typeof hook === 'object') {
            this.registerHook(hook);
            this.sources.set(hook, { path: fullPath, source: fs.readFileSync(fullPath, 'utf8') });
          } else if (typeof hook === 'function') {
            const inst = new hook();
            this.registerHook(inst);
            this.sources.set(inst, { path: fullPath, source: fs.readFileSync(fullPath, 'utf8') });
          }
        } catch {}
      }
    }
  };

  public runBeforeOutboundRequest = async (ctx: RequestContext): Promise<RequestContext> => {
    let current = { ...ctx };
    for (const hook of this.hooks) {
      if (hook.beforeOutboundRequest) {
        const res = await hook.beforeOutboundRequest(current);
        if (res) current = { ...res };
      }
    }
    return current;
  };

  public runAfterOutboundMask = async (body: string, ctx: RequestContext): Promise<string> => {
    let current = body;
    for (const hook of this.hooks) {
      if (hook.afterOutboundMask) {
        const res = await hook.afterOutboundMask(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runBeforeInboundResponse = async (rawText: string, ctx: ResponseContext): Promise<string> => {
    let current = rawText;
    for (const hook of this.hooks) {
      if (hook.beforeInboundResponse) {
        const res = await hook.beforeInboundResponse(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runAfterInboundUnmask = async (unmaskedText: string, ctx: ResponseContext): Promise<string> => {
    let current = unmaskedText;
    for (const hook of this.hooks) {
      if (hook.afterInboundUnmask) {
        const res = await hook.afterInboundUnmask(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runBeforeStream = async (ctx: ResponseContext): Promise<void> => {
    for (const hook of this.hooks) {
      if (hook.beforeStream) await hook.beforeStream(ctx);
    }
  };

  public runStreamChunk = async (chunk: string, ctx: StreamChunkContext): Promise<string> => {
    let current = chunk;
    for (const hook of this.hooks) {
      if (hook.onStreamChunk) {
        const res = await hook.onStreamChunk(current, ctx);
        if (typeof res === 'string') current = res;
      }
    }
    return current;
  };

  public runAfterStream = async (ctx: StreamEndContext): Promise<void> => {
    for (const hook of this.hooks) {
      if (hook.afterStream) await hook.afterStream(ctx);
    }
  };
}
