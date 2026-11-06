export class ApiClient {
  baseUrl = '';
  hideEncrypted = true;

  constructor(baseUrl = '') {
    this.baseUrl = baseUrl;
  }

  request = async (path, options = {}) => {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...options,
      headers: { ...(options.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
      signal: options.signal || AbortSignal.timeout(10000),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const fields = body.fieldErrors ?? body.error?.fieldErrors;
      const details = fields && typeof fields === 'object' ? Object.entries(fields).map(([field, errors]) => field + ': ' + (Array.isArray(errors) ? errors.join(', ') : String(errors))).join('; ') : '';
      const message = typeof body.message === 'string' ? body.message : '';
      const error = new Error(details || message || (typeof body.error === 'string' ? body.error : `HTTP ${res.status}`));
      error.status = res.status;
      error.code = body.code;
      throw error;
    }
    return res.json();
  };

  getVault = async () =>
    this.hideEncrypted ? this.request('/api/vault') : this.display('/api/interface/vault');

  display = path => this.request(path, { method: 'POST', headers: { 'X-GhostVault-Display': 'original' }, body: '{}' });

  getSessions = async () =>
    this.request('/api/sessions');

  getSession = async id =>
    (this.hideEncrypted ? this.request(`/api/sessions/${encodeURIComponent(id)}`) : this.display(`/api/interface/sessions/${encodeURIComponent(id)}`)).then(rows => [...rows].reverse());

  deleteSession = async id =>
    this.request(`/api/sessions/${encodeURIComponent(id)}`, { method: 'DELETE' });

  clearAllSessions = async () =>
    this.request('/api/sessions', { method: 'DELETE' });

  getRoutes = async () =>
    this.request('/api/routes');

  updateRoute = async (id, upstreamUrl, name, suffix) =>
    this.request(`/api/routes/${encodeURIComponent(id)}`, {
      method: 'POST',
      body: JSON.stringify({ upstreamUrl, name, suffix }),
    });

  createRoute = async payload =>
    this.request('/api/routes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  deleteRoute = async id =>
    this.request(`/api/routes/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

  getSettings = async () =>
    this.request('/api/settings');

  saveSettings = async payload =>
    this.request('/api/settings', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  getPatterns = async () =>
    this.request('/api/patterns');

  createPattern = async payload =>
    this.request('/api/patterns', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  togglePattern = async id =>
    this.request(`/api/patterns/${encodeURIComponent(id)}/toggle`, {
      method: 'POST',
    });

  deletePattern = async id =>
    this.request(`/api/patterns/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });

  saveSecret = async payload =>
    this.request('/api/vault/secret', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  promoteSecret = async payload =>
    this.request('/api/vault/promote', {
      method: 'POST',
      body: JSON.stringify(payload),
    });

  renameSecret = async (key, name) =>
    this.request(`/api/vault/secret/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    });

  protectSecret = async key =>
    this.request(`/api/vault/secret/${encodeURIComponent(key)}`, {
      method: 'PATCH',
      body: JSON.stringify({ isSecret: true }),
    });

  saveProtectedSecret = async payload =>
    this.saveSecret({ ...payload, isSecret: true });

  deleteSecret = async key =>
    this.request(`/api/vault/secret/${encodeURIComponent(key)}`, {
      method: 'DELETE',
    });

  sendTestPing = async () =>
    this.request('/api/test-ping', { method: 'POST' });

  connectEvents = (onEvent, onError, onOpen) => {
    try {
      const sse = new EventSource(`${this.baseUrl}${this.hideEncrypted ? '/api/events' : '/api/interface/events'}`);
      sse.onopen = () => onOpen?.();
      sse.onmessage = e => {
        try {
          onEvent(JSON.parse(e.data));
        } catch {}
      };
      sse.onerror = err => onError?.(err);
      return sse;
    } catch {
      return null;
    }
  };
}
