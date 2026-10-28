import { HookDryRunRequest, HookDryRunResult, TransactionContext } from './types.js';
import { HookManager } from '../hooks/manager.js';

export class HookSandbox {
  private hookManager?: HookManager;

  constructor(hookManager?: HookManager) {
    this.hookManager = hookManager;
  }

  public executeDryRun = async (
    req: HookDryRunRequest,
    lastTx?: TransactionContext | null
  ): Promise<HookDryRunResult> => {
    const input = this.prepareInput(req, lastTx);
    const ctx = this.prepareContext(req, lastTx);
    const start = performance.now();

    try {
      let output: any;
      if (req.hookCode) {
        const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
        const executor = new AsyncFunction(
          'input',
          'ctx',
          'const evaluated = (0, eval)("(" + ' + JSON.stringify(req.hookCode) + ' + ")");' +
          'if (typeof evaluated === "function") return evaluated(input, ctx);' +
          'if (evaluated && typeof evaluated === "object" && typeof evaluated[' + JSON.stringify(req.stage) + '] === "function") {' +
          '  return evaluated[' + JSON.stringify(req.stage) + '](input, ctx);' +
          '}' +
          'return input;'
        );
        output = await executor(input, ctx);
      } else if (req.hookName && this.hookManager) {
        const hook = this.hookManager.getHooks().find((h: any) => h.name === req.hookName);
        if (hook && typeof (hook as any)[req.stage] === 'function') {
          output = await (hook as any)[req.stage](input, ctx);
        } else {
          throw new Error('Hook not found or stage method missing: ' + req.hookName);
        }
      } else {
        throw new Error('Either hookCode or hookName must be provided');
      }

      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      return { success: true, input, output: output ?? input, durationMs };
    } catch (err: any) {
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      return {
        success: false,
        input,
        output: null,
        durationMs,
        error: err?.message || String(err),
      };
    }
  };

  private prepareInput = (req: HookDryRunRequest, lastTx?: TransactionContext | null): any => {
    if (req.customContext?.input !== undefined) return req.customContext.input;
    if (req.stage === 'beforeOutboundRequest') {
      return req.customContext?.request || lastTx?.request || {
        method: 'POST',
        url: '/v1/messages',
        headers: { 'content-type': 'application/json' },
        body: { messages: [{ role: 'user', content: 'Sample prompt' }] },
        client: 'Claude Code',
      };
    }
    if (req.stage === 'afterOutboundMask') {
      return req.customContext?.body || (typeof lastTx?.request?.body === 'string' ? lastTx.request.body : JSON.stringify(lastTx?.request?.body || {}));
    }
    if (req.stage === 'beforeInboundResponse' || req.stage === 'afterInboundUnmask') {
      return req.customContext?.text || JSON.stringify(lastTx?.response?.body || { content: [{ type: 'text', text: 'Sample output' }] });
    }
    if (req.stage === 'onStreamChunk') {
      return req.customContext?.chunk || lastTx?.sampleStreamChunk || 'data: {"type":"content_block_delta","delta":{"text":"sample"}}\n\n';
    }
    return req.customContext || lastTx?.request || {};
  };

  private prepareContext = (req: HookDryRunRequest, lastTx?: TransactionContext | null): any => {
    if (req.customContext?.ctx !== undefined) return req.customContext.ctx;
    if (req.stage === 'onStreamChunk') {
      return {
        chunkIndex: lastTx?.sampleStreamChunkIndex ?? 0,
        rawChunk: lastTx?.sampleStreamChunk || '',
        client: lastTx?.request?.client || 'AI Client',
      };
    }
    return lastTx?.response || {
      status: 200,
      headers: { 'content-type': 'application/json' },
      isStream: false,
      client: lastTx?.request?.client || 'AI Client',
    };
  };
}
