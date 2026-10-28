import { EventSourceMessage } from 'eventsource-parser';
import { ContentFields } from './content-fields.js';
import { ResponsesPayload } from './responses-payload.js';
import { StreamAdapter, StreamContext } from './stream-context.js';
import { Payload } from './types.js';

export class ResponsesStream implements StreamAdapter {
  private payload = new ResponsesPayload();
  private textEvents = new Map([
    ['response.output_text', 'text'],
    ['response.refusal', 'refusal'],
    ['response.reasoning_summary_text', 'text'],
    ['response.reasoning_text', 'text'],
    ['response.audio.transcript', 'transcript'],
    ['response.custom_tool_call_input', 'input'],
  ]);

  public matches = (body: Payload): boolean => typeof body.type === 'string' && body.type.startsWith('response.');

  public handle = (body: Payload, event: EventSourceMessage, context: StreamContext): void => {
    const prefix = 'responses:' + (body.output_index ?? body.item_id ?? 0) + ':';
    const family = body.type.replace(/\.(delta|done)$/, '');
    const textField = this.textEvents.get(family);
    const key = prefix + family + ':' + (body.content_index ?? body.summary_index ?? 0);
    if (textField && body.type.endsWith('.delta') && typeof body.delta === 'string') {
      const template = structuredClone(body);
      context.text(key, body.delta, value => context.write(event, { ...template, delta: value }));
      return;
    }
    const argumentsEvent = ['response.function_call_arguments', 'response.mcp_call_arguments'].includes(family);
    if (argumentsEvent && body.type.endsWith('.delta')) {
      const template = structuredClone(body);
      context.arguments(key, body.delta || '', value => context.write(event, { ...template, delta: value }));
      return;
    }
    if (textField && body.type.endsWith('.done')) {
      context.flush(key);
      ContentFields.text(body, textField, context.transform);
    }
    if (argumentsEvent && body.type.endsWith('.done')) {
      context.flush(key);
      ContentFields.json(body, 'arguments', context.transform);
    }
    if (body.type === 'response.output_item.done' || body.type === 'response.content_part.done') context.flush(prefix);
    if (body.item) this.payload.item(body.item, context.transform);
    if (body.part) body.part = ContentFields.content([body.part], context.transform)[0];
    if (['response.completed', 'response.failed', 'response.incomplete'].includes(body.type)) context.flush('responses:', body.type === 'response.completed');
    if (body.response) body.response = context.snapshot(body.response);
    context.write(event, body);
  };
}
