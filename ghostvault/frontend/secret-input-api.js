import { SecretErrors } from './secret-errors.js';

export class SecretInputApi {
  token = '';
  expiresAt = 0;
  requestView = null;
  creationKey = '';
  names = null;

  constructor(url = new URL(location.href)) { this.url = url; }

  request = async (path, method = 'GET', payload, session = false) => {
    const headers = { 'x-ghostvault-input': '1' };
    if (payload !== undefined) headers['Content-Type'] = 'application/json';
    if (!session) headers.Authorization = 'Intake ' + this.token;
    let response;
    try {
      response = await fetch('/api/secret-input/' + path, { method, headers, body: payload === undefined ? undefined : JSON.stringify(payload), cache: 'no-store', credentials: 'omit', mode: 'cors', redirect: 'error', signal: AbortSignal.timeout(15000) });
    } catch { throw Object.assign(new Error('Не удалось получить ответ от GhostVault.'), { uncertain: !session }); }
    const body = await response.json().catch(() => null);
    if (!response.ok) {
      const error = Object.assign(new Error(body?.message || body?.error?.message || 'Не удалось выполнить действие.'), { status: response.status, code: body?.code || body?.error?.code });
      if (response.status === 410) error.terminal = 'expired';
      if ((response.status === 404 && path !== 'requests') || response.status === 403) error.terminal = 'unavailable';
      if (body?.request) this.accept(body.request);
      if (body?.request?.state === 'failed' || ['NAME_CONFLICT', 'REVISION_CONFLICT'].includes(error.code)) error.terminal = 'failed';
      if (['COMMIT_IN_PROGRESS', 'REQUEST_CLOSED'].includes(error.code)) error.uncertain = true;
      throw error;
    }
    if (!body) throw Object.assign(new Error('Ответ не подтверждает результат. Проверьте состояние формы.'), { uncertain: !session });
    return body;
  };

  load = async () => {
    this.operation = this.url.pathname.replace(/\/$/, '').endsWith('/update') ? 'update' : 'new';
    const requestId = this.url.searchParams.get('request');
    const session = await this.request('session', 'POST', requestId ? { requestId } : {}, true);
    if (typeof session.formToken !== 'string' || !Number.isFinite(session.expiresAt)) throw new Error('Не удалось открыть безопасную форму. Откройте страницу заново.');
    this.token = session.formToken;
    this.expiresAt = session.expiresAt;
    if (session.request) this.accept(session.request);
    if (requestId && !this.requestView) throw Object.assign(new Error('Форма больше недоступна.'), { terminal: 'unavailable' });
    const names = this.requestView?.names || (this.url.searchParams.get('secrets')?.split(',') || []);
    return { operation: this.requestView?.operation || this.operation, names, editableNames: !this.requestView && (this.operation === 'new' || !names.length), ...this.outcome(this.requestView) };
  };

  accept = view => {
    if (typeof view?.requestId !== 'string' || !Array.isArray(view.names) || !['new', 'update'].includes(view.operation) || !['awaiting_input', 'committing', 'completed', 'cancelled', 'expired', 'failed'].includes(view.state) || !Number.isFinite(view.expiresAt)) throw Object.assign(new Error('Не удалось прочитать состояние формы.'), { uncertain: true });
    this.requestView = { requestId: view.requestId, operation: view.operation, names: view.names, state: view.state, expiresAt: view.expiresAt, error: view.error, notice: view.notice?.code === 'SECRET_STORAGE_CLEANUP_PENDING' ? { code: 'SECRET_STORAGE_CLEANUP_PENDING' } : undefined };
    return this.requestView;
  };

  active = () => {
    if (!this.token) throw Object.assign(new Error('Форма больше недоступна.'), { terminal: 'unavailable' });
    if (Date.now() >= this.expiresAt) throw Object.assign(new Error('Срок действия формы истёк.'), { terminal: 'expired' });
  };

  ensureRequest = async names => {
    this.active();
    if (this.requestView) return this.requestView;
    this.names ||= names;
    this.creationKey ||= crypto.randomUUID();
    try {
      return this.accept(await this.request('requests', 'POST', { operation: this.operation, names: this.names, idempotencyKey: this.creationKey }));
    } catch (error) {
      if (!error.uncertain) { this.names = null; this.creationKey = ''; }
      throw error;
    }
  };

  save = async values => {
    this.active();
    if (values.length < 1 || values.length > 32) throw new Error('За один раз можно сохранить от 1 до 32 переменных.');
    if (values.some(item => !/^[A-Z0-9_]{1,128}$/.test(item.name))) throw new Error('Имя должно содержать от 1 до 128 символов: A–Z, цифры или знак _.');
    if (values.map(item => item.name).join(',').length > 4096) throw new Error('Общая длина имён не должна превышать 4096 символов.');
    if (values.some(item => new TextEncoder().encode(item.value).byteLength > 65536)) throw new Error('Одно значение не должно превышать 64 КиБ.');
    const payload = { submissionId: crypto.randomUUID(), values };
    if (new TextEncoder().encode(JSON.stringify(payload)).byteLength > 262144) throw new Error('Общий объём формы слишком велик. Сохраните значения несколькими отдельными запросами.');
    const view = await this.ensureRequest(values.map(item => item.name));
    if (['completed', 'cancelled', 'expired', 'committing', 'failed'].includes(view.state)) return this.outcome(view);
    if (view.names.length !== values.length || view.names.some((name, index) => name !== values[index].name)) throw new Error('Имена этой формы уже зафиксированы. Откройте новую форму для других имён.');
    const result = this.accept(await this.request('requests/' + encodeURIComponent(view.requestId) + '/submit', 'POST', payload));
    return this.outcome(result);
  };

  status = async () => {
    this.active();
    if (!this.requestView && this.names) await this.ensureRequest(this.names);
    if (!this.requestView) return { state: 'pending', review: false };
    return this.outcome(this.accept(await this.request('requests/' + encodeURIComponent(this.requestView.requestId))));
  };

  cancel = async () => {
    if (!this.requestView && this.names) await this.ensureRequest(this.names);
    if (!this.requestView) return { state: 'cancelled' };
    this.active();
    return this.outcome(this.accept(await this.request('requests/' + encodeURIComponent(this.requestView.requestId) + '/cancel', 'POST', {})));
  };

  namesLocked = () => Boolean(this.requestView || this.names);
  outcome = view => ({ state: ['completed', 'cancelled', 'expired', 'failed'].includes(view?.state) ? view.state : 'pending', review: view?.state === 'committing', error: view?.error ? SecretErrors.message(view.error) : '', notice: view?.notice ? { ...view.notice, historical: true } : undefined });

  restartUrl = () => {
    const names = this.requestView?.names || this.names || this.url.searchParams.get('secrets')?.split(',') || [];
    const operation = this.requestView?.operation || this.operation;
    return '/vault-secret/' + operation + (names.length ? '?' + new URLSearchParams({ secrets: names.join(',') }) : '');
  };

  forget = () => {
    this.token = '';
    this.names = null;
    this.requestView = null;
    this.creationKey = '';
  };
}
