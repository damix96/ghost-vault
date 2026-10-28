# Реализованный API 0.1.0

[Раздел](index.md) · [Запуск](../delivery/running.md) · [Модели](models.md).

Owner: frontend architect `01a1754e-ae9d-7563-b80b-84583e3ce17a`. Private experimental kit; приложение переносит отдельный `uikit-senoir-expert`. Источник типов/defaults — [src](../../../ui-kit/src/index.ts), `.d.ts` в `ui-kit/dist/`. Здесь фактический API, а не обещание всех обсуждённых controls. Совместимые расширения по `migration-gaps-02`: [recipes/границы](migration-controls.md).

## Подключение

```ts
import '@ghostvault/ui-kit/styles.css';
import { registerKit, type GvField, type FieldInputDetail } from '@ghostvault/ui-kit';

await registerKit({ iconBase: new URL('./icons/', document.baseURI).href });
```

`registerKit(options?: { iconBase?: string }): Promise<void>` регистрирует все 13 `gv-*` и нужные ready controls. `iconBase` — same-origin HTTP(S) directory URL с завершающим `/`, без query/hash/credentials; default `./icons/` рядом с JS entry. При bundling задать путь явно и скопировать assets. Повтор с тем же base идемпотентен; другой base/чужой constructor под `gv-*` именем отвергается. Нельзя одновременно загружать несколько копий kit/vendor в одну registry.

## Компоненты

| Tag / export | Props и defaults | Слот / действие |
|---|---|---|
| `gv-action` / `GvAction` | `label=''`, `tone='neutral'` (`primary/neutral/danger`), `type='button'` (`button/submit`), `disabled/busy/current=false`, `hint/icon=''`, `hintPinButton=false` (`hint-pin-button` attr), `size='normal'` (`normal/compact`), `pressed=undefined` (`boolean/undefined`, property only) | `focus()`; current → aria-current=page, pressed → toggle semantics на фактической кнопке; app контролирует state |
| `gv-field` / `GvField` | `name/label/value/initial/description/error/placeholder/pattern=''`, `type='text'` (`text/password/url/email/search/textarea`), `rows=4`, `required/disabled/readonly=false`, `autocomplete='off'` | `readValue(): string`, `focus()`; raw draft, pattern только для input, multiline — ready textarea |
| `gv-select` / `GvSelect` | `name/label/value/initial/description/error/placeholder=''`, `required/disabled=false`, `options=[]` (readonly `SelectOption[]`, property only) | Single string value, `readValue()/focus()`, `gv-input` при commit; options `{value,label,disabled?}` |
| `gv-icon` / `GvIcon` | `name='info'`, `label=''` | Имена: `info/x/copy/eye/eye-off/check/chevron-down/chevron-right/chevron-left`; пустой label — декоративный icon |
| `gv-feedback` / `GvFeedback` | `state='info'` (`info/loading/empty/unknown/stale/error/success`), `message=''` | `error` → alert; прочие → status; текст и факты задаёт consumer |
| `gv-value` / `GvValue` | `value/source=''`, `label='Значение'`, `sensitive=false` | Escaped text, reveal/copy/status; source — stable identity с revision; секрет сначала скрыт |
| `gv-stack` / `GvStack` | `direction='column'` (`column/row`), `gap='normal'` (`small/normal/large`) | Default slot; row переносится, общие gap один раз |
| `gv-grid` / `GvGrid` | `columns='two'` (`one/two`) | Default slot; одна колонка ниже 48rem |
| `gv-panel` / `GvPanel` | `heading/description=''` | Default slot; section/h2; не кнопка и не самостоятельный route |
| `gv-page` / `GvPage` | `heading/description=''` | Default main + `actions` slot; один h1/main на страницу, `focus()` на h1 |
| `gv-hint` / `GvHint` | `text/label=''`, `pinButton=false` (`pin-button` attr) | Один default-slot control; `readState(): HintViewState`, `hide():void`, событие `gv-hint-state`; query immutable, hide без focus restore |
| `gv-dialog` / `GvDialog` | `heading=''`, `open=false`, `closeDisabled=false` (`close-disabled` attr) | Default content + `footer` slot; `show(trigger?,fallback?)`, `setReturnFocus(trigger?,fallback?)`, `hide():boolean`, `focus()`; locked close → false |
| `gv-details` / `GvDetails` | `heading=''`, `open=false` (reflect) | Default slot остаётся mounted; ready wa-details, semantic `gv-toggle`, без arbitrary heading HTML |

String props допускают одноимённые HTML attrs. Boolean attrs работают по присутствию: `disabled="false"` всё ещё true; Lit: `.disabled=${false}`. `value/initial` — raw text без trim/coercion. `initial` задаёт reset baseline, не принудительно текущее value. `error` задаёт custom validity. Consumer слушает `gv-input` и обновляет свою модель; одинаковый неизменённый prop не пересоздаёт input.

Названия/labels обязательны по смыслу, даже если default пустой; icon-only action не предусмотрен. `gv-action` не принимает произвольные children/link attrs, `gv-field` — arbitrary validation/HTML bags. Новую возможность согласовать как [расширение](../basics/composition.md). Runtime reject применяется к enum variants, не заменяет domain/schema validation.

## События

Все `CustomEvent`, `bubbles=true`, `composed=true`, уведомления, без cancel/veto протокола. Типы экспортированы из main entry.

| Event | Detail | Когда |
|---|---|---|
| `gv-activate` | `ActivateDetail { source: string }` | Один primary button intent; source=host.id. Busy/disabled/submit его не испускают |
| `gv-input` | `FieldInputDetail { name: string; value: string; reason?: 'reset' }` | Ввод или form reset; ввод не означает Save |
| `gv-copy-result` | `CopyResultDetail { source: string; copied: boolean }` | Только актуальная попытка; реальные значения в event не передаются |
| `gv-close` | `undefined` | Начало закрытия dialog, один раз; invalidate async сразу, не ждать animation |
| `gv-hint-state` | `HintStateDetail { source:string; mode:HintMode; open:boolean; pinned:boolean }`, readonly/frozen | Только реальная смена mode; snapshot актуален внутри handler, не DOM/geometry-ready сигнал |
| `gv-toggle` | `DetailsToggleDetail { source:string; open:boolean }`, readonly/frozen | Details vendor transition, отличающийся от wrapper open; programmatic props/initial open не создают echo |

`KitEventMap` связывает event name и `CustomEvent<Detail>`. В Lit handler аннотировать `CustomEvent<FieldInputDetail>`; native `submit` обрабатывать на `<form>`, не на кнопке. Raw vendor events — не consumer contract.

## Важные границы

- Light DOM: action/field/select/icon/value/feedback; kit владеет их children. Shadow DOM: layout/hint/dialog/details; consumers владеют только переданными slot nodes.
- Hint preview: hover/focus настоящего control; соседней Info/«?» нет. Кнопка закрепления реализована один раз и опциональна: `pinButton` / action `hintPinButton`; default false, в GhostVault не включать. F1/touch hold доступны независимо; pinned показывает «Закрыть подсказку». Primary click выполняет действие и закрывает hint. Disabled reason виден обычным текстом; selection/copy стандартные. [Механика/opt-in](../interaction/overlays.md).
- `HintViewState = Readonly<{mode:HintMode;open:boolean;pinned:boolean}>`, `HintStateDetail` и `HintViewState` экспортированы из main; state type также из `/hint-state`. Query snapshot не reactive property; `hide()` идемпотентен, не перехватывает navigation focus. [Refresh/navigation recipe](../interaction/overlays.md).
- Dialog использует native/vendor modal; close возвращает focus актуальному живому trigger либо fallback после vendor focus timer. `closeDisabled` блокирует Escape/title close/outside/hide и controlled open=false; `gv-close` не испускается. На save success снять lock перед hide. Удаление требует cleanup модели consumer; `gv-close` не заменяет disconnect.
- Value хранит raw value в JS; маска — защита от случайного показа, не шифрование. Copy передаёт исходную строку, включая пробелы; при отказе показывает manual-copy инструкцию. Изменение source/value скрывает вновь и отменяет старый status, но не отзывает уже начатую запись в системный clipboard.
- Политика form association/reset/validation делегирована Web Awesome. Она требует отдельной [браузерной проверки](../delivery/testing.md); тестовый двойник не доказывает её.

Поведенческий пример: [playground.ts](../../../ui-kit/examples/playground.ts). Он показывает editor/refresh/stale/copy/theme на synthetic data; не вызывает gateway/provider.
