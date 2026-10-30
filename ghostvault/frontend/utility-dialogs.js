import { Ui } from './ui-components.js';
import { escapeHtml } from './utils.js';

export class UtilityDialogs {
  constructor(app) { this.app = app; }

  init = () => {
    document.getElementById('utilityHost').innerHTML = '<gv-dialog id="confirmDialog" heading="Подтверждение"></gv-dialog><gv-dialog id="exportDialog" heading="Экспорт настроек"></gv-dialog>';
  };

  confirm = (heading, message) => new Promise(resolve => {
    const dialog = document.getElementById('confirmDialog');
    let accepted = false;
    dialog.heading = heading;
    dialog.innerHTML = `<gv-stack><p>${escapeHtml(message)}</p><div class="app-form-actions"><gv-action label="Оставить" data-cancel autofocus></gv-action><gv-action label="Удалить" tone="danger" data-confirm></gv-action></div></gv-stack>`;
    const action = event => {
      if (event.target.hasAttribute('data-confirm')) { accepted = true; dialog.hide(); }
      if (event.target.hasAttribute('data-cancel')) dialog.hide();
    };
    dialog.addEventListener('gv-activate', action);
    dialog.addEventListener('gv-close', () => { dialog.removeEventListener('gv-activate', action); resolve(accepted); }, { once: true });
    dialog.show(document.activeElement);
  });

  export = () => {
    const dialog = document.getElementById('exportDialog');
    if (dialog.open) return;
    const groups = [['connections', 'Соединения'], ['patterns', 'Правила'], ['secrets', 'Секреты'], ['hooks', 'Хуки'], ['proxy,settings', 'Настройки шлюза и интерфейса']];
    const choices = groups.map(([value, label]) => '<label class="app-export-choice"><input type="checkbox" name="export-group" value="' + value + '" checked><span>' + label + '</span></label>').join('');
    dialog.innerHTML = '<gv-stack><fieldset class="app-export-choices"><legend>Что включить в файл</legend>' + choices + '</fieldset><p class="app-help">Выбранные разделы сохранятся в одном JSON. Секреты экспортируются с настоящими значениями. История сессий в файл не входит.</p>' + Ui.feedback('exportError') + '<div class="app-form-actions"><gv-action label="Закрыть" data-export-close></gv-action><gv-action label="Скачать JSON" tone="primary" data-download></gv-action></div></gv-stack>';
    const selected = () => [...dialog.querySelectorAll('input[name="export-group"]:checked')].flatMap(input => input.value.split(','));
    const update = () => { dialog.querySelector('[data-download]').disabled = selected().length === 0; Ui.error('exportError', ''); };
    const handler = async event => {
      if (event.target.hasAttribute('data-export-close')) dialog.hide();
      if (!event.target.hasAttribute('data-download') || event.target.busy) return;
      const groups = selected();
      if (!groups.length) { Ui.error('exportError', 'Выберите хотя бы один раздел.'); return; }
      event.target.busy = true;
      try {
        const data = await this.app.api.request('/api/export?' + new URLSearchParams({ groups: groups.join(',') }));
        const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
        const link = document.createElement('a');
        link.href = url;
        link.download = 'ghostvault-export-' + new Date().toISOString().slice(0, 10) + '.json';
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        dialog.hide();
      } catch (error) { Ui.error('exportError', error.message); }
      finally { event.target.busy = false; }
    };
    dialog.addEventListener('change', update);
    dialog.addEventListener('gv-activate', handler);
    dialog.addEventListener('gv-close', () => { dialog.removeEventListener('gv-activate', handler); dialog.removeEventListener('change', update); }, { once: true });
    dialog.show(document.activeElement);
  };
}
