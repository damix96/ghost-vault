import { EventSourceMessage } from 'eventsource-parser';
import { Payload, TextTransform } from './types.js';

export interface StreamContext {
  write(event: EventSourceMessage, payload: unknown): void;
  text(key: string, value: string, emit: (value: string) => void): void;
  arguments(key: string, value: string, emit: (value: string) => void): void;
  flush(prefix?: string, includeArguments?: boolean): void;
  transform: TextTransform;
  snapshot(body: unknown): unknown;
}

export interface StreamAdapter {
  matches(body: Payload): boolean;
  handle(body: Payload, event: EventSourceMessage, context: StreamContext): void;
}
