import { TransactionRecord } from '../telemetry/types.js';
import { ResponseNormalizer } from './response-normalizer.js';

export class SessionDialogue {
  public static latest = (record?: TransactionRecord): unknown[] => {
    if (!record) return [];
    let body = record.request.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch {} }
    const messages: unknown[] = [];
    if (body?.system !== undefined) messages.push({ role: 'system', content: body.system });
    if (Array.isArray(body?.messages)) messages.push(...body.messages);
    else if (body !== undefined) messages.push({ role: 'user', content: body });
    if (record.response) messages.push({ role: 'assistant', content: ResponseNormalizer.normalize(record.response.body) });
    return messages;
  };
}
