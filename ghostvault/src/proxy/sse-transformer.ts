import { createParser, EventSourceMessage } from 'eventsource-parser';
import { VaultStore } from '../vault/store.js';
import { PayloadCodec } from '../protocols/payload-codec.js';
import { StreamBuffers } from '../protocols/stream-buffers.js';
import { StreamAdapter, StreamContext } from '../protocols/stream-context.js';
import { ChatStream } from '../protocols/chat-stream.js';
import { AnthropicStream } from '../protocols/anthropic-stream.js';
import { ResponsesStream } from '../protocols/responses-stream.js';
import { GeminiStream } from '../protocols/gemini-stream.js';

export class SseTransformer {
  private output: string[] = [];
  private sequence = 0;
  private buffers: StreamBuffers;
  private context: StreamContext;
  private parser = createParser({ onEvent: event => this.handleEvent(event) });

  constructor(vault: VaultStore, windowSize: number, onValue: (text: string) => void, private adapters: StreamAdapter[] = [new ChatStream(), new AnthropicStream(), new ResponsesStream(), new GeminiStream()]) {
    this.buffers = new StreamBuffers(vault, windowSize, onValue);
    const transform = (text: string): string => { onValue(text); return vault.unmaskInboundText(text); };
    const codec = new PayloadCodec();
    this.context = {
      write: this.write,
      text: (key, value, emit) => this.buffers.append(key, value, emit),
      arguments: (key, value, emit) => this.buffers.append(key, value, emit, true),
      flush: this.buffers.flush,
      transform,
      snapshot: body => codec.response(body, transform),
    };
  }

  private write = (event: EventSourceMessage, payload: any): void => {
    if (typeof payload?.sequence_number === 'number') payload = { ...payload, sequence_number: this.sequence++ };
    this.output.push((event.id ? 'id: ' + event.id + '\n' : '') + (event.event ? 'event: ' + event.event + '\n' : '') + 'data: ' + (typeof payload === 'string' ? payload : JSON.stringify(payload)) + '\n\n');
  };

  private handleEvent = (event: EventSourceMessage): void => {
    if (event.data === '[DONE]') { this.buffers.flush(); this.write(event, event.data); return; }
    let body: any;
    try { body = JSON.parse(event.data); } catch { this.write(event, event.data); return; }
    const adapter = body && typeof body === 'object' ? this.adapters.find(candidate => candidate.matches(body)) : undefined;
    if (adapter) adapter.handle(body, event, this.context);
    else this.write(event, body && typeof body === 'object' ? body : event.data);
  };

  public push = (text: string): string => {
    this.output = [];
    this.parser.feed(text);
    return this.output.join('');
  };

  public flush = (includeArguments = true): string => {
    this.output = [];
    this.buffers.flush('', includeArguments);
    return this.output.join('');
  };
}
