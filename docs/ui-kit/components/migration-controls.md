# Расширения для миграции

[Раздел](index.md) · [Полный API](catalog.md) · [Формы](forms.md).

Контракт `ui-kit-full-migration-20261026 / migration-gaps-02`: requested `uikit-senoir-expert`, реализует kit owner. Совместимые additions к рабочему private 0.1.0; прежние defaults/events сохранены. Приложение принадлежит мигратору, общие controls и эти правила — автору kit.

## Многострочный ввод и validation

`gv-field type="textarea"` использует готовый `wa-textarea`, default `rows=4`, resize vertical. `rows` — положительное целое. Общие `value/initial/name/label/description/error/placeholder/required/disabled/readonly/autocomplete`, методы `readValue()/focus()` и событие `gv-input` сохраняются.

Kit не делает trim/normalize/parse ни на вводе, ни на commit. Пробелы, tabs и переносы входят в строковый draft. Это не byte-preserving редактор: native textarea/IME/line-ending поведение ещё требует browser verification. Секреты передавать как properties, не писать в logs/diagnostics.

`pattern` передаётся native однострочному input; placeholder не заменяет видимый label. Непустой pattern у textarea отвергается `TypeError`: native textarea не имеет такого constraint, silent ignore создавал бы ложную validation. Multiline/domain/server validation передаёт явный `error`; Kit не пишет второй regexp/validation engine.

`FieldType` экспортирован из main entry. Смена type пересоздаёт native control по смыслу; не менять type при каждом poll/keypress. При неизменном type/value Lit сохраняет control identity.

## Select

```ts
import type { SelectOption } from '@ghostvault/ui-kit';

const filters: readonly SelectOption[] = [
  { value: 'all', label: 'Все' },
  { value: 'error', label: 'Ошибки', disabled: false }
];
```

`gv-select .options=${filters}` — property, не JSON attribute/HTML. `SelectOption` содержит readonly `value:string`, `label:string`, `disabled?:boolean`. Values уникальны и без whitespace по ограничению vendor; labels — escaped plain text. Для All использовать осмысленный sentinel; пустая строка означает empty/placeholder и при required невалидна. Изменения options передавать новым массивом, без in-place mutation.

Один string value, multiple не поддержан. `name/label/value/initial/description/error/placeholder`, `required/disabled`, `readValue()/focus()` — общая форма контракта. Не подставляет первый option вместо неизвестного выбранного значения. Caller обновляет options/value согласованно; удалённое значение не превращать в другой фильтр молча.

Один vendor `change` → один `gv-input {name,value}`; vendor input не дублирует событие. Programmatic props/options не создают user input. Form reset → `gv-input {name,value,reason:'reset'}` после native reset. Shared lifecycle/reset/validation/readValue живут один раз в `GvStringControl`; app не обращается к wa-select/options internals.

## Pending dialog

`closeDisabled=true` запрещает Escape, close button, outside и `hide()`. `hide()` возвращает false; `gv-close` не испускается. Controlled `open=false` при открытом locked dialog восстанавливается в true. Это UI guard, не гарантия идемпотентности/отмены backend operation.

Controller ставит lock перед async save, снимает при success/error; на success снимает ДО `hide()`. Пример с app-owned `saveDraft`:

```ts
dialog.closeDisabled = true;
try {
  await saveDraft();
  dialog.closeDisabled = false;
  dialog.hide();
} finally {
  dialog.closeDisabled = false;
}
```

При error оставить draft и показать ошибку. Cancel action тоже `.disabled=${pending}`; не полагаться только на модальное блокирование. Снять lock через изменение binding и сразу вызвать hide недостаточно до render: перед hide задать property явно либо дождаться собственного update.

`heading` динамический. `setReturnFocus(trigger?,fallback?)` обновляет context без reopen. После vendor hide/focus timer возвращается актуальному живому trigger либо fallback; show/disconnect отменяет отложенный return. При unmount отдельно invalidate model/listeners. Guard не отменяет уже начатую closing animation: pending ставить до запуска save.

## Disclosure: GvDetails

Дополнение `migration-contract-01`: `gv-details` экспортирован как `GvDetails`, props `heading:string=''`, `open:boolean=false` (reflect/presence attr), default slot. Summary plain text; для regex/CLI/JSON использовать осмысленный heading. Content — trusted app composition, не HTML из remote payload, при collapse не уничтожается.

Событие `gv-toggle` — noncancelable bubbles/composed notification, frozen `DetailsToggleDetail {source:host.id,open:boolean}`. Native/vendor transition синхронно обновляет wrapper open, затем уведомляет; duplicate event не повторяется. Programmatic open/initial open не дают echo: app уже владеет запрошенным значением. Event означает начало перехода, не завершённую animation/geometry. Nested vendor events от чужого control игнорируются.

App хранит expansion по стабильному entity/block key, применяет `.open` и обновляет его по detail.open/source. При parent handler учитывать источник nested details. Layout/slot content принадлежит app, styling/keyboard disclosure — ready vendor в kit. Нет raw attrs/styles bag, accordion grouping или нового handwritten disclosure engine; native interactions пока без browser evidence.

## Compact/current/pressed

`gv-action size="compact"` использует vendor `s`, normal → `m`. `pressed:boolean|undefined` — property only: undefined обычная кнопка без aria-pressed, false/true toggle state. `current=true` → aria-current=page для app navigation action. Это не href/link/router API. App меняет состояния; activation их автоматически не переключает. Current/pressed нейтральной кнопки используют brand/filled, без новой копии button CSS.

Для одного dashboard URL согласованы internal nav actions с current и secret subsections как группа toggle buttons с pressed. Не называть группу ARIA tablist без tab/keyboard контракта; [production agreement](../delivery/app-integration.md).

ARIA ставится на фактический focusable target после update готового control. Узкая vendor граница: публично типизированное поле `WaButton.button` из зафиксированного 3.14.0; только этот adapter читает его и задаёт стандартные ARIA attrs. Нет private shadow selectors, monkey patches или downstream access. При vendor upgrade проверить декларацию и adapter contract; real AT behavior ещё не проверен.

Почему так: host attributes сами не доказывают семантику внутренней кнопки; central adapter сохраняет один control implementation. Размеры/variants — [готовый Button API](https://webawesome.com/docs/components/button/); блокировка — публичный cancelable [Dialog wa-hide](https://webawesome.com/docs/components/dialog/). Double tests проверяют наши boundaries, не native vendor interaction.

Рабочий пример: [playground](../../../ui-kit/examples/playground.ts); focused contracts: [migration-controls.test.mjs](../../../ui-kit/tests/migration-controls.test.mjs).
