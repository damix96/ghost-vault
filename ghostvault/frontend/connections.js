import { Ui } from './ui-components.js';
import { ConnectionView } from './connection-view.js';
import { ConnectionEditor } from './connection-editor.js';
import { ClientInstructions } from './client-instructions.js';
import { ConnectionDraft } from './connection-draft.js';
import { FormFeedback } from './form-feedback.js';
import { HintLifecycle } from './hint-lifecycle.js';
import { ConnectionPresets } from './connection-presets.js';

export class Connections {
  routes = [];
  workspace = { visible: [], selected: '' };
  creating = false;
  signature = '';
  selecting = false;

  constructor(app, api) {
    this.app = app;
    this.api = api;
    this.editor = new ConnectionEditor(app, api, this.didSave);
  }

  init = async () => {
    this.editor.init();
    this.routes = await this.api.getRoutes();
    ClientInstructions.configure(await this.api.request('/api/client-help'));
    this.workspace = await this.api.request('/api/workspace');
    document.getElementById('connectionCreateHost').innerHTML = ConnectionView.create(this.routes);
    this.dialog = document.getElementById('connectionCreateDialog');
    const form = document.getElementById('connectionForm');
    form.addEventListener('submit', this.create);
    FormFeedback.bind(form, document.getElementById('connectionFormError'));
    const bar = document.getElementById('connectionBar');
    bar.addEventListener('click', event => {
      if (event.target.closest('[data-connection-add]')) this.toggleCreate(true);
      const tab = event.target.closest('[data-connection-id]');
      if (tab) this.select(tab.dataset.connectionId);
    });
    bar.addEventListener('keydown', this.navigateTabs);
    this.renderBar();
  };

  setRoutes = routes => { this.routes = routes; this.renderBar(); };
  renderBar = (force = false) => {
    const bar = document.getElementById('connectionBar');
    if (!bar || HintLifecycle.pinned(bar)) return;
    const routes = this.workspace.visible.map(id => this.routes.find(route => route.id === id)).filter(Boolean);
    const html = ConnectionView.bar(routes, this.workspace.selected);
    if (!force && (html === this.signature || bar.contains(document.activeElement))) return;
    this.signature = html;
    bar.innerHTML = html;
  };

  select = async id => {
    if (this.selecting || id === this.workspace.selected) return;
    this.selecting = true;
    try { await this.persist({ ...this.workspace, selected: id }); }
    catch (error) { this.app.showToast(error.message); }
    finally { this.selecting = false; }
    this.renderBar(true);
    document.getElementById('connection-tab-' + this.workspace.selected)?.focus();
  };

  navigateTabs = event => {
    const tab = event.target.closest('[data-connection-id]');
    if (!tab || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const tabs = [...event.currentTarget.querySelectorAll('[data-connection-id]')];
    const index = tabs.indexOf(tab);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    this.select(tabs[next].dataset.connectionId);
  };

  applyPreset = id => {
    if (this.creating) return;
    const preset = ConnectionPresets.entries.find(item => item.id === id);
    if (!preset) return;
    document.getElementById('connectionName').value = preset.name;
    document.getElementById('connectionUpstream').value = preset.upstreamUrl;
    document.getElementById('connectionUpstream').error = '';
    Ui.error('connectionFormError', '');

  };

  persist = async workspace => {
    this.workspace = await this.api.request('/api/workspace', { method: 'POST', body: JSON.stringify(workspace) });
    this.app.overview.changeConnection();
  };
  refresh = async () => {
    const [routes, workspace] = await Promise.all([this.api.getRoutes(), this.api.request('/api/workspace')]);
    this.workspace = workspace;
    this.setRoutes(routes);
  };


  open = async (id, trigger, mode = 'help') => {
    const route = this.routes.find(item => item.id === id);
    if (route) this.editor.open(route, trigger, mode);
  };

  toggleCreate = show => {
    if (this.creating) return;
    if (show) {

      this.dialog.show(document.activeElement);
    }
    else this.dialog.hide();
  };


  create = async event => {
    event.preventDefault();
    if (this.creating) return;
    const form = event.currentTarget;
    const draft = ConnectionDraft.read(this.routes);
    if (!FormFeedback.check(draft.errors, document.getElementById('connectionFormError')) || !form.reportValidity()) return;
    this.creating = true;
    this.dialog.closeDisabled = true;
    const button = form.querySelector('[type="submit"]');
    button.busy = true;
    try {
      const route = await this.api.createRoute(draft.payload);
      await this.refresh();
      await this.persist({ visible: [...new Set([...this.workspace.visible, route.id])], selected: route.id });
      form.reset();

      this.dialog.closeDisabled = false;
      this.renderBar();
      this.dialog.setReturnFocus(document.querySelector('#connectionBar [data-action="route-open"]'), document.querySelector('#viewOverview gv-page'));
      this.dialog.hide();
      this.app.showToast('Соединение добавлено');
    } catch (error) { Ui.error('connectionFormError', error.message); }
    finally { this.creating = false; this.dialog.closeDisabled = false; button.busy = false; }
  };

  didSave = (id, value) => {
    this.setRoutes(this.routes.map(route => route.id === id ? { ...route, upstreamUrl: value } : route));
    this.app.overview.results.delete(id);
    this.refresh().catch(error => this.app.showToast(error.message));
  };

  remove = async id => {
    const route = this.routes.find(item => item.id === id);
    if (!await this.app.utilities.confirm('Удалить соединение «' + route.name + '»?', 'Его локальный адрес перестанет принимать запросы. Правила, секреты и разговоры сохранятся.')) return;
    await this.api.deleteRoute(id);
    const visible = this.workspace.visible.filter(value => value !== id);
    await this.persist({ visible, selected: this.workspace.selected === id ? visible[0] || '' : this.workspace.selected });
    this.editor.close();
    await this.refresh();
    this.app.showToast('Соединение удалено');
  };


  copy = async (id, field) => {
    const route = this.editor.isOpen() && this.editor.route.id === id ? this.editor.route : this.routes.find(item => item.id === id);
    if (!route) return;
    const values = { incoming: ClientInstructions.incoming(route), outgoing: route.upstreamUrl, command: ClientInstructions.command(route), environment: ClientInstructions.environment(route), launch: ClientInstructions.launch(route), nativeConfig: ClientInstructions.nativeConfig(route), pluginConfig: ClientInstructions.pluginConfig(route) };
    if (!values[field]) return;
    const source = this.editor.isOpen() ? this.editor.source : null;
    const copied = await this.app.copyText(values[field], !source);
    if (typeof copied === 'boolean' && source && source === this.editor.source && this.editor.isOpen()) this.editor.showCopyResult(copied, field);
  };
}
