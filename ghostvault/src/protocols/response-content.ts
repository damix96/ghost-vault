import { Payload } from './types.js';

export class ResponseContent {
  private static blocks = (blocks: any[]): Payload[] => blocks.map(block => {
    if (typeof block === 'string') return { type: 'text', text: block };
    if (['input_text', 'output_text', 'summary_text'].includes(block?.type)) return { ...block, type: 'text' };
    if (block?.type === 'refusal') return { ...block, type: 'text', text: block.refusal };
    return block;
  });

  public static json = (value: any): any => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
  };

  public static tool = (name: string, input: any, id?: string): Payload =>
    ({ type: 'tool_use', name: name || 'tool', input: ResponseContent.json(input) ?? {}, ...(id ? { id } : {}) });

  public static read = (body: Payload): Payload[] => {
    const content: Payload[] = [];
    if (Array.isArray(body.content)) return ResponseContent.blocks(body.content);
    for (const choice of body.choices || []) {
      const message = choice.message || choice.delta || {};
      if (typeof message.content === 'string' && message.content) content.push({ type: 'text', text: message.content });
      if (Array.isArray(message.content)) content.push(...ResponseContent.blocks(message.content));
      for (const call of message.tool_calls || []) content.push(ResponseContent.tool(call.function?.name, call.function?.arguments, call.id));
      if (message.function_call) content.push(ResponseContent.tool(message.function_call.name, message.function_call.arguments));
    }
    for (const item of body.output || []) {
      if (item.type === 'message') content.push(...ResponseContent.blocks(item.content || []));
      if (['function_call', 'mcp_call'].includes(item.type)) content.push(ResponseContent.tool(item.name, item.arguments, item.call_id || item.id));
      if (item.type === 'custom_tool_call') content.push(ResponseContent.tool(item.name, item.input, item.call_id || item.id));
    }
    for (const candidate of (body.response || body).candidates || []) {
      for (const part of candidate.content?.parts || []) {
        if (part.text && !part.thought) content.push({ type: 'text', text: part.text });
        if (part.functionCall) content.push(ResponseContent.tool(part.functionCall.name, part.functionCall.args, part.functionCall.id));
        if (part.executableCode?.code) content.push({ type: 'text', text: part.executableCode.code });
        if (part.codeExecutionResult?.output) content.push({ type: 'text', text: part.codeExecutionResult.output });
      }
    }
    if (!content.length && typeof body.text === 'string') content.push({ type: 'text', text: body.text });
    return content;
  };
}
