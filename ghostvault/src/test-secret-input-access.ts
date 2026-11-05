import assert from 'node:assert/strict';
import Fastify from 'fastify';
import { request as httpRequest } from 'node:http';
import { SecretInputAccess } from './secret-input/access.js';

let now = 1000;
const access = new SecretInputAccess(() => now);
const app = Fastify({ logger: false });
app.route({ method: ['POST', 'GET'], url: '/check', handler: async (request, reply) => reply.code(access.allowed(request) ? 200 : 403).send({ allowed: access.allowed(request) }) });
const address = await app.listen({ host: '127.0.0.1', port: 0 });
const headers = { origin: address, 'content-type': 'application/json', 'x-ghostvault-input': '1' };
const post = (requestHeaders: Record<string, string>): Promise<number> => new Promise((resolve, reject) => {
  const request = httpRequest(address + '/check', { method: 'POST', headers: requestHeaders }, response => { response.resume(); resolve(response.statusCode!); });
  request.on('error', reject);
  request.end('{}');
});
try {
  assert.equal((await fetch(address + '/check', { method: 'POST', headers, body: '{}' })).status, 200);
  for (const changed of [
    { ...headers, origin: 'https://foreign.example' },
    { ...headers, origin: 'null' },
    { ...headers, 'content-type': 'text/plain' },
    { ...headers, 'x-ghostvault-input': '' },
    { ...headers, host: 'evil.example' },
    { ...headers, host: '127.0.0.1:1' },
    { ...headers, 'sec-fetch-site': 'cross-site' },
  ]) assert.equal(await post(changed), 403, JSON.stringify(changed));
  assert.equal((await fetch(address + '/check', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).status, 403);
  assert.equal((await fetch(address + '/check')).status, 200);
  const grant = access.issue('request-one');
  assert.ok(access.authorize('Intake ' + grant.formToken, 'request-one'));
  assert.equal(access.authorize('Bearer ' + grant.formToken, 'request-one'), undefined);
  assert.equal(access.authorize('Intake ' + grant.formToken, 'request-two'), undefined);
  assert.equal(access.authorize('Intake wrong', 'request-one'), undefined);
  now = grant.expiresAt;
  assert.equal(access.authorize('Intake ' + grant.formToken, 'request-one'), undefined);
  const fresh = access.issue();
  assert.ok(access.authorize('Intake ' + fresh.formToken));
  access.clear();
  assert.equal(access.authorize('Intake ' + fresh.formToken), undefined);
  console.log('Secret input loopback/origin/form authority PASS');
} finally { await app.close(); }
