import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FastifyReply } from 'fastify';
import { VaultDatabase } from './vault/sqlite-db.js';
import { VaultStore } from './vault/store.js';
import { GhostProxyServer } from './proxy/server.js';

const db = new VaultDatabase(':memory:');
const vault = new VaultStore(db);
const original = 'synthetic-preview-secret-boundary';
const updated = 'synthetic-updated-preview-boundary';
vault.setManualSecret('PREVIEW', original, undefined, true);
const proxy = new GhostProxyServer(vault, { host: '127.0.0.1', port: 0 });
const output: string[] = [];
const raw = Object.assign(new EventEmitter(), {
  writeHead: () => undefined,
  write: (text: string) => { output.push(text); return true; },
  end: () => raw.emit('close'),
  destroy: () => raw.emit('close'),
});
const events = proxy.getEventBroadcaster();
events.subscribe({ hijack: () => undefined, raw } as unknown as FastifyReply);
const publish = (text: string): string => {
  const event = { id: 'preview-boundary', type: 'stream_progress' as const, timestamp: new Date().toISOString(), client: 'fixture', details: { text } };
  events.broadcast(event);
  assert.equal(event.details.text, text);
  return JSON.parse(output.at(-1)!.slice(6)).details.text as string;
};
try {
  for (const phase of ['active', 'retired']) {
    if (phase === 'retired') { vault.setManualSecret('PREVIEW', updated, undefined, true); vault.deleteSecret('PREVIEW'); }
    for (const form of new Set(Object.values(VaultStore.computeVariants(original)))) {
      for (let cut = 1; cut < form.length; cut++) {
        const prefix = form.slice(0, cut);
        assert.equal(publish('public prose: ' + prefix), 'public prose: ', 'Ambiguous preview tail must be withheld: ' + phase + '/' + cut);
      }
      assert.equal(publish('public prose: ' + form).includes(form), false);
    }
    assert.equal(publish('ordinary complete output!'), 'ordinary complete output!');
    assert.equal(publish('ordinary diverged syntheX!'), 'ordinary diverged syntheX!');
    assert.equal(publish('$${<PREVIEW>}'), '$${<PREVIEW>}');
  }
  const composite = 'qa-secret-prefix$${<PUBLIC>}qa-secret-suffix';
  vault.setManualSecret('COMPOSITE', composite, undefined, true);
  for (const phase of ['active', 'retired']) {
    if (phase === 'retired') { vault.setManualSecret('COMPOSITE', 'updated-composite-private-value', undefined, true); vault.deleteSecret('COMPOSITE'); }
    assert.equal(vault.redactProtected({ details: { text: composite } }).details.text, '$${<COMPOSITE>}');
    for (const form of new Set(Object.values(VaultStore.computeVariants(composite)))) {
      for (let cut = 1; cut < form.length; cut++) assert.equal(publish('public prose: ' + form.slice(0, cut)), 'public prose: ', 'Composite protected preview tail: ' + phase + '/' + cut);
      assert.equal(publish('public prose: ' + form).includes(form), false);
    }
    assert.equal(publish('$${<PUBLIC>}'), '$${<PUBLIC>}');
    assert.equal(publish('$${<COMPOSITE>}'), '$${<COMPOSITE>}');
  }
  console.log('Accumulated preview prefixes/variants/retired forms withheld, complete ordinary output and token preserved PASS');
} finally {
  events.close();
  await proxy.close();
  db.close();
}
