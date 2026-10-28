import { ContentFields } from './content-fields.js';
import { Payload, PayloadAdapter, TextTransform } from './types.js';

export class ResponsesPayload implements PayloadAdapter {
  public matchesRequest = (body: Payload, url: string): boolean =>
    body.input !== undefined || /\/responses(?:\?|$)/.test(url);

  public matchesResponse = (body: Payload): boolean => Array.isArray(body.output) || body.object === 'response';

  public item = (item: Payload, transform: TextTransform): void => {
    if (!item || typeof item !== 'object') return;
    if (item.type === 'message' || item.role) item.content = ContentFields.content(item.content, transform);
    if (['function_call', 'mcp_call'].includes(item.type)) ContentFields.json(item, 'arguments', transform);
    if (['function_call_output', 'custom_tool_call_output'].includes(item.type)) {
      item.output = typeof item.output === 'object' && !Array.isArray(item.output)
        ? ContentFields.values(item.output, transform)
        : ContentFields.content(item.output, transform);
    }
    if (item.type === 'custom_tool_call') ContentFields.text(item, 'input', transform);
    if (item.type === 'reasoning') {
      item.summary = ContentFields.content(item.summary, transform);
      for (const part of item.summary || []) if (part?.type === 'summary_text') ContentFields.text(part, 'text', transform);
    }
  };

  public request = (body: Payload, transform: TextTransform): void => {
    ContentFields.text(body, 'instructions', transform);
    if (typeof body.input === 'string') body.input = transform(body.input);
    else for (const item of body.input || []) this.item(item, transform);
  };

  public response = (body: Payload, transform: TextTransform): void => {
    for (const item of body.output || []) this.item(item, transform);
    ContentFields.text(body, 'output_text', transform);
  };
}
