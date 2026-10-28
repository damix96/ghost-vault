export class NativeZenRelay {
  token = crypto.randomUUID();
  server;
  send;

  constructor(send = fetch) { this.send = send; }

  start = () => {
    this.server = Bun.serve({ hostname: '127.0.0.1', port: 0, idleTimeout: 255, fetch: this.handle });
    return 'http://127.0.0.1:' + this.server.port + '/relay';
  };

  stop = () => this.server?.stop(true);

  attach = (event, endpoint) => {
    const url = new URL(event.request.url);
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) || !/^\/(?:opencode|zen)\//.test(url.pathname)) return;
    const headers = new Headers(event.request.headers);
    headers.set('x-ghostvault-native-relay', endpoint);
    headers.set('x-ghostvault-native-token', this.token);
    event.request = new Request(event.request, { headers });
  };

  handle = async request => {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/relay') return new Response(null, { status: 404 });
    if (request.headers.get('x-ghostvault-native-token') !== this.token) return new Response(null, { status: 403 });
    let target;
    try { target = new URL(request.headers.get('x-ghostvault-native-target')); }
    catch { return new Response(null, { status: 400 }); }
    if (target.origin !== 'https://opencode.ai' || !/^\/(?:inference|zen)\/(?:openai|anthropic|google)\//.test(target.pathname) || target.username || target.password || target.hash) return new Response(null, { status: 400 });
    const headers = new Headers(request.headers);
    const chunked = headers.get('transfer-encoding')?.split(',').some(value => value.trim().toLowerCase() === 'chunked');
    const connection = headers.get('connection')?.split(',').map(value => value.trim()) ?? [];
    for (const name of [...connection, 'host', 'content-length', 'content-encoding', 'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'x-ghostvault-native-relay', 'x-ghostvault-native-token', 'x-ghostvault-native-target']) headers.delete(name);
    try {
      const body = chunked ? request.body : await request.arrayBuffer();
      const upstream = await this.send(target, { method: 'POST', headers, body, ...(chunked ? { duplex: 'half' } : {}), signal: request.signal });
      const responseHeaders = new Headers(upstream.headers);
      for (const name of ['content-length', 'content-encoding', 'connection', 'keep-alive', 'transfer-encoding']) responseHeaders.delete(name);
      return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
    } catch {
      return Response.json({ error: { message: 'OpenCode native upstream transport failed' } }, { status: 502 });
    }
  };
}
