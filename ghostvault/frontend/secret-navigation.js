export class SecretNavigation {
  generation = 0;
  timer = null;
  highlighted = null;

  constructor(app) { this.app = app; }

  init = () => {
    document.addEventListener('keydown', this.key, true);
    document.addEventListener('keyup', this.modifier, true);
    document.addEventListener('pointermove', this.modifier, { passive: true });
    document.addEventListener('click', this.click, true);
    window.addEventListener('blur', this.reset);
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.reset(); });
  };

  reset = () => document.documentElement.classList.remove('app-secret-control');
  modifier = event => document.documentElement.classList.toggle('app-secret-control', event.ctrlKey);
  token = event => event.composedPath().find(node => node instanceof HTMLElement && node.hasAttribute('data-secret-key'));

  key = event => {
    this.modifier(event);
    if (event.key === 'Enter' && event.ctrlKey && !event.repeat) this.activate(event);
  };

  click = event => {
    this.modifier(event);
    if (event.ctrlKey && event.button === 0) this.activate(event);
  };

  activate = event => {
    const token = this.token(event);
    if (!token || window.getSelection()?.toString()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    this.open(token.dataset.secretKey);
  };

  open = async key => {
    const generation = ++this.generation;
    try {
      const vault = await this.app.api.getVault();
      if (generation !== this.generation) return;
      const manual = vault.manualSecrets || vault.manual || [];
      const automatic = vault.autoSecrets || vault.auto || [];
      const category = manual.some(secret => secret.key === key) ? 'manual' : automatic.some(secret => secret.key === key) ? 'auto' : null;
      if (!category) { this.app.showToast('Этот секрет больше не сохранён.'); return; }
      this.app.manualSecrets = manual;
      this.app.autoSecrets = automatic;
      this.app.searchQuery = '';
      document.getElementById('searchInput').value = '';
      document.activeElement?.blur();
      this.app.switchMainTab('secrets');
      this.app.switchSecretsSubTab(category);
      this.app.renderTables();
      const root = document.getElementById(category + 'TableBody');
      const card = [...root.querySelectorAll('[data-secret-record]')].find(node => node.dataset.secretRecord === key);
      if (!card) return;
      clearTimeout(this.timer);
      this.highlighted?.classList.remove('app-secret-target');
      this.highlighted = card;
      card.classList.add('app-secret-target');
      card.focus({ preventScroll: true });
      card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
      this.timer = setTimeout(() => card.classList.remove('app-secret-target'), 1800);
    } catch (error) { this.app.showToast('Не удалось открыть секрет: ' + error.message); }
  };
}
