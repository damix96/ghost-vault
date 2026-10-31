export class MessageOrder {
  static blocks = item => [item, ...(Array.isArray(item?.content) ? item.content : []), ...(Array.isArray(item?.parts) ? item.parts : [])];
  static calls = item => MessageOrder.blocks(item).some(block => block?.tool_calls?.length || block?.function_call || block?.functionCall || ['tool_use', 'server_tool_use', 'function_call', 'mcp_call', 'custom_tool_call'].includes(block?.type));
  static results = item => MessageOrder.blocks(item).some(block => ['tool', 'function'].includes(block?.role) || block?.functionResponse || ['tool_result', 'function_call_output', 'custom_tool_call_output'].includes(block?.type));
  static ordered = (items, path, order) => {
    const entries = items.map((value, index) => ({ value, index }));
    if (order !== 'newest' || !/\.(messages|contents|input|output)$/.test(path)) return entries;
    const groups = [];
    for (let index = 0; index < entries.length; index++) {
      const group = [entries[index]];
      if (MessageOrder.calls(entries[index].value)) {
        while (index + 1 < entries.length && (MessageOrder.results(entries[index + 1].value) || ['assistant', 'model'].includes(entries[index + 1].value?.role))) group.push(entries[++index]);
      }
      groups.push(group);
    }
    return groups.reverse().flat();
  };
}
