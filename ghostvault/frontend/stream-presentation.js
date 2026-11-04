export class StreamPresentation {
  current = null;
  expected = '';
  ended = '';
  ready = false;

  constructor(overview) { this.overview = overview; }

  static markup = () => '<p class="app-stream-status" role="status">Ответ поступает</p><div id="overviewStream" hidden><pre id="overviewStreamText" class="app-code app-live-response" tabindex="0" aria-label="Поступающий ответ"></pre></div>';

  reset = () => {
    this.current = null;
    this.expected = '';
    this.ended = '';
    this.update();
  };

  synchronize = step => {
    this.ready = this.overview.live;
    if (!step || step.state !== 'active' || (this.current && this.current.id !== step.id)) this.current = null;
    this.update();
  };

  handle = event => {
    const details = event.details || {};
    const overview = this.overview;
    if (event.type === 'request_started' && details.sessionId === overview.selectedSession) {
      this.reset();
      this.expected = details.transactionId;
    }
    if (event.type === 'transaction_completed' && (details.transactionId === this.current?.id || details.transactionId === this.expected || details.transactionId === overview.step?.id)) {
      this.current = null;
      this.ended = details.transactionId;
    }
    if (event.type === 'stream_progress' && this.ready && overview.live && details.sessionId === overview.selectedSession && typeof details.text === 'string' && details.transactionId !== this.ended) {
      const route = overview.pending.get(details.transactionId)?.route || (overview.step?.id === details.transactionId ? overview.routeFor(overview.step.request?.url) : null);
      const expected = this.expected || overview.sessions.find(session => session.id === overview.selectedSession)?.latestTransactionId || overview.step?.id;
      if (details.transactionId === expected && route === overview.app.connections.workspace.selected) this.current = { id: details.transactionId, session: details.sessionId, route, text: details.text };
    }
    this.update();
  };

  update = () => {
    const root = document.getElementById('overviewStream');
    const text = document.getElementById('overviewStreamText');
    if (!root || !text) return;
    const overview = this.overview;
    const current = this.current;
    const visible = this.ready && overview.live && overview.app.preferences.mode === 'advanced' && overview.step?.state === 'active' && current?.id === overview.step.id && current.session === overview.selectedSession && current.route === overview.app.connections.workspace.selected;
    root.hidden = !visible;
    if (text.textContent !== (visible ? current.text : '')) text.textContent = visible ? current.text : '';
  };
}
