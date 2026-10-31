import { once } from 'node:events';
import { FastifyReply } from 'fastify';
import { VaultStore } from '../vault/store.js';
import { HookManager } from '../hooks/manager.js';
import { ResponseContext } from '../hooks/types.js';
import { EventBroadcaster } from '../telemetry/event-broadcaster.js';
import { SseTransformer } from './sse-transformer.js';
import { ResponseNormalizer } from './response-normalizer.js';

export interface StreamIdentity {
  txId: string;
  sessionId: string;
  client: string;
}

export class StreamRelay {
  constructor(private vault: Pick<VaultStore, 'getInboundReplacements' | 'unmaskInboundText'>, private hooks: HookManager, private events: EventBroadcaster, private windowSize: number) {}

  public run = async (upstream: Response, reply: FastifyReply, context: ResponseContext, identity: StreamIdentity, onValue: (text: string) => void, onProgress: (body: string, sample: string) => boolean = () => true) => {
    const transformer = new SseTransformer(this.vault, this.windowSize, onValue);
    const decoder = new TextDecoder();
    let accumulatedText = '';
    let sampleStreamChunk = '';
    let totalChunks = 0;
    let lastProgress = 0;
    const write = async (text: string): Promise<void> => {
      if (!text) return;
      if (reply.raw.destroyed) throw new Error('Client disconnected');
      if (!sampleStreamChunk) sampleStreamChunk = text;
      const hooked = await this.hooks.runStreamChunk(text, { chunkIndex: totalChunks++, rawChunk: text, client: identity.client });
      accumulatedText += hooked;
      if (!reply.raw.write(hooked)) await once(reply.raw, 'drain', { signal: AbortSignal.timeout(30000) });
      if (Date.now() - lastProgress < 250) return;
      lastProgress = Date.now();
      if (!onProgress(accumulatedText, sampleStreamChunk)) return;
      const normalized = ResponseNormalizer.normalize(accumulatedText);
      const preview = (normalized?.content || []).filter((block: any) => block.type === 'text').map((block: any) => block.text).join('');
      this.events.broadcast({ id: identity.txId + '-progress-' + totalChunks, type: 'stream_progress', timestamp: new Date().toISOString(), client: identity.client, details: { sessionId: identity.sessionId, transactionId: identity.txId, text: preview } });
      lastProgress = Date.now();
    };
    try {
      await this.hooks.runBeforeStream(context);
      reply.hijack();
      reply.raw.writeHead(upstream.status, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', 'connection': 'keep-alive', 'x-accel-buffering': 'no' });
      if (upstream.body) {
        for await (const chunk of upstream.body as unknown as AsyncIterable<Uint8Array>) await write(transformer.push(decoder.decode(chunk, { stream: true })));
      }
      await write(transformer.push(decoder.decode()) + transformer.flush());
    } catch (error: any) {
      try { await write(transformer.flush(false)); } catch {}
      context.status = reply.raw.destroyed ? 499 : 502;
      const message = 'Stream interrupted: ' + String(error?.message || error);
      const errorEvent = 'event: error\ndata: ' + JSON.stringify({ type: 'error', error: { type: 'upstream_error', message } }) + '\n\n';
      accumulatedText += errorEvent;
      if (!reply.raw.destroyed) {
        if (reply.raw.headersSent) reply.raw.write(errorEvent);
        else reply.status(502).send({ error: message });
      }
    } finally {
      if (reply.raw.headersSent && !reply.raw.writableEnded && !reply.raw.destroyed) reply.raw.end();
    }
    context.body = accumulatedText;
    return { accumulatedText, sampleStreamChunk, totalChunks };
  };
}
