import { EventBroadcaster } from '../telemetry/event-broadcaster.js';
import { AuditEvent } from '../telemetry/types.js';
import { FastifyReply } from 'fastify';

export class ProtectedEvents extends EventBroadcaster {
  private originals = new EventBroadcaster();
  public subscribeOriginal = (reply: FastifyReply): void => this.originals.subscribe(reply);
  constructor(project: (event: AuditEvent) => AuditEvent, preview: (text: string) => string = text => text) {
    super();
    const publish = this.broadcast;
    const close = this.close;
    this.close = () => { this.originals.close(); close(); };
    this.broadcast = (event, original) => {
      try { this.originals.broadcast(original ?? event); } catch {}
      try {
        const projected = event.type === 'stream_progress' && typeof event.details.text === 'string' ? { ...event, details: { ...event.details, text: preview(event.details.text) } } : event;
        publish(project(projected));
      } catch {}
    };
  }
}
