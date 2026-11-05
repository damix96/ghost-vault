import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FastifyReply } from 'fastify';
import { ProtectedEvents } from './secret-input/protected-events.js';
import { AuditEvent } from './telemetry/types.js';

const output: string[] = [];
const raw = Object.assign(new EventEmitter(), {
  writeHead: () => undefined,
  write: (text: string) => { output.push(text); return true; },
  end: () => raw.emit('close'),
  destroy: () => raw.emit('close'),
});
const original: AuditEvent = { id: 'fixture', type: 'stream_progress', timestamp: new Date().toISOString(), client: 'fixture', details: { text: 'synthetic-protected-content' } };
let fails = false;
let previewFails = false;
let previewCalls = 0;
const events = new ProtectedEvents(event => {
  if (fails) throw new Error('synthetic-provider-error-containing-secret');
  return { ...event, details: { ...event.details, text: '$${<PROTECTED>}' } };
}, text => {
  previewCalls++;
  if (previewFails) throw new Error('synthetic-preview-error-containing-secret');
  assert.equal(text, original.details.text);
  return 'safe preview';
});
events.subscribe({ hijack: () => undefined, raw } as unknown as FastifyReply);
try {
  events.broadcast(original);
  assert.equal(output.length, 2);
  assert.ok(output[1].includes('$${<PROTECTED>}'));
  assert.equal(original.details.text, 'synthetic-protected-content');
  fails = true;
  assert.doesNotThrow(() => events.broadcast(original));
  assert.equal(output.length, 2);
  fails = false;
  events.broadcast({ ...original, id: 'after-failure' });
  assert.equal(output.length, 3);
  assert.ok(output[2].includes('after-failure'));
  assert.equal(output.join('').includes('synthetic-protected-content'), false);
  assert.equal(output.join('').includes('synthetic-provider-error'), false);
  previewFails = true;
  assert.doesNotThrow(() => events.broadcast(original));
  assert.equal(output.length, 3);
  const previous = previewCalls;
  events.broadcast({ ...original, type: 'sessions_cleared' });
  assert.equal(previewCalls, previous);
  assert.equal(output.length, 4);
  assert.equal(output.join('').includes('synthetic-preview-error'), false);
  console.log('Event projection failure drops only diagnostic, preserves producer and subsequent events PASS');
} finally { events.close(); }
