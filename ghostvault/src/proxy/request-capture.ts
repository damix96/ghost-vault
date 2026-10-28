import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { FastifyInstance, FastifyRequest } from 'fastify';
import { CapturedWire, WireCapture } from './wire-capture.js';

interface Capture {
  id: string;
  incomingBytes?: number;
  incomingBodyBytes?: number;
  target?: string;
  status?: number;
  error?: string;
  outgoing: { file: string; destination: string; protocol: string; bytes: number }[];
}

export class RequestCapture {
  private requests = new WeakMap<FastifyRequest, Capture>();
  private claimed = false;
  private wire?: WireCapture<Capture>;

  constructor(private directory = process.env.GHOSTVAULT_CAPTURE_DIR) {}

  public install = (app: FastifyInstance): void => {
    if (!this.directory) return;
    this.wire = new WireCapture(this.outgoing);
    app.addHook('onClose', async () => this.wire?.close());
    app.addHook('preParsing', (request, _reply, payload, done) => {
      if (this.claimed || request.method !== 'POST' || request.url.startsWith('/api/')) return done(null, payload);
      this.claimed = true;
      const capture: Capture = { id: request.id, outgoing: [] };
      this.requests.set(request, capture);
      const chunks: Buffer[] = [];
      const tap: Transform & { receivedEncodedLength: number } = Object.assign(new Transform({
        transform: (chunk: Buffer, _encoding, callback) => {
          const bytes = Buffer.from(chunk);
          chunks.push(bytes);
          tap.receivedEncodedLength += bytes.length;
          callback(null, chunk);
        },
        flush: callback => {
          this.incoming(request, capture, Buffer.concat(chunks));
          callback();
        },
      }), { receivedEncodedLength: 0 });
      payload.once('error', error => tap.destroy(error));
      done(null, payload.pipe(tap));
    });
  };

  public send = async (request: FastifyRequest, id: string, target: string, operation: () => Promise<Response>): Promise<Response> => {
    const capture = this.requests.get(request);
    if (!capture || !this.wire) return operation();
    capture.id = id;
    capture.target = target;
    try {
      const response = await this.wire.run(capture, operation);
      capture.status = response.status;
      this.metadata(capture);
      return response;
    } catch (error) {
      capture.error = error instanceof Error ? error.message : String(error);
      this.metadata(capture);
      throw error;
    }
  };

  private incoming = (request: FastifyRequest, capture: Capture, body: Buffer): void => {
    const raw = request.raw;
    let headers = `${raw.method} ${raw.url} HTTP/${raw.httpVersion}\r\n`;
    for (let index = 0; index < raw.rawHeaders.length; index += 2) headers += raw.rawHeaders[index] + ': ' + raw.rawHeaders[index + 1] + '\r\n';
    const bytes = Buffer.concat([Buffer.from(headers + '\r\n', 'latin1'), body]);
    capture.incomingBytes = bytes.length;
    capture.incomingBodyBytes = body.length;
    this.write('ghostvault-incoming-request.txt', bytes, capture);
    this.metadata(capture);
  };

  private outgoing = (capture: Capture, request: CapturedWire): void => {
    const file = 'ghostvault-outgoing-request' + (capture.outgoing.length ? '-' + (capture.outgoing.length + 1) : '') + '.txt';
    capture.outgoing.push({ file, destination: request.destination, protocol: request.protocol, bytes: request.bytes.length });
    this.write(file, request.bytes, capture);
    this.metadata(capture);
  };

  private metadata = (capture: Capture): void => {
    this.write('ghostvault-request-capture.json', Buffer.from(JSON.stringify({
      transactionId: capture.id, target: capture.target, responseStatus: capture.status,
      incomingBytes: capture.incomingBytes, incomingBodyBytes: capture.incomingBodyBytes,
      outgoing: capture.outgoing, error: capture.error,
      incomingSource: 'Fastify IncomingMessage.rawHeaders and preParsing original payload bytes',
      outgoingSource: 'Proxy process: undici socket.write for HTTP/1.1; emitted headers and bodyChunkSent for HTTP/2',
    }, null, 2) + '\n'), capture);
  };

  private write = (file: string, bytes: Buffer, capture: Capture): void => {
    try {
      mkdirSync(this.directory!, { recursive: true });
      writeFileSync(path.join(this.directory!, file), bytes);
    } catch (error) {
      capture.error = error instanceof Error ? error.message : 'Capture write failed';
    }
  };
}
