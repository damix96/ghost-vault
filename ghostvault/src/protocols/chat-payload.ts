import { ContentFields } from './content-fields.js';
import { Payload, PayloadAdapter, TextTransform } from './types.js';

export class ChatPayload implements PayloadAdapter {
  public matchesRequest = (body: Payload, url: string): boolean =>
    Array.isArray(body.messages) && !body.system && !/\/messages(?:\?|$)/.test(url);

  public matchesResponse = (body: Payload): boolean => Array.isArray(body.choices);

  private message = (message: Payload, transform: TextTransform): void => {
    if (!message || typeof message !== 'object') return;
    if (message.content !== undefined) message.content = ContentFields.content(message.content, transform);
    for (const field of ['refusal', 'reasoning_content']) ContentFields.text(message, field, transform);
    for (const call of message.tool_calls || []) {
      if (call.function) ContentFields.json(call.function, 'arguments', transform);
    }
    if (message.function_call) ContentFields.json(message.function_call, 'arguments', transform);
  };

  public request = (body: Payload, transform: TextTransform): void => {
    for (const message of body.messages || []) this.message(message, transform);
  };

  public response = (body: Payload, transform: TextTransform): void => {
    for (const choice of body.choices || []) {
      if (choice.message) this.message(choice.message, transform);
      if (typeof choice.text === 'string') ContentFields.text(choice, 'text', transform);
    }
  };
}
