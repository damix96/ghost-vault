import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { VaultDatabase } from '../dist/vault/sqlite-db.js';
import { VaultStore } from '../dist/vault/store.js';
import { GhostProxyServer } from '../dist/proxy/server.js';
import { Overview } from '../frontend/overview.js';

class RequestAssociationCheck {
  db = new VaultDatabase(':memory:');
  events = [];
  received = [];
  upstream = createServer((req, res) => {
    this.received.push(req.url);
    if (req.url.includes('mode=abort')) { req.socket.destroy(); return; }
    if (req.url.includes('mode=sse')) {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: {"choices":[{"delta":{"content":"local reply"}}]}\n\ndata: [DONE]\n\n');
      return;
    }
    res.writeHead(req.url.includes('mode=error') ? 400 : 200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'local reply' } }] }));
  });

  request = async (url, session) => this.app.inject({ method: 'POST', url, headers: { 'x-session-id': session }, payload: { model: 'synthetic', messages: [{ role: 'user', content: 'local fixture' }] } });

  run = async () => {
    if (process.env.TARGET_API_BASE) throw new Error('Test requires unset TARGET_API_BASE to guarantee local-only forwarding');
    this.upstream.listen(0, '127.0.0.1');
    await once(this.upstream, 'listening');
    const base = 'http://127.0.0.1:' + this.upstream.address().port + '/v1';
    this.db.upsertRoute({ id: 'custom-second', name: 'Second', prefix: 'second', upstream_url: base, description: '', is_custom: 1 });
    this.server = new GhostProxyServer(new VaultStore(this.db), { targetApiBase: base });
    this.app = this.server.getApp();
    const broadcaster = this.server.getEventBroadcaster();
    const broadcast = broadcaster.broadcast;
    broadcaster.broadcast = event => { this.events.push(event); broadcast(event); };
    const ingress = '/opencode/v1/chat/completions?mode=json';
    assert.equal((await this.request(ingress, 'session-json')).statusCode, 200);
    const first = this.db.getTransactionsBySession('session-json')[0];
    if (process.argv.includes('--observe')) {
      console.log(JSON.stringify({ sentToGateway: ingress, upstreamReceived: this.received[0], storedUrl: first.url, startedEndpoint: this.events.find(event => event.type === 'request_started')?.details.endpoint }));
      return;
    }
    assert.equal(first.url, ingress);
    assert.ok(first.target_url.endsWith('/v1/chat/completions?mode=json'));
    for (const [mode, status] of [['sse', 200], ['error', 400], ['abort', 502]]) {
      const url = '/opencode/v1/chat/completions?mode=' + mode;
      assert.equal((await this.request(url, 'session-' + mode)).statusCode, status);
      assert.equal(this.db.getTransactionsBySession('session-' + mode)[0].url, url);
    }
    await this.request('/second/v1/chat/completions', 'session-json');
    await this.request('/v1/chat/completions', 'root-session');
    const sessions = (await this.app.inject({ method: 'GET', url: '/api/sessions' })).json();
    assert.deepEqual(sessions.find(row => row.id === 'session-json').endpoints.sort(), [ingress, '/second/v1/chat/completions'].sort());
    assert.deepEqual(sessions.find(row => row.id === 'root-session').endpoints, ['/v1/chat/completions']);
    const overview = new Overview({}, {});
    overview.routes = (await this.app.inject({ method: 'GET', url: '/api/routes' })).json();
    assert.equal(overview.routeFor(ingress), 'opencode');
    assert.equal(overview.routeFor('/second/v1/chat/completions'), 'custom-second');
    assert.equal(overview.routeFor('/v1/chat/completions'), null);
    const steps = (await this.app.inject({ method: 'GET', url: '/api/sessions/session-json' })).json();
    assert.deepEqual(steps.map(step => step.request.url).sort(), [ingress, '/second/v1/chat/completions'].sort());
    for (const done of this.events.filter(event => event.type === 'transaction_completed')) {
      const started = this.events.find(event => event.type === 'request_started' && event.details.transactionId === done.details.transactionId);
      assert.equal(done.details.endpoint, started.details.endpoint);
    }
    assert.ok(this.received.every(url => url.startsWith('/v1/chat/completions')));
    console.log('PASS: actual /opencode ingress retained in SQLite/session API/completed events; same-upstream routes isolated; JSON/SSE/error/transport failure; genuine root stays root; upstream path unchanged');
  };

  close = async () => {
    await this.app?.close();
    await new Promise(resolve => this.upstream.close(resolve));
    this.db.close();
  };
}

const check = new RequestAssociationCheck();
try { await check.run(); } finally { await check.close(); }
