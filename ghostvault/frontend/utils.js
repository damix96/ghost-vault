import { RequestContent } from './request-content.js';

export const escapeHtml = str =>
  String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const actionAttributes = (action, ...args) =>
  `data-action="${escapeHtml(action)}" data-args="${escapeHtml(JSON.stringify(args))}"`;

export const formatTimestamp = isoOrMs => {
  if (!isoOrMs) return 'Just now';
  try {
    return new Date(isoOrMs).toLocaleTimeString();
  } catch {
    return String(isoOrMs);
  }
};

export const truncate = (text, maxLength = 64) =>
  String(text ?? '').length > maxLength
    ? String(text).slice(0, maxLength) + '...'
    : String(text ?? '');

export const extractSnippets = (text, targetTerms = [], radius = 70) => {
  if (!text) return [];
  const terms = targetTerms.filter(Boolean);
  if (!terms.length) return [text.length > 200 ? text.slice(0, 200) + '...' : text];
  const ranges = [];
  terms.forEach(term => {
    let pos = 0;
    while ((pos = text.indexOf(term, pos)) !== -1) {
      ranges.push([Math.max(0, pos - radius), Math.min(text.length, pos + term.length + radius)]);
      pos += term.length;
    }
  });
  if (!ranges.length) return [text.length > 200 ? text.slice(0, 200) + '...' : text];
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [ranges[0]];
  for (let i = 1; i < ranges.length; i++) {
    const last = merged[merged.length - 1];
    if (ranges[i][0] <= last[1]) last[1] = Math.max(last[1], ranges[i][1]);
    else merged.push(ranges[i]);
  }
  return merged.map(([start, end]) => {
    const prefix = start > 0 ? '...' : '';
    const suffix = end < text.length ? '...' : '';
    return prefix + text.slice(start, end) + suffix;
  });
};

export const renderInteractiveToken = (alias, realValue) => `<gv-action size="compact" label="${escapeHtml(alias)}" ${actionAttributes('token-copy', realValue ?? alias)} hint="${escapeHtml('Подстановка: ' + alias + '\nРеальное значение: ' + (realValue ?? alias) + '\nНажмите для копирования реального значения.')}"></gv-action>`;

export const highlightTokens = (rawText, secrets = []) => {
  if (!rawText) return '';
  const text = String(rawText);
  const secretMap = new Map();
  for (const s of secrets) {
    if (s.alias && !secretMap.has(s.alias)) secretMap.set(s.alias, s);
  }
  const aliases = Array.from(secretMap.keys()).sort((a, b) => b.length - a.length);
  if (!aliases.length) return escapeHtml(text);

  const matches = [];
  for (const alias of aliases) {
    let pos = 0;
    while ((pos = text.indexOf(alias, pos)) !== -1) {
      matches.push({ start: pos, end: pos + alias.length, alias, secret: secretMap.get(alias) });
      pos += alias.length;
    }
  }
  if (!matches.length) return escapeHtml(text);

  matches.sort((a, b) => a.start - b.start);
  const filtered = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  let result = '';
  let cursor = 0;
  for (const m of filtered) {
    if (m.start > cursor) result += escapeHtml(text.slice(cursor, m.start));
    result += renderInteractiveToken(m.alias, m.secret?.realValue);
    cursor = m.end;
  }
  if (cursor < text.length) result += escapeHtml(text.slice(cursor));
  return result;
};

export const highlightOriginalTokens = (rawText, secrets = []) => {
  if (!rawText) return '';
  const text = String(rawText);
  const secretMap = new Map();
  for (const s of secrets) {
    if (s.realValue && !secretMap.has(s.realValue)) secretMap.set(s.realValue, s);
  }
  const realValues = Array.from(secretMap.keys()).sort((a, b) => b.length - a.length);
  if (!realValues.length) return escapeHtml(text);

  const matches = [];
  for (const realVal of realValues) {
    let pos = 0;
    while ((pos = text.indexOf(realVal, pos)) !== -1) {
      matches.push({ start: pos, end: pos + realVal.length, secret: secretMap.get(realVal) });
      pos += realVal.length;
    }
  }
  if (!matches.length) return escapeHtml(text);

  matches.sort((a, b) => a.start - b.start);
  const filtered = [];
  let lastEnd = 0;
  for (const m of matches) {
    if (m.start >= lastEnd) {
      filtered.push(m);
      lastEnd = m.end;
    }
  }

  let result = '';
  let cursor = 0;
  for (const m of filtered) {
    if (m.start > cursor) result += escapeHtml(text.slice(cursor, m.start));
    result += renderInteractiveToken(m.secret.realValue, m.secret.realValue);
    cursor = m.end;
  }
  if (cursor < text.length) result += escapeHtml(text.slice(cursor));
  return result;
};

export const parsePromptText = req => {
  const text = RequestContent.all(req?.body);
  if (text) return text;
  return JSON.stringify(req?.body || {});
};

export const parseOutboundRaw = (step, promptText) => {
  if (step?.maskedPrompt) {
    const text = RequestContent.all(step.maskedPrompt);
    if (text) return text;
    if (typeof step.maskedPrompt === 'string') return step.maskedPrompt;
    return JSON.stringify(step.maskedPrompt);
  }
  let out = promptText;
  for (const s of (step?.interceptedSecrets || [])) {
    if (s.realValue && s.alias) out = out.split(s.realValue).join(s.alias);
  }
  return out;
};

export const parseResponseText = res => {
  const body = res?.body;
  if (!body) return '';
  if (typeof body === 'string') return body;
  if (Array.isArray(body.content)) {
    return body.content.filter(c => c.type === 'text').map(c => c.text).join('\n');
  }
  if (body.choices?.[0]?.message?.content) {
    return body.choices[0].message.content;
  }
  return '';
};

export const parseToolCalls = res => {
  const body = res?.body;
  if (!body) return [];
  if (Array.isArray(body.content)) {
    return body.content.filter(c => c.type === 'tool_use').map(c => ({ name: c.name, input: c.input }));
  }
  if (Array.isArray(body.choices?.[0]?.message?.tool_calls)) {
    return body.choices[0].message.tool_calls.map(tc => ({ name: tc.function?.name || 'tool', input: tc.function?.arguments }));
  }
  return [];
};
