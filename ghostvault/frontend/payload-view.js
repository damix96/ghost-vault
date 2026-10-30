import { Ui } from './ui-components.js';
import { CodeView } from './code-view.js';

export class PayloadView {
  constructor(secrets) { this.secrets = secrets; }

  static parse = value => {
    if (typeof value !== 'string') return value;
    try { return JSON.parse(value); } catch { return value; }
  };

  render = (value, label = 'Содержимое', path = 'payload') => {
    const data = value;
    if (typeof data === 'string') return Ui.message(label, `<div class="app-prose">${this.secrets.render(data)}</div>`, '', path);
    if (data === undefined || data === null) return Ui.empty('Сохранённое содержимое недоступно');
    if (Array.isArray(data)) return data.map((item, index) => this.block(item, `${label} ${index + 1}`, `${path}.${index}`)).join('');
    if (typeof data !== 'object') return Ui.code(data);
    if (data.role || data.type || data.functionCall || data.functionResponse) return this.block(data, label, path);
    const known = new Set(['messages', 'input', 'contents', 'parts', 'system', 'systemInstruction', 'system_instruction', 'instructions', 'content', 'output', 'choices', 'candidates', 'request', 'response']);
    const content = Object.entries(data).filter(([key]) => known.has(key)).map(([key, item]) => {
      const title = { system: 'Системные инструкции', systemInstruction: 'Системные инструкции', system_instruction: 'Системные инструкции', instructions: 'Инструкции', messages: 'Сообщения', input: 'Входное содержимое', content: 'Содержимое', contents: 'Сообщения', parts: 'Содержимое', output: 'Выходное содержимое', choices: 'Ответы', candidates: 'Кандидаты ответа', request: 'Запрос', response: 'Ответ' }[key];
      return this.render(item, title, `${path}.${key}`);
    }).join('');
    const rest = Object.fromEntries(Object.entries(data).filter(([key]) => !known.has(key)));
    return content + (Object.keys(rest).length ? Ui.details(content ? 'Остальные поля · ' + Object.keys(rest).length : label + ' · сохранённый JSON', this.json(rest), path + '.rest') : '');
  };

  block = (value, fallback, path) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return this.render(value, fallback, path);
    const role = { system: 'Система', developer: 'Разработчик', user: 'Пользователь', assistant: 'Ассистент', model: 'Ассистент', tool: 'Результат инструмента', function: 'Результат функции' }[value.role] || value.role;
    const type = value.type || '';
    if (['text', 'input_text', 'output_text'].includes(type) && typeof value.text === 'string' && !role) {
      const extra = Object.fromEntries(Object.entries(value).filter(([key]) => !['type', 'text'].includes(key)));
      return '<div class="app-prose">' + this.secrets.render(value.text) + '</div>' + (Object.keys(extra).length ? Ui.details('Поля блока', this.json(extra), path + '.rest') : '');
    }
    const title = role || (value.functionCall ? 'Вызов функции' : value.functionResponse ? 'Результат функции' : '') || ({ function: 'Вызов функции', tool_use: 'Вызов инструмента', server_tool_use: 'Вызов инструмента', tool_result: 'Результат инструмента', function_call: 'Вызов функции', function_call_output: 'Результат функции', mcp_call: 'Вызов MCP', custom_tool_call: 'Вызов инструмента' }[type]) || (type ? `Блок: ${type}` : fallback);
    const identity = [value.name || value.function?.name || value.functionCall?.name || value.functionResponse?.name, value.id, value.call_id, value.tool_call_id, value.tool_use_id].filter(Boolean).join(' · ');
    let html = '';
    const processed = new Set(['role', 'type']);
    for (const field of ['text', 'refusal', 'thinking', 'reasoning_content', 'content', 'parts', 'message', 'delta', 'function', 'functionCall', 'functionResponse', 'tool_calls', 'function_call', 'input', 'arguments', 'output']) {
      if (value[field] === undefined) continue;
      processed.add(field);
      if (typeof value[field] === 'string' && ['text', 'refusal', 'thinking', 'reasoning_content', 'content'].includes(field)) html += `<div class="app-prose">${this.secrets.render(value[field])}</div>`;
      else html += this.render(value[field], field, `${path}.${field}`);
    }
    const rest = Object.fromEntries(Object.entries(value).filter(([key]) => !processed.has(key)));
    if (Object.keys(rest).length) html += Ui.details('Сохранённые поля · ' + Object.keys(rest).length, this.json(rest), path + '.rest');
    return Ui.message(title + (identity ? ' · ' + identity : ''), html || this.json(value), role === 'Ассистент' ? 'assistant' : '', path);
  };

  json = value => CodeView.render(value, text => this.secrets.render(text));

  saved = (value, path) => Ui.details('Полная сохранённая структура JSON', this.json(PayloadView.parse(value)), path + '.full');
}
