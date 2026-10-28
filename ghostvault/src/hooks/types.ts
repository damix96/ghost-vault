export interface RequestContext {
  method: string;
  url: string;
  targetUrl?: string;
  headers: Record<string, string>;
  body?: any;
  client: string;
}

export interface ResponseContext {
  status: number;
  headers: Record<string, string>;
  body?: any;
  isStream: boolean;
  client: string;
}

export interface StreamChunkContext {
  chunkIndex: number;
  rawChunk: string;
  client: string;
}

export interface StreamEndContext {
  totalChunks: number;
  accumulatedText: string;
  client: string;
}

export interface GhostVaultHook {
  beforeOutboundRequest?: (ctx: RequestContext) => Promise<RequestContext | void> | RequestContext | void;
  afterOutboundMask?: (body: string, ctx: RequestContext) => Promise<string | void> | string | void;
  beforeInboundResponse?: (rawText: string, ctx: ResponseContext) => Promise<string | void> | string | void;
  afterInboundUnmask?: (unmaskedText: string, ctx: ResponseContext) => Promise<string | void> | string | void;
  beforeStream?: (ctx: ResponseContext) => Promise<void> | void;
  onStreamChunk?: (chunk: string, ctx: StreamChunkContext) => Promise<string | void> | string | void;
  afterStream?: (ctx: StreamEndContext) => Promise<void> | void;
}
