# Решения реализации 0.1.0

[Раздел](index.md) · [Запуск](running.md) · [Реальный API](../components/catalog.md).

Принял архитектор в рамках `ui-kit-implementation-20261026`, 2026-10-26. При создании kit пользователь не выбирал библиотеки и ещё не разрешал app migration. Позже разрешил полный перенос отдельному frontend-владельцу; kit owner сохраняет только свои две папки. Согласованные extensions — [migration-gaps-02](../components/migration-controls.md).

## Выбранная техника

| Решение | Почему → цель → механизм → почему не иначе |
|---|---|
| Собственный `ui-kit/`, private 0.1.0 | App развивается отдельно → независимая проверка → свои package/lock/build/example, loopback 5178 → root build change был бы скрытым внедрением |
| Lit 3.3.3 + Web Awesome Core 3.14.0 | OOP и минимум handwritten interactions → классы/lifecycle и готовые forms/modal/popup → тонкие semantic wrappers → свой form/focus/geometry framework дороже, React/Vue для этого scope не требуются |
| TypeScript 6.0.3, Vite 8.3.5 | Нужны types и public ESM/CSS → strict TS + library/demo builds → TS7 JS package не предоставлял нужный AST API style checker, глобальный frontend build не нужен |
| Tailwind/@tailwindcss-vite 4.3.3 | Проект требует Tailwind → recipes из component sources → utility chains один раз в kit, discovery ограничен → consumer цепочки/full bundle в каждом root умножали бы code/cascade |
| Lucide-static 1.61.0 | Проект требует Lucide и локальную доставку → девять SVG + local kit/system/default resolver → случайный vendor CDN и весь icon pack не нужны |
| Light controls, Shadow layouts/overlays | Forms видят готовый control, slotted layout получает изоляцию → light wrappers и небольшой shadow CSS на tokens → document Tailwind внутрь shadow не проникает, полный utility bundle там лишний |
| Один explicit styles entry | JS/CSS имеют разные effects → compiled ready theme/utilities/tokens → runtime JS не импортирует CSS; нет preflight/native reset → двойной reset мог бы повредить consumer |
| Bounded semantic API | Page не копирует internals → props/events/slots и малые layouts → arbitrary HTML/class/style bags и универсальный JSON renderer не дают устойчивого контракта |
| Native/vendor popup/dialog | Геометрия/focus сложнее adapter → WA Popup flip/shift/hover bridge/top layer и WA Dialog → своего engine/modal trap нет; browser evidence ограничено [конкретными probes](testing.md) |
| Опциональная кнопка закрепления hint | Направление optional/off передал координатор как свою интерпретацию реплик пользователя, не прямое техническое требование пользователя или независимый экспертный вывод → API GvHint.pinButton / GvAction.hintPinButton и default false выбрал kit owner → одна shared реализация, F1/touch/primary сохранены без app CSS-hide; [контракт](../interaction/overlays.md) |
| Headless string editor/copy/hint | Dirty/race/late copy независимы от renderer → классы без API/network + immutable ticket → form schema framework и обещание atomic concurrency без backend revision излишни |

Все зависимости exact в локальном lock. Runtime: Lit/Web Awesome; tooling/test/dev: Vite/Tailwind/TS/Lucide-static/happy-dom. Notices сохраняются; собственный package private/UNLICENSED, publish не выполнялся. Локализация ready controls: en vendor default + зарегистрированная ru; labels kit задаются текстом consumer, вспомогательные copy/hint подписи 0.1.0 русские.

## Конкретная style boundary

Для kit examples принята авторская policy CSS0: страницы компонуют semantic components/layouts без ручных page declarations/overrides; общий CSS остаётся в kit/vendor. Для app отдельно согласована [domain/host CSS boundary](../styling/host-boundary.md). Source inline styles/DOM `.style` не служат обходом этой границы. Это решения владельцев, не дословный запрет пользователя.

Ready vendor styling сохраняется вместо полного restyle. Tailwind — где utility recipe ясна; scoped selectors для host/slots/state, tokens и WA public parts допустимы без доказательства невозможности utility-only. [Критерии и расположение](../styling/policy.md).

Engine exception: vendor/Floating UI измеряет anchor/viewport и пишет coordinates/size; design colors/type/spacing туда не относятся. Kit не патчит private vendor DOM и не включает Tailwind в каждый root. Theme 0.1.0 — один document theme `wa-light/wa-dark`, не nested-theme API.

## Реализованный объём

13 tags: action/field/select/icon/feedback/value/stack/grid/panel/page/hint/dialog/details. Три headless модели. По запросу мигратора добавлены textarea/pattern/placeholder, select, pending-close guard, compact/current/pressed, [hint observation/hide](../interaction/overlays.md) и Details. Согласован [production mapping](app-integration.md). Нет multiselect/table/tree/virtualization/provider adapters/schema renderer; новый gap проходит owner contract. Копия shared implementation ради экрана — плохой default; бесконечная расширяемость не обещается.

## Реальные незакрытые вопросы

- Общая browser/AT matrix, IME/caret/focus/selection, geometry/touch/contrast/reduced-motion и clipboard permissions не подтверждены. Frontend-владелец сообщил короткий Chromium app smoke для [конкретных сценариев](testing.md); это не весь kit. Heavy runs остаются вне текущего объёма.
- Host CSP/Trusted Types, nested themes, coexistence с иной WA version и app integration не подтверждены; headers/app config не менять ради обхода.
- Пакет остаётся private experimental 0.1.0; непубликовавшаяся рабочая версия развивается в первой согласованной app migration. Перед стабильным release согласовать version/deprecation policy и зафиксировать единый JS/CSS/assets/types комплект. Publish не выполнялся.
- Backend revision/atomic save, domain payload schemas и provider success остаются у смежных владельцев. Kit не добавляет скрытые endpoints и не имитирует доступность модели.
