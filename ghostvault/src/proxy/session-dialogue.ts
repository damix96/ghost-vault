import { TransactionRow } from '../vault/sqlite-db.js';
import { ResponseNormalizer } from './response-normalizer.js';

export class SessionDialogue {
  private static safeJson = (val: string): any => {
    try {
      const parsed = JSON.parse(val);
      if (parsed !== undefined) return parsed;
    } catch {}
    return val;
  };

  public static buildChain = (txs: TransactionRow[]): any[] => {
    const chronological = [...txs].reverse();
    const allMessages: any[] = [];

    for (const tx of chronological) {
      const reqBody = SessionDialogue.safeJson(tx.prompt_text);
      if (reqBody && typeof reqBody === 'object') {
        if (typeof reqBody.system === 'string' && !allMessages.some(m => m.role === 'system')) {
          allMessages.push({ role: 'system', content: reqBody.system });
        }
        if (Array.isArray(reqBody.messages) && reqBody.messages.length > 0) {
          const nonSys = allMessages.filter(m => m.role !== 'system');
          const hasCommonPrefix = reqBody.messages.length >= nonSys.length &&
            nonSys.every((m, idx) => {
              const rm = reqBody.messages[idx];
              return rm && rm.role === m.role && JSON.stringify(rm.content) === JSON.stringify(m.content);
            });

          if (hasCommonPrefix && nonSys.length > 0) {
            const sys = allMessages.filter(m => m.role === 'system');
            allMessages.length = 0;
            allMessages.push(...sys, ...reqBody.messages);
          } else {
            for (const m of reqBody.messages) {
              const last = allMessages[allMessages.length - 1];
              if (!last || last.role !== m.role || JSON.stringify(last.content) !== JSON.stringify(m.content)) {
                allMessages.push(m);
              }
            }
          }
        } else if (tx.prompt_text) {
          allMessages.push({ role: 'user', content: tx.masked_prompt || tx.prompt_text });
        }
      } else if (tx.prompt_text) {
        allMessages.push({ role: 'user', content: tx.masked_prompt || tx.prompt_text });
      }

      const respObj = ResponseNormalizer.normalize(SessionDialogue.safeJson(tx.model_response));
      if (respObj && typeof respObj === 'object') {
        if (respObj.choices?.[0]?.message) {
          allMessages.push(respObj.choices[0].message);
        } else if (Array.isArray(respObj.content)) {
          allMessages.push({ role: 'assistant', content: respObj.content });
        } else if (typeof respObj.content === 'string') {
          allMessages.push({ role: 'assistant', content: respObj.content });
        } else if (respObj.text) {
          allMessages.push({ role: 'assistant', content: respObj.text });
        }
      } else if (typeof tx.model_response === 'string' && tx.model_response) {
        allMessages.push({ role: 'assistant', content: tx.model_response });
      }
    }

    return allMessages;
  };
}
