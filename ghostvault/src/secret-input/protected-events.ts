import { EventBroadcaster } from '../telemetry/event-broadcaster.js';
import { AuditEvent } from '../telemetry/types.js';

export class ProtectedEvents extends EventBroadcaster {
  constructor(project: (event: AuditEvent) => AuditEvent, preview: (text: string) => string = text => text) {
    super();
    const publish = this.broadcast;
    this.broadcast = event => {
      try {
        const projected = event.type === 'stream_progress' && typeof event.details.text === 'string' ? { ...event, details: { ...event.details, text: preview(event.details.text) } } : event;
        publish(project(projected));
      } catch {}
    };
  }
}
