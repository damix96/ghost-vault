import { AnthropicPayload } from './anthropic-payload.js';
import { ChatPayload } from './chat-payload.js';
import { GeminiPayload } from './gemini-payload.js';
import { ResponsesPayload } from './responses-payload.js';
import { PayloadAdapter, TextTransform } from './types.js';

export class PayloadCodec {
  constructor(private adapters: PayloadAdapter[] = [new GeminiPayload(), new ResponsesPayload(), new AnthropicPayload(), new ChatPayload()]) {}

  public request = (body: unknown, url: string, transform: TextTransform): unknown => {
    if (typeof body === 'string') {
      let parsed: unknown;
      try { parsed = JSON.parse(body); } catch { return transform(body); }
      return JSON.stringify(this.request(parsed, url, transform));
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return body;
    const result = structuredClone(body) as Record<string, any>;
    this.adapters.find(adapter => adapter.matchesRequest(result, url))?.request(result, transform);
    return result;
  };

  public response = (body: unknown, transform: TextTransform): unknown => {
    if (typeof body === 'string') return transform(body);
    if (Array.isArray(body)) return body.map(item => this.response(item, transform));
    if (!body || typeof body !== 'object') return body;
    const result = structuredClone(body) as Record<string, any>;
    this.adapters.find(adapter => adapter.matchesResponse(result))?.response(result, transform);
    return result;
  };
}
