import { FastifyReply } from 'fastify';
import { AuditEvent } from './types.js';

export class EventBroadcaster {
  private subscribers = new Set<(payload: string) => void>();
  private clients = new Set<FastifyReply>();

  public subscribe = (reply: FastifyReply): void => {
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(': connected\n\n');
    const subscriber = (payload: string): boolean => reply.raw.write(payload);
    this.subscribers.add(subscriber);
    this.clients.add(reply);
    const heartbeat = setInterval(() => reply.raw.write(': heartbeat\n\n'), 15000);
    heartbeat.unref();
    reply.raw.on('close', () => {
      clearInterval(heartbeat);
      this.subscribers.delete(subscriber);
      this.clients.delete(reply);
    });
  };

  public broadcast = (event: AuditEvent): void => {
    const payload = 'data: ' + JSON.stringify(event) + '\n\n';
    for (const sub of this.subscribers) sub(payload);
  };

  public getSubscriberCount = (): number => this.subscribers.size;

  public close = (): void => {
    for (const reply of this.clients) reply.raw.end();
    this.clients.clear();
    this.subscribers.clear();
  };
}
