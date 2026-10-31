import { RequestContext, ResponseContext } from '../hooks/types.js';

export interface SecretInterception {
  key: string;
  alias: string;
  realValue: string;
  representations?: ReadonlyArray<{ value: string; alias: string }>;
  count: number;
  direction: 'outbound' | 'inbound';
}

export interface TransactionContext {
  request: RequestContext;
  response?: ResponseContext;
  sampleStreamChunk?: string;
  sampleStreamChunkIndex?: number;
  interceptedSecrets: SecretInterception[];
  timestamp: string;
  maskedPrompt?: string;
}

export interface TransactionRecord extends TransactionContext {
  id: string;
  sessionId?: string;
  state?: 'active' | 'complete';
  latencyMs?: number;
  targetProvider?: string;
  targetUrl?: string;
}

export interface AuditEvent {
  id: string;
  type: 'outbound_masked' | 'inbound_unmasked' | 'stream_unmasked' | 'hook_executed' | 'request_started' | 'transaction_completed' | 'stream_progress' | 'session_removed' | 'sessions_cleared';
  timestamp: string;
  client: string;
  details: Record<string, any>;
}

export interface HookDryRunRequest {
  hookCode?: string;
  hookName?: string;
  stage: string;
  customContext?: any;
}

export interface HookDryRunResult {
  success: boolean;
  input: any;
  output: any;
  durationMs: number;
  error?: string;
}
