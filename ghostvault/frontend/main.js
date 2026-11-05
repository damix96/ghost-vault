import '@ghostvault/ui-kit/styles.css';
import { registerKit } from '@ghostvault/ui-kit';
import './dashboard.css';
import './workspace.css';
import './overview.css';
import './management.css';
import './typography.css';
import './session-controls.css';
import { DashboardApp } from './app.js';
import { SecretInputPage } from './secret-input-page.js';
import { SecretInputApi } from './secret-input-api.js';
import './secret-input.css';

try {
  await registerKit({ iconBase: new URL('/icons/', location.origin).href });
  const app = /^\/vault-secret\/(new|update)\/?$/.test(location.pathname) ? new SecretInputPage(new SecretInputApi()) : new DashboardApp();
  await app.init();
} catch (error) {
  document.getElementById('startupError').hidden = false;
  document.getElementById('startupError').textContent = 'Не удалось открыть интерфейс: ' + error.message;
}
