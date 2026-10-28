import '@ghostvault/ui-kit/styles.css';
import { registerKit } from '@ghostvault/ui-kit';
import './dashboard.css';
import './workspace.css';
import { DashboardApp } from './app.js';

try {
  await registerKit({ iconBase: new URL('/icons/', location.origin).href });
  const app = new DashboardApp();
  await app.init();
} catch (error) {
  document.getElementById('startupError').hidden = false;
  document.getElementById('startupError').textContent = 'Не удалось открыть интерфейс: ' + error.message;
}
