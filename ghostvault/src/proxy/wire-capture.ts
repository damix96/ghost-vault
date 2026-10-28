import { AsyncLocalStorage } from 'node:async_hooks';
import { channel } from 'node:diagnostics_channel';
import { Socket } from 'node:net';

export interface CapturedWire {
  destination: string;
  protocol: 'HTTP/1.1' | 'HTTP/2';
  bytes: Buffer;
}

interface WireMessage {
  request: object & { origin?: string; path?: string };
  headers?: string;
  chunk?: Uint8Array;
  socket?: Socket & { alpnProtocol?: string | false };
}

interface Attempt<T> {
  context: T;
  destination: string;
  protocol?: CapturedWire['protocol'];
  headers?: string;
  chunks: Buffer[];
  restore?: () => void;
}

export class WireCapture<T> {
  private scope = new AsyncLocalStorage<T>();
  private requests = new WeakMap<object, Attempt<T>>();
  private restores = new Set<() => void>();
  private subscriptions: [string, (message: unknown) => void][] = [
    ['undici:request:create', message => this.create(message as WireMessage)],
    ['undici:client:sendHeaders', message => this.headers(message as WireMessage)],
    ['undici:request:bodyChunkSent', message => this.body(message as WireMessage)],
    ['undici:request:bodySent', message => this.finish(message as WireMessage)],
    ['undici:request:error', message => this.abort(message as WireMessage)],
  ];

  constructor(private onCapture: (context: T, request: CapturedWire) => void) {
    for (const [name, callback] of this.subscriptions) channel(name).subscribe(callback);
  }

  public run = <R>(context: T, operation: () => R): R => this.scope.run(context, operation);

  public close = (): void => {
    for (const restore of this.restores) restore();
    for (const [name, callback] of this.subscriptions) channel(name).unsubscribe(callback);
  };

  private create = ({ request }: WireMessage): void => {
    const context = this.scope.getStore();
    if (context) this.requests.set(request, { context, destination: String(request.origin || '') + String(request.path || ''), chunks: [] });
  };

  private headers = ({ request, socket, headers }: WireMessage): void => {
    const attempt = this.requests.get(request);
    if (!attempt || !socket) return;
    attempt.protocol = socket.alpnProtocol === 'h2' ? 'HTTP/2' : 'HTTP/1.1';
    attempt.headers = headers;
    if (attempt.protocol === 'HTTP/2') return;
    const original = socket.write;
    const wrapped = ((chunk: Uint8Array | string, ...args: unknown[]): boolean => {
      attempt.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, typeof args[0] === 'string' ? args[0] as BufferEncoding : 'utf8') : Buffer.from(chunk));
      return Reflect.apply(original, socket, [chunk, ...args]);
    }) as Socket['write'];
    const restore = (): void => {
      if (socket.write === wrapped) socket.write = original;
      this.restores.delete(restore);
    };
    attempt.restore = restore;
    this.restores.add(restore);
    socket.write = wrapped;
  };

  private body = ({ request, chunk }: WireMessage): void => {
    const attempt = this.requests.get(request);
    if (attempt?.protocol === 'HTTP/2' && chunk) attempt.chunks.push(Buffer.from(chunk));
  };

  private finish = ({ request }: WireMessage): void => {
    const attempt = this.requests.get(request);
    if (!attempt?.protocol) return;
    attempt.restore?.();
    const prefix = attempt.protocol === 'HTTP/2' ? [Buffer.from('HTTP/2\r\n' + (attempt.headers || '') + '\r\n')] : [];
    this.onCapture(attempt.context, { destination: attempt.destination, protocol: attempt.protocol, bytes: Buffer.concat([...prefix, ...attempt.chunks]) });
    this.requests.delete(request);
  };

  private abort = ({ request }: WireMessage): void => {
    this.requests.get(request)?.restore?.();
    this.requests.delete(request);
  };
}
