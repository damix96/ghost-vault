import { ContentFields } from './content-fields.js';
import { Payload, PayloadAdapter, TextTransform } from './types.js';

export class AnthropicPayload implements PayloadAdapter {
  public matchesRequest = (body: Payload, url: string): boolean =>
    Array.isArray(body.messages) && (body.system !== undefined || /\/messages(?:\?|$)/.test(url));

  public matchesResponse = (body: Payload): boolean => Array.isArray(body.content) || body.type === 'message';

  private content = (value: any, transform: TextTransform): any => {
    if (typeof value === 'string') return transform(value);
    if (!Array.isArray(value)) return value;
    return value.map(block => {
      if (typeof block === 'string') return transform(block);
      if (!block || typeof block !== 'object') return block;
      if (block.type === 'text') ContentFields.text(block, 'text', transform);
      if (['tool_use', 'server_tool_use'].includes(block.type)) block.input = ContentFields.values(block.input, transform);
      if (block.type === 'tool_result') block.content = this.content(block.content, transform);
      if (block.type === 'document' && block.source?.type === 'text') ContentFields.text(block.source, 'data', transform);
      return block;
    });
  };

  public request = (body: Payload, transform: TextTransform): void => {
    if (body.system !== undefined) body.system = this.content(body.system, transform);
    for (const message of body.messages || []) message.content = this.content(message.content, transform);
  };

  public response = (body: Payload, transform: TextTransform): void => {
    if (body.content !== undefined) body.content = this.content(body.content, transform);
  };
}
