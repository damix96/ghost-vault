# Tailwind, vendor или ручной CSS

[Раздел](index.md).

Источник E: Tailwind/Lucide и минимум самописного кода. E не устанавливает utility-only, CSS0 или абсолютный no-inline. Для kit 0.1.0 архитектор выбрал конкретные [границы](../delivery/decisions.md); они не приписываются пользователю и не мигрируют legacy frontend.

## Практический выбор

| Задача | Предпочтительный кандидат | Почему / альтернативный риск |
|---|---|---|
| Обычные gap/padding/type/border/states | Готовые utilities один раз в component recipe | Не переписывать готовую шкалу обычными повторными selectors |
| Styled library control | Vendor theme/variants/public hooks | Полный restyle увеличивает стоимость updates |
| Новая вариация существующего control | Opt-in recipe/semantic prop | Копия компонента ради class string размножает поведение |
| Сложное отношение layout/slots | Сравнить utilities и несколько scoped selectors | Длинная arbitrary chain не обязательно яснее CSS |
| Theme mapping | Central tokens/CSS variables | Список inline/raw цветов у каждого caller не является темой |
| Vendor shadow internals | Documented variables/parts | Document utilities автоматически туда не проникают |
| Dynamic coordinates | Принятый positioning engine | Не проектировать новый geometry engine и не маскировать дизайн как measurement |

Порядок: определить задачу/states→найти ready component→сравнить варианты по ясности, reuse, a11y, theme/responsive, delivery и impact→выбрать scope/API→проверить старые и новые callers.

Custom CSS — нормальная часть реализации. Не нужно доказывать физическую невозможность utilities для каждого selector. Нужно понимать responsibility/scope и стоимость поддержки. Числовой бюджет CSS не выдуман; большой файл/дублирование/сложная specificity требуют review и декомпозиции, не минификации.

## Владение

В 0.1.0 consumers выбирают component/layout/variant, kit владеет общей recipe, tokens — в `src/styles.css`, adapter — vendor public hooks. Page не содержит отдельную копию button/form styles. Tailwind 4.3.3 генерирует component recipes; document utilities не действуют в Shadow DOM.

Domain-specific CSS или новый public class/part hook требует extension contract. Для приложения согласована [host/domain boundary migration-layout-03](host-boundary.md); она не разрешает private internals/control design overrides. Новые hooks требуют owner, boundary и поддерживаемые overrides до добавления.

Для standalone examples выбран CSS0 на page-слое: отсутствие авторских page declarations/overrides, а не CSS в браузере. Остаются generated Tailwind, vendor theme и scoped component CSS. Существующий frontend эта глава автоматически не переводит.

## Inline и runtime

В examples source design attributes/style objects/DOM `.style` запрещены выбранной policy и проверяются checker. Это отличается от token definitions, generated/vendor output и runtime coordinates. Импорт `styles.css` один раз не является page CSS.

Для engine positioning разрешается только документированный measurement/position scope/lifetime; colors/type/focus/spacing не прячутся под это исключение. Требования host CSP учитываются до выбора техники; blanket разрешение/запрет всех inline styles без provenance неверен.

## Consumer / author checks

Consumer: accepted public API/hooks, нет скрытой копии common recipe, gap вместо случайного override. Author: выбранный способ, semantic values, states, responsive/theme и impact. Review: private reach-in, cascade/`!important` growth, normalized recipe similarity; detector не определяет семантику сам.

`src/styles.css`: Tailwind theme/utilities, gv token mapping и scoped `.gv-value`; component `static styles`: host/slots/responsive/overlay shell. WA theme подключён отдельно build entry для сохранения relative imports. Нет собственного vendor native reset, Tailwind preflight или full utility bundle внутри roots. Checker ловит inline design в examples; recipe duplication/semantic scope проверяет owner review, не воображаемый semantic detector.

Публичное исключение для app-owned accessibility text: `.sr-only` поставляется из Tailwind через явный `@source inline("sr-only")`. Не копировать utility CSS в приложение и не расширять source discovery на все app classes. Utility visually clips текст до 1×1 без display:none/aria-hidden; это не скрытие focusable control или готовый skip-link с reveal-on-focus.

Основания механики: [Tailwind utilities](https://tailwindcss.com/docs/styling-with-utility-classes), [custom styles](https://tailwindcss.com/docs/adding-custom-styles), [Shadow DOM styling](https://lit.dev/docs/components/styles/). Выбор нашей policy — авторское решение, не требование источников использовать только один способ.
