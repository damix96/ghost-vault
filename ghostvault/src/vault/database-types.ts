export interface SecretRow {
  key: string;
  real_value: string;
  alias: string;
  mask_in_ai: number;
  description: string;
  created_at: string;
  updated_at: string;
}

export interface AutoSecretRow {
  key: string;
  real_value: string;
  alias: string;
  hit_count: number;
  first_seen_at: string;
  last_seen_at: string;
}

export interface PatternRow {
  id: string;
  name: string;
  pattern: string;
  type: string;
  label_template?: string | null;
  enabled: number;
  created_at: string;
}

export interface SessionRow {
  endpoint?: string;
  endpoints?: string;
  id: string;
  client: string;
  first_seen: string;
  last_seen: string;
  tx_count: number;
}

export interface TransactionRow {
  id: string;
  session_id: string;
  client: string;
  method: string;
  url: string;
  status: number;
  latency_ms: number;
  prompt_text: string;
  masked_prompt: string;
  model_response: string;
  intercepted_secrets: string;
  timestamp: string;
  target_provider?: string;
  target_url?: string;
}

export interface RouteRow {
  id: string;
  name: string;
  prefix: string;
  upstream_url: string;
  description: string;
  is_custom: number;
}
