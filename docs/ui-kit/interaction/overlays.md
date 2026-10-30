# Dialog, hint, focus и scroll

[Раздел](index.md). Источник product поведения: [UX](../../frontend-ux-guide.md).

Почему: оторванная панель/перехваченный click разрывают связь объяснения и действия. Цель — чтение и редактирование на месте с ожидаемым primary action.

## Hint

У поясняющего trigger без основного действия (`data-hint-only`) click/Enter/Space закрепляет hint; повторное действие закрывает. Обычные кнопки выполняют своё действие сразу. `aria-expanded` отражает состояние. Панель не содержит F1/touch footer, кнопки закрепления или закрытия. Закрепление сохраняет компактное представление. Почему: удалить шум и случайные панели; цель — помощь по намерению; механизм — задержка hover и отдельная семантика hint-only; перехват основной кнопки не применяется.

Состояния `closed / preview / pinned` имеют явные transitions. Hover самого объясняемого control открывает preview после 350 мс намеренного наведения, focus — сразу, без переноса focus; pointer может перейти внутрь. Отдельный «?» не заменяет основной trigger.

Panel anchored к trigger, предпочтительно сверху; placement меняется у границ viewport. Scroll/resize обновляют связь, контейнер overflow не обрезает panel. Фиксированный угол вместо anchoring недопустим.

Pinned допускает text selection/copy/scroll. Outside/Escape/повторное нажатие hint-only trigger закрывают нужную панель; контекстное меню и pointer selection внутри не трактуются как случайный outside. Shared engine отвечает за placement, а не новый engine на каждом экране.

Текст сразу объясняет действие/объект/последствия; generic «Подробности» не добавляет смысла. Критические сведения видны в label/окружении, не только hover.

Уточнение 2026-10-31: пользователь попросил убрать нагруженную панель действий при закреплении и усомнился в необходимости кнопки закрытия. Принято: preview/pinned имеют одинаковую компактную структуру, сохраняются outside/Escape/touch/F1. Это заменяет прежнее решение об опциональной кнопке.

- Hover/focus actual control → preview; основной click/Enter/Space выполняет прежнее действие сразу и закрывает hint. Приложение не откладывает click ради распознавания gesture.
- `pinButton` / `hintPinButton` оставлены как совместимые legacy properties, но больше не добавляют controls. Их изменение не меняет mode/anchor.
- Подстановка с `secret-key` и `copy-value`: две строки «Было»/«Ушло», icon-only `gv-copy` рядом с каждым значением. Подстановка внутри panel — native button «Открыть секрет <key>» с `data-secret-open`; приложение обрабатывает переход. Исходный token сохраняет Ctrl+Click/Control+Enter. Copy/переход внутри panel не активируют внешний trigger.
- F1 без Ctrl/Alt/Meta внутри trigger/panel закрепляет; повторный F1 не переключает обратно. `gv-action` объявляет F1 на actual native button через `aria-keyshortcuts`. Tab/обычные action keys не перехватываются.
- Escape закрывает только active hint и возвращает focus trigger; событие потребляется до внешнего dialog. Следующий Escape принадлежит внешнему контексту. Outside/hide закрывают без focus stealing.
- Touch hold: 600 ms на control; движение >8 CSS px, scroll, pointercancel, blur или disconnect отменяют ожидание. Native touch contextmenu на удерживаемом trigger также распознаётся как намерение закрепить; мышиный contextmenu не меняется.
- Только click от распознанного hold подавляется: до release и максимум 800 ms после него; следующий pointerdown/keyboard intent снимает suppression. Обычный tap/клавиатурный click не теряются. Не ставить global touch-action:none/preventDefault на обычный pointerdown.
- Panel допускает text selection/обычное copy/contextmenu. Иконка копирования сохраняет accessible name, tooltip, check-feedback и live status. Ошибка копирования видима текстом.

Preview связан accessible description в scope anchor; текст имеет tooltip role. Pinned panel — именованный nonmodal dialog без focus trap, close control отделён от текста. Исходный control не получает ложный aria-expanded состояния своей основной операции. ARIA ID-связи не пересекают shadow roots только совпавшей строкой id.

Для disabled control причина видна связанным обычным текстом: hover/focus/hold disabled control ненадёжны. Не снимать disabled ради hint и не возвращать соседнюю Info как скрытый обход. Тяжёлый suite/AT/iOS не проверены; [ограниченный browser probe](../delivery/testing.md).

```html
<gv-action label="Настроить" hint="Редактор выбранного объекта"></gv-action>
```

Legacy pin attributes не включают дополнительные кнопки; новые consumers их не используют.

## Наблюдение из приложения

Контракт `migration-hint-04`: `hint.readState()` возвращает frozen readonly `HintViewState {mode,open,pinned}`. Initial closed/false/false; open означает логический preview/pinned, не подтверждение placement/animation. Snapshot не меняется сам: для нового состояния вызвать метод снова. Getter с single-return block не добавлен из-за engineering-style; состояние модели не раскрывается.

`gv-hint-state` — bubbles/composed, noncancelable notification при настоящей смене mode, detail frozen `{source:hint.id,mode,open,pinned}`. Source может быть пустым; текст hint/секреты в event не передаются. Повторные preview/hide без смены mode не создают события. Новый state доступен внутри handler до Lit DOM update. Consumer может синхронно вызвать hide; state не воскресает после callback.

`hint.hide():void` закрывает preview/pinned без focus restore; применим перед navigation/modal. Keyboard close по-прежнему возвращает focus по своему сценарию. Смена/удаление slotted anchor закрывает state при slot signal; CSS-hidden view закрывает его controller явно.

Для последнего вызова проверять живые публичные hints соответствующего view, включая hints, созданные gv-action. Такой lookup использует component API, не private nodes/model:

```ts
import type { GvHint } from '@ghostvault/ui-kit';

const reading = [...lastCallRoot.querySelectorAll<GvHint>('gv-hint')]
  .some(hint => hint.readState().pinned);
```

При reading продолжать ingestion/cache, отложить разрушительную замену view; после unpin показать последний актуальный pending call с проверкой session/generation. При смене pinned hint нельзя сбрасывать guard по одному event.pinned=false: пересчитать живое состояние view. Разные Shadow roots требуют composed event/явных refs, не private shadow traversal.

Перед navigation/modal вызвать hide у hints уходящего контекста до unmount, затем менять app context. Disconnect закрывает instance и уведомляет прямых listeners, но снятый DOM-node не пузырит событие прежнему ancestor; blind global counter без cleanup непригоден. UI freeze/unfreeze и pending call принадлежат app controller, kit не останавливает polling и не хранит payload.

## Dialog

Открыть конкретный entity, сохранить source context/trigger. Modal содержит осмысленный initial focus, keyboard containment и close path; nonmodal hint не превращается случайно в modal trap.

После close вернуть focus живому trigger; если он исчез, выбрать живое логическое место по owner context. Save/cancel/error не навигируют автоматически в общий каталог.

Nested overlays имеют одного владельца stack/close priority. Escape закрывает верхний подходящий слой, не всю app и не два слоя одним event. Closing animation не является единственным местом cleanup: interrupted/reduced-motion transition также завершает state/resources.

## Viewport и scroll

Контент ограничен доступным viewport, длинное прокручивается. Экранная клавиатура не должна скрывать active field/actions; проверить supported mobile viewport поведения, не угадывать одинаковую геометрию всех browsers.

Wheel/touch внутри modal не двигают фон без намерения. Scroll lock учитывает нескольких modal owners и освобождается только последним. Не блокировать copy/selection или весь document touch ради одного control.

Anchor скрыт/удалён: preview закрывается; pinned/editor выбирает documented close/fallback owner, не остаётся висеть над чужой строкой. Placement runtime описан в [CSS policy](../styling/policy.md).

Проверка: реальный trigger, first primary action, pointer bridge, pin/copy/context menu, edge viewport/overflow, screen keyboard, nested Escape, removed trigger, interrupted animation.
