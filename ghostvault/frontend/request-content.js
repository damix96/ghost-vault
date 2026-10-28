export class RequestContent {
  static text = content => {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(block => {
      if (typeof block === 'string') return block;
      if (typeof block?.text === 'string' && !block.thought) return block.text;
      if (block?.type === 'tool_result') return RequestContent.text(block.content);
      return '';
    }).filter(Boolean).join('\n');
  };

  static messages = body => {
    let request = body;
    if (typeof request === 'string') {
      try { request = JSON.parse(request); } catch { return [{ role: 'user', text: request }]; }
    }
    if (!request || typeof request !== 'object') return [];
    if (Array.isArray(request.messages)) return request.messages.map(message => ({ role: message.role, text: RequestContent.text(message.content) }));
    if (typeof request.input === 'string') return [{ role: 'user', text: request.input }];
    if (Array.isArray(request.input)) return request.input.filter(item => item.role).map(item => ({ role: item.role, text: RequestContent.text(item.content) }));
    const gemini = request.request || request;
    return (Array.isArray(gemini.contents) ? gemini.contents : []).map(content => ({ role: content.role === 'model' ? 'assistant' : 'user', text: RequestContent.text(content.parts) }));
  };

  static all = body => RequestContent.messages(body).map(message => message.text).filter(Boolean).join('\n');

  static lastUser = body => [...RequestContent.messages(body)].reverse().find(message => message.role === 'user')?.text || '';
}
