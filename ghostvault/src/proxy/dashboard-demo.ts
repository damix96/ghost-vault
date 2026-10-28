import { VaultStore } from '../vault/store.js';
import { SecretEntry } from '../types/index.js';
import { TransactionRecord, SecretInterception } from '../telemetry/types.js';

export class DashboardDemo {
  constructor(private vault: VaultStore, private recordTransaction: (record: TransactionRecord) => void, private recordInterception: (direction: 'outbound' | 'inbound', client: string, secret: SecretEntry) => void) {}

  public execute = (): TransactionRecord => {
    const active = this.vault.getAllActiveSecrets();
    const secret: SecretEntry = active[0] || {
      key: 'DEMO_API_URL',
      realValue: 'https://internal.corp.local/api/v1',
      alias: '$${<DEMO_API_URL>}',
      maskInAi: true,
      description: 'Demo test ping secret',
      variants: VaultStore.computeVariants('https://internal.corp.local/api/v1'),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const prompt = 'Check balance and account status at ' + secret.realValue + '/accounts';
    const txId = 'tx-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
    const intercepted: SecretInterception[] = [{ key: secret.key, alias: secret.alias, realValue: secret.realValue, count: 1, direction: 'outbound' }];
    const record: TransactionRecord = {
      id: txId,
      sessionId: 'session-' + Date.now().toString(36),
      targetProvider: 'Anthropic',
      targetUrl: 'https://api.anthropic.com/v1/messages',
      latencyMs: 14,
      maskedPrompt: 'Check balance and account status at ' + secret.alias + '/accounts',
      request: { method: 'POST', url: '/v1/messages', targetUrl: 'https://api.anthropic.com/v1/messages', headers: { 'content-type': 'application/json', 'user-agent': 'Claude Code/1.0' }, body: { messages: [{ role: 'user', content: prompt }] }, client: 'Claude Code' },
      response: { status: 200, headers: { 'content-type': 'application/json' }, body: { content: [{ type: 'text', text: 'Queried ' + secret.alias }, { type: 'tool_use', id: 'call_ping', name: 'bash', input: { command: 'curl ' + secret.realValue } }] }, isStream: false, client: 'Claude Code' },
      sampleStreamChunk: 'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"' + secret.alias + '"}}\n\n',
      sampleStreamChunkIndex: 0,
      interceptedSecrets: intercepted,
      timestamp: new Date().toISOString(),
    };
    this.recordInterception('outbound', 'Claude Code', secret);
    this.recordTransaction(record);
    return record;
  };
}
