interface UpstreamRequest {
  method: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

export class UpstreamClient {
  constructor(private send: typeof fetch = fetch) {}

  public fetch = (target: string, request: UpstreamRequest): Promise<Response> => {
    const headers = new Headers(request.headers);
    const relay = headers.get('x-ghostvault-native-relay');
    const token = headers.get('x-ghostvault-native-token');
    const chunked = headers.get('transfer-encoding')?.split(',').some(name => name.trim().toLowerCase() === 'chunked');
    const connectionHeaders = headers.get('connection')?.split(',').map(name => name.trim()).filter(Boolean) ?? [];
    const transportHeaders = ['host', 'content-length', 'connection', 'keep-alive', 'proxy-connection', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade'];
    for (const name of [...connectionHeaders, ...transportHeaders, 'x-ghostvault-native-relay', 'x-ghostvault-native-token', 'x-ghostvault-native-target']) headers.delete(name);
    const init: RequestInit & { duplex?: 'half' } = { ...request, headers };
    if (chunked && request.body !== undefined) {
      init.body = new Blob([request.body]).stream();
      init.duplex = 'half';
    }
    if (!relay || !token || !/^https:\/\/opencode\.ai\/(?:inference|zen)\/(?!go(?:\/|$))/.test(target)) return this.send(target, init);
    let endpoint: URL;
    try { endpoint = new URL(relay); }
    catch { throw new Error('Invalid native transport endpoint'); }
    if (endpoint.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(endpoint.hostname) || endpoint.pathname !== '/relay' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid native transport endpoint');
    headers.set('x-ghostvault-native-token', token);
    headers.set('x-ghostvault-native-target', target);
    return this.send(endpoint, init);
  };
}
