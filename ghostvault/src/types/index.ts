export interface SecretEntry {
  key: string;
  realValue: string;
  alias: string;
  maskInAi: boolean;
  description?: string;
  variants: {
    [format: string]: string;
    raw: string;
    urlEncoded: string;
    jsonEscaped: string;
    base64: string;
    jsonStringEscaped: string;
    jsonSlashEscaped: string;
  };
  priority?: number;
  createdAt: string;
  updatedAt: string;
}

export type ConfirmationMode = 
  | 'auto' 
  | 'confirm-outbound' 
  | 'confirm-inbound' 
  | 'confirm-all' 
  | 'smart-hybrid';

export interface GhostVaultConfig {
  port: number;
  host: string;
  targetApiBase: string;
  confirmationMode: ConfirmationMode;
  storagePath: string;
  maxBufferWindowChars: number;
  hooksDir?: string;
  demoMode?: boolean;
}

export interface LastCall {
  id: string;
  direction: 'outbound' | 'inbound';
  client: string;
  rawUrl: string;
  alias: string;
  key: string;
  timestamp: string;
}
