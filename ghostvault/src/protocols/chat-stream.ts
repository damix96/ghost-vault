import { EventSourceMessage } from 'eventsource-parser';
import { StreamAdapter, StreamContext } from './stream-context.js';
import { Payload } from './types.js';

export class ChatStream implements StreamAdapter {
  public matches = (body: Payload): boolean => Array.isArray(body.choices);

  public handle = (body: Payload, event: EventSourceMessage, context: StreamContext): void => {
    for (const choice of body.choices) {
      const prefix = 'chat:' + (choice.index ?? 0) + ':';
      const template = structuredClone(body);
      const emit = (delta: Payload): void => context.write(event, { ...template, choices: [{ index: choice.index ?? 0, delta, finish_reason: null }] });
      const delta = choice.delta;
      if (delta) {
        for (const field of ['content', 'reasoning_content', 'refusal']) {
          if (typeof delta[field] !== 'string') continue;
          context.text(prefix + field, delta[field], value => emit({ [field]: value }));
          delta[field] = '';
        }
        for (const tool of delta.tool_calls || []) {
          if (typeof tool.function?.arguments !== 'string') continue;
          const index = tool.index ?? 0;
          context.arguments(prefix + 'tool:' + index, tool.function.arguments, value => emit({ tool_calls: [{ index, function: { arguments: value } }] }));
          tool.function.arguments = '';
        }
        if (typeof delta.function_call?.arguments === 'string') {
          context.arguments(prefix + 'function', delta.function_call.arguments, value => emit({ function_call: { arguments: value } }));
          delta.function_call.arguments = '';
        }
      }
      if (choice.finish_reason) context.flush(prefix);
    }
    context.write(event, context.snapshot(body));
  };
}
