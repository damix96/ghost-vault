import { createParser } from 'eventsource-parser';
import { Payload } from './types.js';
import { ResponseContent } from './response-content.js';

export class StreamContent {
  private texts = new Map<string, string>();
  private tools = new Map<string, Payload>();
  private completed?: Payload[];
  private serial = 0;

  private text = (key: string, value: string): void => {
    if (value) this.texts.set(key, (this.texts.get(key) || '') + value);
  };

  private tool = (key: string, name?: string, input?: string, id?: string, replace = false): void => {
    const previous = this.tools.get(key) || {};
    this.tools.set(key, { name: name || previous.name, id: id || previous.id, arguments: replace ? (input || '') : (previous.arguments || '') + (input || '') });
  };

  private event = (body: Payload): void => {
    if (body.error?.message) this.text('error', body.error.message);
    for (const choice of body.choices || []) {
      const delta = choice.delta || {};
      const prefix = 'chat:' + (choice.index ?? 0) + ':';
      this.text(prefix + 'text', delta.content || '');
      for (const call of delta.tool_calls || []) this.tool(prefix + (call.index ?? 0), call.function?.name, call.function?.arguments, call.id);
      if (delta.function_call) this.tool(prefix + 'function', delta.function_call.name, delta.function_call.arguments);
    }
    if (body.content_block?.type === 'tool_use') this.tool('anthropic:' + body.index, body.content_block.name, Object.keys(body.content_block.input || {}).length ? JSON.stringify(body.content_block.input) : '', body.content_block.id);
    if (body.content_block?.text) this.text('anthropic:' + body.index, body.content_block.text);
    if (body.delta?.text) this.text('anthropic:' + body.index, body.delta.text);
    if (body.delta?.partial_json) this.tool('anthropic:' + body.index, undefined, body.delta.partial_json);

    const type = body.type || '';
    const prefix = 'responses:' + (body.output_index ?? body.item_id ?? 0) + ':';
    if (['response.output_text.delta', 'response.refusal.delta'].includes(type)) this.text(prefix + (body.content_index ?? 0), body.delta);
    if (['response.function_call_arguments.delta', 'response.mcp_call_arguments.delta', 'response.custom_tool_call_input.delta'].includes(type)) this.tool(prefix, undefined, body.delta);
    if (['response.function_call_arguments.done', 'response.mcp_call_arguments.done'].includes(type)) this.tool(prefix, undefined, body.arguments, undefined, true);
    if (body.item && ['function_call', 'mcp_call', 'custom_tool_call'].includes(body.item.type)) {
      this.tool(prefix, body.item.name, body.item.arguments || body.item.input, body.item.call_id || body.item.id, true);
    }
    if (type === 'response.completed' && body.response) {
      const final = ResponseContent.read(body.response);
      if (final.length) this.completed = final;
    }
    for (const [position, candidate] of ((body.response || body).candidates || []).entries()) {
      for (const [index, part] of (candidate.content?.parts || []).entries()) {
        if (part.text && !part.thought) this.text('gemini:' + (candidate.index ?? position) + ':' + index, part.text);
        if (part.functionCall) this.tool('gemini:tool:' + (part.functionCall.id || this.serial++), part.functionCall.name, JSON.stringify(part.functionCall.args || {}), part.functionCall.id, true);
        if (part.executableCode?.code) this.text('gemini:code:' + position + ':' + index, part.executableCode.code);
        if (part.codeExecutionResult?.output) this.text('gemini:result:' + position + ':' + index, part.codeExecutionResult.output);
      }
    }
  };

  public read = (source: string): Payload[] => {
    const parser = createParser({ onEvent: event => {
      if (event.data === '[DONE]') return;
      try {
        const parsed = JSON.parse(event.data);
        if (parsed && typeof parsed === 'object') this.event(parsed);
      } catch {}
    } });
    parser.feed(source);
    return this.completed || [
      ...[...this.texts.values()].filter(Boolean).map(text => ({ type: 'text', text })),
      ...[...this.tools.values()].map(tool => ResponseContent.tool(tool.name, tool.arguments, tool.id)),
    ];
  };
}
