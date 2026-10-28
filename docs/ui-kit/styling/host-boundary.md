# CSS приложения при миграции

[Раздел](index.md) · [Общая policy](policy.md) · [Layout](layout.md).

Контракт `ui-kit-full-migration-20261026 / migration-layout-03`: frontend-владелец предложил app-scoped CSS для предметной компоновки; kit owner принимает границу ниже. Это решение владельцев в разрешённом scope миграции, не приписанный пользователю абсолютный запрет CSS.

Почему: структура маршрута, сессий и payload — предметная ответственность; primitives не должны становиться универсальным renderer приложения. Цель — сохранить один источник shared control поведения/оформления, позволив компактную domain composition. Механизм — CSS на app-owned containers/content и ограниченная внешняя геометрия kit hosts. Альтернатива с raw styles bag/private reach-in размывает API; преждевременное включение всех domain layouts в kit создаёт ненужную связанность.

## Разрешённые app scopes

| Область | App CSS | Что остаётся в kit |
|---|---|---|
| Строка маршрута | Сетка шести предметных колонок desktop, двух mobile; перенос длинных своих значений | Buttons/fields, их density/states, shared tokens |
| Сессии | Предметный split/list/detail, размеры и scroll regions | Общие controls/layout primitives и interaction contracts |
| Native data table | Table/caption/th/td, предметные колонки, wrapping/overflow | Controls внутри cells; повторяемая shared table recipe при подтверждённом reuse согласуется отдельно |
| Payload prose | Собственные semantic p/pre/code/text containers, чтение/перенос/прокрутка | gv-value rendering/masking/copy, hints и общие статусы |
| Header/nav | Компоновка app header и native nav container, responsive/sticky placement | Оформление actions и их compact/current/pressed props; это не href/router API |
| Fixed toast region | Один app-owned placement container с viewport bounds | Message presentation через gv-feedback; не второй собственный message/control kit |

Это список принятых предметных scopes, не разрешение писать копии buttons/forms/panels/hints под app class names. Стили находятся один раз рядом с app/domain responsibility; при повторении общего поведения/структуры согласовать canonical kit extension, не форк.

## Host и selector boundary

- Стилизовать свои native containers/content под app/domain classes. Нативные form/nav/table landmarks не требуют wrapper-per-tag.
- Kit host можно размещать в app grid/flex: grid-area/row/column, align-self/justify-self, flex sizing, width/min-width/max-width. Высоты/scroll constraints задавать app-owned regions; не обрезать поля, labels/errors и содержимое control фиксированной высотой.
- Не менять через app CSS padding/radius/border/background/font/focus/disabled/invalid/busy treatment kit control. Использовать публичные props/tokens или extension request.
- Не трогать wa-* descendants, private shadow nodes, kit class names/parts. Light DOM — renderer boundary тоже: gv-value pre не становится app prose только потому, что его видно селектору.
- Избегать широких .app-root button, .payload pre, header input и подобных descendants, которые захватывают kit-rendered nodes. Назвать class на своих элементах либо ограничить структурой собственного native container; не лечить конфликт specificity/!important.
- Shared spacing/colors/type брать из kit semantic tokens. Базовую палитру/theme и новую общую recipe согласовывает kit owner; не разносить raw literals для одного смысла по callers. Предметные grid tracks/breakpoints могут задаваться domain CSS с понятным назначением.

## Inline prose и screenreader prefixes

Контракт `migration-reading-06`: app prose вправе сохранять `white-space:pre-wrap` реального текста. `gv-action` остаётся atomic inline-block, его chrome и `gv-hint` изолируют inherited whitespace через normal; label/button presentation принадлежит kit. Сам popup hint сохраняет pre-wrap только переданного текста, без indentation шаблона.

Композиция — точные текстовые fragments, public `gv-action size="compact"` и оставшиеся fragments в том же потоке. Не добавлять форматирующие template newlines/indentation вокруг control внутрь pre-wrap, если их нет в payload. Не trim/normalize реальные fragments и не делать весь prose nowrap. Atomic action может переноситься целиком по доступной ширине; compact сам по себе не исправляет whitespace inheritance.

Domain margins у своих p/sections и внешняя геометрия остаются у приложения; private button/slot restyle не нужен. `.sr-only` разрешён на собственном span для дополнительного screenreader prefix; импорт kit styles поставляет class. Не сочетать с hidden/aria-hidden и не использовать как способ убрать видимую критическую информацию.

Regression fixture: [inline-reading.html](../../../ui-kit/tests/fixtures/inline-reading.html), `npm run dev` → `/tests/fixtures/inline-reading.html`. CSS fixture намеренно задаёт проблемный ancestor pre-wrap; это тест, не второй app recipe.

## Сценарии и проверки

DOM reading/Tab order сохраняет смысл при переходе 6→2 колонок. Длинные URL/секреты не расширяют viewport; scroll regions не скрывают active field/actions или явные ошибки. Scroll не стирает selection/context при refresh.

Fixed notification не заменяет field error или pending status редактора. Placement container не должен перехватывать всю страницу или имитировать hint/dialog positioning; содержимое остаётся kit message. При появлении нескольких toast actions/stack/pause/focus semantics согласовать общий component contract.

CSS0 и source inline checker текущего пакета относятся к standalone examples; app migration не объявлена CSS0. Согласованная граница — внешний app CSS, без нового design inline/style-object/.style обхода. Библиотечное measurement positioning остаётся [отдельным исключением](policy.md).

Owner review: selectors принадлежат app nodes, нет повторной shared recipe/private overrides, tokens согласованы, mobile/long data и ошибки учтены. Автоматический поиск CSS/DOM .style полезен, но не определяет semantic ownership сам. Файлы/SRP остаются в рамках engineering-style; нового произвольного CSS budget этот контракт не вводит.

Область frontend/app CSS принадлежит `uikit-senoir-expert`; kit и эта документация — frontend architect. Native/browser/AT evidence перечислено в [проверках](../delivery/testing.md); утверждение boundary не является визуальной приёмкой app.
