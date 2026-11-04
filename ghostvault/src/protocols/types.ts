export type TextTransform = (text: string, source?: 'tool-arguments') => string;
export type Payload = Record<string, any>;

export interface PayloadAdapter {
  matchesRequest(body: Payload, url: string): boolean;
  matchesResponse(body: Payload): boolean;
  request(body: Payload, transform: TextTransform): void;
  response(body: Payload, transform: TextTransform): void;
}

export interface ContentBlock extends Payload {
  type?: string;
}
