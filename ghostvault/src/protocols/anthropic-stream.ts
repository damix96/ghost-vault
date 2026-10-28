import { EventSourceMessage } from 'eventsource-parser';
import { StreamAdapter, StreamContext } from './stream-context.js';
import { Payload } from './types.js';

export class AnthropicStream implements StreamAdapter {
  public matches = (body: Payload): boolean => ['message_start', 'message_delta', 'message_stop', 'content_block_start', 'content_block_delta', 'content_block_stop'].includes(body.type);

  public handle = (body: Payload, event: EventSourceMessage, context: StreamContext): void => {
    const prefix = 'anthropic:' + body.index + ':';
    if (body.type === 'content_block_delta') {
      const field = body.delta?.type === 'input_json_delta' ? 'partial_json' : (body.delta?.type === 'text_delta' ? 'text' : null);
      if (field) {
        const template = structuredClone(body);
        const emit = (value: string): void => context.write(event, { ...template, delta: { ...template.delta, [field]: value } });
        if (field === 'partial_json') context.arguments(prefix + field, body.delta[field] || '', emit);
        else context.text(prefix + field, body.delta[field] || '', emit);
        return;
      }
    }
    if (body.type === 'content_block_stop') context.flush(prefix);
    if (body.type === 'message_stop') context.flush('anthropic:');
    if (body.type === 'content_block_start' && body.content_block) {
      body.content_block = (context.snapshot({ content: [body.content_block] }) as Payload).content[0];
    }
    if (body.type === 'message_start' && body.message) body.message = context.snapshot(body.message);
    context.write(event, body);
  };
}
