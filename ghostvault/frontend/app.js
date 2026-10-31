import { ApiClient } from './api.js';
import { TableRenderer } from './renderers.js';
import { UtilityDialogs } from './utility-dialogs.js';
import { LiveFeed } from './feed.js';
import { ModalManager } from './modals.js';
import { Overview } from './overview.js';
import { DashboardActions } from './actions.js';
import { Connections } from './connections.js';
import { RulesView } from './rules-view.js';
import { Screens } from './screens.js';
import { ClipboardTask } from '@ghostvault/ui-kit/clipboard';
import { HintLifecycle } from './hint-lifecycle.js';
import { DisclosureState } from './disclosure-state.js';
import { RuleEditor } from './rule-editor.js';
import { RelativeTime } from './relative-time.js';
import { SecretNavigation } from './secret-navigation.js';
import { ViewPreferences } from './view-preferences.js';

export class DashboardApp {
  api = new ApiClient();
  renderer = new TableRenderer();
  utilities = new UtilityDialogs(this);
  feed = new LiveFeed(this.api);
  modals = new ModalManager(this, this.api);
  overview = new Overview(this, this.api);
  connections = new Connections(this, this.api);
  activeMainTab = 'overview';
  mode = 'simple';
  preferences = new ViewPreferences(this);
  refreshing = false;
  secretsSubTab = 'manual';
  manualSecrets = [];
  autoSecrets = [];
  patterns = [];
  ruleEditor = new RuleEditor(this);
  searchQuery = '';
  rulesQuery = '';
  vaultSignature = '';
  ruleDetails = new DisclosureState();
  clipboard = new ClipboardTask(value => navigator.clipboard.writeText(value));

  init = async () => {
    window.app = this;
    new SecretNavigation(this).init();
    new DashboardActions(this).bind();
    Screens.mount();
    document.getElementById('viewRules').innerHTML = RulesView.shell();
    this.ruleEditor.init();
    this.bindEvents();
    this.modals.init();
    this.overview.init();
    this.preferences.init();
    await this.connections.init();
    this.utilities.init();
    this.feed.init();
    await Promise.all([this.fetchData(), this.fetchPatterns()]);
    this.switchMainTab(location.hash.slice(1));
    window.addEventListener('hashchange', () => this.switchMainTab(location.hash.slice(1)));
    document.getElementById('exportAllBtn').addEventListener('gv-activate', () => this.utilities.export());
    document.addEventListener('change', async event => {
      const field = event.target.closest('[data-pattern-toggle]');
      if (!field) return;
      const focused = document.activeElement === field;
      field.disabled = true;
      try {
        await this.handleTogglePattern(field.dataset.patternToggle);
        this.ruleResult(field.dataset.patternToggle, 'Изменение сохранено');
      }
      catch (error) { field.checked = !field.checked; this.ruleResult(field.dataset.patternToggle, 'Не удалось сохранить: ' + error.message, true); }
      finally {
        field.disabled = false;
        if (focused && [field, document.body].includes(document.activeElement)) [...document.querySelectorAll('[data-pattern-toggle]')].find(node => node.dataset.patternToggle === field.dataset.patternToggle)?.focus({ preventScroll: true });
      }
    });
    this.events = this.api.connectEvents(event => {
      this.feed.addEvent(event);
      this.overview.handleEvent(event);
      if (event.type === 'transaction_completed') this.fetchData();
    }, () => this.overview.setLive(false), () => this.overview.setLive(true));
    this.refresh();
    setInterval(this.refresh, 4000);
  };

  bindEvents = () => {
    document.getElementById('viewSecrets').addEventListener('focusout', () => queueMicrotask(this.renderTables));
    document.getElementById('viewSecrets').addEventListener('gv-hint-state', event => { if (!event.detail.open) queueMicrotask(this.renderTables); });
    ['overview', 'rules', 'secrets'].forEach(tab => {
      const cap = tab.charAt(0).toUpperCase() + tab.slice(1);
      document.getElementById(`nav${cap}Btn`).addEventListener('gv-activate', () => this.switchMainTab(tab));
    });
    ['manual', 'auto'].forEach(tab => document.getElementById(tab === 'manual' ? 'subTabManualBtn' : 'subTabAutoBtn').addEventListener('click', () => this.switchSecretsSubTab(tab)));
    document.querySelector('.app-secret-tabs').addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tab = event.key === 'Home' ? 'manual' : event.key === 'End' ? 'auto' : this.secretsSubTab === 'manual' ? 'auto' : 'manual';
      this.switchSecretsSubTab(tab);
      document.getElementById(tab === 'manual' ? 'subTabManualBtn' : 'subTabAutoBtn').focus();
    });
    document.getElementById('searchInput').addEventListener('input', event => {
      this.searchQuery = event.target.value.toLowerCase();
      this.renderTables();
    });
    document.getElementById('rulesSearch').addEventListener('gv-input', event => {
      this.rulesQuery = event.detail.value;
      this.renderRules();
    });
  };


  refresh = async () => {
    RelativeTime.update();
    if (this.refreshing) return;
    this.refreshing = true;
    try { await Promise.allSettled([this.fetchData(), this.overview.refresh()]); }
    finally { this.refreshing = false; }
  };

  fetchData = async () => {
    try {
      const data = await this.api.getVault();
      this.manualSecrets = data.manualSecrets || data.manual || [];
      this.autoSecrets = data.autoSecrets || data.auto || [];
      document.getElementById('autoRetentionNotice').textContent = data.retention?.notice || 'Новые найденные значения хранятся до перезапуска. Перенесите нужные в ручные.';
      this.renderer.renderStatus(true, this.manualSecrets.length + this.autoSecrets.length);
      const signature = JSON.stringify([this.manualSecrets, this.autoSecrets]);
      if (signature !== this.vaultSignature) {
        this.vaultSignature = signature;
        this.render();
      }
    } catch { this.renderer.renderStatus(false, 0); }
  };

  fetchPatterns = async () => {
    try {
      this.patterns = await this.api.getPatterns();
      this.ruleEditor.observe(this.patterns);
      this.renderRules();
    } catch (error) { this.showToast('Не удалось загрузить правила: ' + error.message); }
  };

  switchMainTab = tab => {
    HintLifecycle.hide();
    this.clipboard.dispose();
    const valid = ['overview', 'rules', 'secrets'].includes(tab);
    tab = valid ? tab : 'overview';
    this.activeMainTab = tab;
    if (location.hash !== '#' + tab) history[valid ? 'pushState' : 'replaceState'](null, '', '#' + tab);
    document.getElementById('toast').hidden = true;
    ['overview', 'rules', 'secrets', 'feed'].forEach(value => {
      const cap = value.charAt(0).toUpperCase() + value.slice(1);
      document.getElementById(`view${cap}`).hidden = value !== tab;
      const nav = document.getElementById(`nav${cap}Btn`);
      if (nav) {
        nav.tone = value === tab ? 'primary' : 'neutral';
        nav.setAttribute('tone', value === tab ? 'primary' : 'neutral');
        nav.current = value === tab;
      }
    });
    if (tab === 'overview') this.overview.flushConversation();
    if (tab === 'rules') this.fetchPatterns();

  };

  switchSecretsSubTab = subTab => {
    this.secretsSubTab = subTab;
    this.renderSecretsSubTabs();
  };

  render = () => {
    this.renderSecretsSubTabs();
    this.renderTables();
  };

  renderSecretsSubTabs = () => {
    ['manual', 'auto'].forEach(tab => {
      const button = document.getElementById(tab === 'manual' ? 'subTabManualBtn' : 'subTabAutoBtn');
      button.setAttribute('aria-selected', String(this.secretsSubTab === tab));
      button.tabIndex = this.secretsSubTab === tab ? 0 : -1;
    });
    document.getElementById('manualCount').textContent = this.manualSecrets.length;
    document.getElementById('autoCount').textContent = this.autoSecrets.length;
    document.getElementById('manualVaultTable').hidden = this.secretsSubTab !== 'manual';
    document.getElementById('autoVaultTable').hidden = this.secretsSubTab !== 'auto';
    document.getElementById('openAddModalBtn').hidden = this.secretsSubTab !== 'manual';
    document.getElementById('secretRulesLink').hidden = this.secretsSubTab !== 'auto';
  };

  renderTables = () => {
    this.renderer.renderManualRows(this.manualSecrets, this.searchQuery);
    this.renderer.renderAutoRows(this.autoSecrets, this.searchQuery);
  };

  renderRules = () => {
    const html = RulesView.list(this.patterns, this.rulesQuery);
    const container = document.getElementById('rulesList');
    if (this.rulesHtml === html) return;
    this.ruleDetails.render(container, html);
    container.querySelectorAll('[data-action="pattern-toggle"]').forEach(action => {
      const pattern = this.patterns.find(item => item.id === JSON.parse(action.dataset.args)[0]);
      action.pressed = pattern?.enabled === true || pattern?.enabled === 1;
    });
    this.rulesHtml = html;
  };

  copyText = async (text, announce = true) => {
    if (this.clipboard.state === 'pending') return;
    const page = this.activeMainTab;
    const copied = await this.clipboard.copy('dashboard:' + page, text);
    if (page !== this.activeMainTab) return;
    if (announce) this.showToast(copied ? 'Скопировано в буфер обмена' : 'Не удалось скопировать. Выделите значение и скопируйте вручную.');
    return copied;
  };

  showToast = message => {
    const toast = document.getElementById('toast');
    clearTimeout(this.toastTimer);
    toast.message = message;
    toast.hidden = false;
    this.toastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
  };

  openModal = key => this.modals.openSecretModal(key);

  handleDeleteSecret = async key => {
    if (!await this.utilities.confirm('Удалить секрет «' + key + '»?', 'Текущая и прежние подстановки этой записи перестанут восстанавливаться. Включённое правило может найти значение снова.')) return;
    await this.api.deleteSecret(key);
    await this.fetchData();
    this.showToast('Секрет удалён. При активном правиле он может обнаружиться заново.');
  };

  handlePromoteByKey = async key => {
    await this.api.promoteSecret({ key });
    await this.fetchData();
    this.showToast('Секрет переведён в ручные');
  };

  handleTogglePattern = async id => {
    await this.api.togglePattern(id);
    await this.fetchPatterns();
  };

  ruleResult = (id, message, error = false) => {
    const row = [...document.querySelectorAll('[data-rule-record]')].find(node => node.dataset.ruleRecord === id);
    const status = row?.querySelector('.app-rule-feedback');
    if (status) { status.textContent = message; status.dataset.error = String(error); }
  };

  handleDeletePattern = async id => {
    const pattern = this.patterns.find(item => item.id === id);
    if (!await this.utilities.confirm('Удалить правило «' + (pattern?.name || id) + '»?', 'Поиск этим правилом остановится. Ранее найденные секреты сохранятся.')) return;
    await this.api.deletePattern(id);
    await this.fetchPatterns();
    this.showToast('Правило удалено. Найденные секреты сохранены.');
  };
}
