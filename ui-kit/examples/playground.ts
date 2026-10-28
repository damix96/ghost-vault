import { LitElement, html } from 'lit';
import { repeat } from 'lit/directives/repeat.js';
import { registerKit, EditorSession, type GvDialog, type GvField, type FeedbackState, type FieldInputDetail } from '@ghostvault/ui-kit';
import '@ghostvault/ui-kit/styles.css';

await registerKit({ iconBase: new URL('icons/', document.baseURI).href });

class Playground extends LitElement {
  static properties = { selected: { state: true }, routes: { state: true }, message: { state: true }, status: { state: true }, dark: { state: true }, filter: { state: true }, sampleSecret: { state: true } };
  createRenderRoot = () => this;
  routes = [{ id: 'example-a', name: 'Пример A', upstream: 'https://provider.invalid/v1' }, { id: 'example-b', name: 'Пример B', upstream: 'https://other.invalid/v1' }];
  selected = this.routes[0];
  session = new EditorSession(this.selected.id, { upstream: this.selected.upstream });
  message = 'Самостоятельный kit. Здесь нет запросов к gateway или провайдеру.';
  status: FeedbackState = 'info';
  dark = false;
  filter = 'all';
  sampleSecret = '  synthetic\nvalue\t ';

  private configure = async (id: string, event: Event) => {
    this.selected = this.routes.find(route => route.id === id)!;
    this.session.select(id, { upstream: this.selected.upstream });
    this.requestUpdate();
    const trigger = event.currentTarget as HTMLElement;
    await this.updateComplete;
    this.querySelector<GvDialog>('gv-dialog')!.show(trigger, this.querySelector<HTMLElement>('gv-page')!);
  };

  private input = (event: CustomEvent<FieldInputDetail>) => {
    this.session.set(event.detail.name, event.detail.value);
    this.requestUpdate();
  };

  private refresh = () => {
    this.session.observe({ upstream: 'https://changed-elsewhere.invalid/v1' });
    this.requestUpdate();
  };

  private save = async (event: SubmitEvent) => {
    event.preventDefault();
    if (this.session.pending) return;
    const form = event.currentTarget as HTMLFormElement;
    if (!form.reportValidity()) return;
    const field = form.querySelector<GvField>('gv-field')!;
    this.session.set('upstream', field.readValue());
    const ticket = this.session.begin();
    this.requestUpdate();
    await new Promise(resolve => setTimeout(resolve, 500));
    const accepted = this.session.complete(ticket);
    if (accepted) {
      this.routes = this.routes.map(route => route.id === ticket.entity ? { ...route, upstream: ticket.values.upstream } : route);
      this.status = 'success';
      this.message = 'Сохранено в памяти примера. Запрос к модели не выполнялся.';
      const dialog = this.querySelector<GvDialog>('gv-dialog')!;
      dialog.closeDisabled = false;
      dialog.hide();
    } else {
      this.status = 'stale';
      this.message = 'Поздний результат не применён к закрытому или другому редактору.';
    }
    this.requestUpdate();
  };

  private closed = () => {
    this.session.close();
    this.requestUpdate();
  };

  private theme = () => {
    this.dark = !this.dark;
    document.documentElement.classList.toggle('wa-dark', this.dark);
    document.documentElement.classList.toggle('wa-light', !this.dark);
  };

  render = () => html`
    <gv-page heading="GhostVault UI-kit" description="Компоненты и synthetic examples. Основное приложение не подключено.">
      <gv-action slot="actions" .pressed=${this.dark} .label=${this.dark ? 'Светлая тема' : 'Тёмная тема'} @gv-activate=${this.theme}></gv-action>
      <gv-stack gap="large">
        <gv-feedback .state=${this.status} .message=${this.message}></gv-feedback>
        <gv-grid columns="two">
          <gv-panel heading="Контекстный редактор" description="Настроить открывает только выбранный объект. Данные остаются в памяти примера.">
            <gv-stack>${repeat(this.routes, route => route.id, route => html`<gv-stack direction="row"><span>${route.name}</span><code>${route.upstream}</code><gv-action label="Настроить" hint="Открывает редактор этого объекта на текущей странице. Не выполняет запрос к провайдеру. Для длительного чтения: F1 или удержание на сенсорном экране." @gv-activate=${(event: Event) => this.configure(route.id, event)}></gv-action></gv-stack>`)}</gv-stack>
          </gv-panel>
          <gv-panel heading="Честные состояния" description="Сохранённый URL не подтверждает доступ к модели.">
            <gv-stack><gv-feedback state="unknown" message="Доступ к провайдеру не проверялся."></gv-feedback><gv-feedback state="empty" message="Нет наблюдаемых вызовов."></gv-feedback><gv-feedback state="error" message="Пример ошибки: рабочий черновик сохраняется."></gv-feedback></gv-stack>
          </gv-panel>
        </gv-grid>
        <gv-panel heading="Общие поля" description="Synthetic draft; пробелы и переносы не обрезаются. Select — одно строковое значение.">
          <gv-stack>
            <gv-field type="textarea" name="synthetic-secret" label="Многострочное значение" .value=${this.sampleSecret} @gv-input=${(event: CustomEvent<FieldInputDetail>) => this.sampleSecret = event.detail.value}></gv-field>
            <gv-select name="filter" label="Фильтр примера" .value=${this.filter} .options=${[{ value: 'all', label: 'Все' }, { value: 'error', label: 'Ошибки' }]} @gv-input=${(event: CustomEvent<FieldInputDetail>) => this.filter = event.detail.value}></gv-select>
            <gv-value label="Raw synthetic draft" source="sample-editor" .value=${this.sampleSecret} sensitive></gv-value>
            <gv-details heading="Пример регулярного выражения"><gv-value label="Regex" source="sample-pattern" value="[A-Z_]+"></gv-value></gv-details>
            <gv-details heading="Инструкция CLI"><p>Пример не меняет настройки CLI и не выполняет inference.</p></gv-details>
          </gv-stack>
        </gv-panel>
        <gv-panel heading="Данные и copy" description="Значения synthetic; HTML остаётся текстом. Copy использует исходное значение, не UI-маску.">
          <gv-stack><gv-value label="Synthetic secret" source="sample-secret" value="demo-value-not-a-credential" sensitive></gv-value><gv-value label="Unknown payload" source="sample-json" .value=${JSON.stringify({ type: 'unrecognized_block', text: '<img src=x onerror=alert(1)>', nested: { preserved: true } }, null, 2)}></gv-value></gv-stack>
        </gv-panel>
      </gv-stack>
    </gv-page>
    <gv-dialog .heading=${`Настроить ${this.selected.name}`} .closeDisabled=${this.session.pending} @gv-close=${this.closed}>
      <form @submit=${this.save}><gv-stack>
        <gv-field name="upstream" label="Адрес провайдера" type="url" .value=${this.session.draft.upstream} .initial=${this.selected.upstream} description="Synthetic URL. Изменение не вызывает inference." required @gv-input=${this.input}></gv-field>
        <gv-feedback .state=${this.session.conflict ? 'stale' : 'info'} .message=${this.session.conflict ? 'Пришли другие данные. Ваш ввод сохранён; atomic conflict prevention без API revision не обещается.' : this.session.dirty() ? 'Есть несохранённые изменения.' : 'Черновик совпадает с сохранённым значением.'}></gv-feedback>
        <gv-stack direction="row"><gv-action type="submit" tone="primary" label="Сохранить" .busy=${this.session.pending}></gv-action><gv-action label="Отмена" .disabled=${this.session.pending} @gv-activate=${() => this.querySelector<GvDialog>('gv-dialog')!.hide()}></gv-action><gv-action size="compact" label="Симулировать обновление" @gv-activate=${this.refresh}></gv-action></gv-stack>
      </gv-stack></form>
    </gv-dialog>`;
}

customElements.define('gv-playground', Playground);
