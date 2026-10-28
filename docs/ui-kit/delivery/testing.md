# Проверки и готовность

[Раздел](index.md).

Цель — доказать наблюдаемый контракт и безопасный стык, а не повторить implementation в тестах. Набор проверок выбирается по риску изменения.

Для kit 0.1.0 разрешены сборка/контракты; тяжёлые браузерные проверки запрещены пользователем на эту iteration. Этот запрет не является постоянным запретом будущей interaction verification.

## Фактическое evidence 0.1.0

Команды из `ui-kit/`; [запуск](running.md). Проверено Node 26.8.2/npm 11.19.1, Windows.

| Проверка | Результат / точная граница |
|---|---|
| `npm run build` | Public ESM/types/CSS/icons/licenses + standalone playground через package exports |
| `npm run check` | Strict types source/examples, AST style checker: authored modules 10–300, без comments/function/single-return blocks; examples без inline design |
| `npm test` | Последний полный прогон до опциональности pin button: 36 passed. Текущая узкая коррекция — 12 hint tests ниже; полный suite без новой причины не повторялся |
| `npm run smoke` | Временный loopback preview, HTTP 200 и byte equality всех JS/CSS/SVG с artifact; сервер останавливается |
| `npm run check:docs` | Проверяет ≤200 строк, local links/anchors, index-tree/reachability и root→basics→scope; текущие counts выводятся командой |
| Dev HTTP smoke | Source/HMR server отдаёт HTML, source entry через alias, CSS и local icon; без исполнения browser JS |
| `npm pack --dry-run --json` | dist/types/styles/nine icons/licenses/README/package; без node_modules/source; текущий inventory проверяется после сборки, publish не выполнялся |

DOM adapter tests kit owner используют happy-dom и Input/Textarea/Select/Button doubles: нужный ElementInternals не реализован. Vendor controls там не смонтированы; registration отдельно без mount. Doubles доказывают own adapter contract, не native FormData/ARIA-tree. Собственный ограниченный Chromium probe и сообщённый app smoke разделены ниже.

Сборка/fake DOM не доказывают native form association/FormData/reset/fieldset/autofill/IME/Undo/caret, modal focus/trap/return, nested Escape, hint geometry/touch/scroll, AT/contrast/reduced motion/forced colors, clipboard permissions/CSP и all-browser support. Частичное app evidence не расширяется автоматически на этот список.

Production пример использует public artifact, dev — source alias/HMR. Import models работает без DOM; import main не делает registration, CSS подключается отдельно; actual registration и icon resolver локальны. Проверки не означают app migration или UX-приёмку пользователя.

## Собственный reading probe kit

`migration-reading-06`, Windows, локальный Chromium 153.0.8010.12, отдельный standalone dev/production artifact; без app runtime/API/данных. До fix ancestor pre-wrap давал wrapper115px при button43px и смещение48px; только normal на host убрал лишнюю высоту. После fix четыре combinations normal/compact × hint/no-hint: wrapper/button43px либо38px, одинаковый y, prefix/suffix на одной строке; parent остаётся pre-wrap.

`.sr-only`: computed absolute/overflow hidden/1×1 px без display:none; prefix сохраняется в Chromium accessible name ссылки. Production gallery theme label реактивно обновляется, page errors нет; ближайший example tsconfig исправляет обнаруженное Lit class-field shadowing. Одинарный case/движок не доказывает AT/IME/CSP/all-browser readiness. Playwright/browser dependencies не добавлялись в kit; использован уже установленный локальный driver. [Fixture](../../../ui-kit/tests/fixtures/inline-reading.html) доступна в dev server; тяжёлый suite не запускался.

## Собственный probe hint без соседней иконки

`first-run-ux-clarity-20261027 / hint-without-adjacent-icon`, Chromium 153.0.8010.12, standalone production playground, ephemeral loopback port; synthetic control без app API/данных. Короткий probe, не тяжёлый suite; использован уже установленный driver, зависимостей не добавлено.

До введения опции PASS: hint host и реальный anchor одинаковой ширины 162.234375px; соседних icons нет. Hover → переход курсора → pin внутри panel → close не вызывают primary action; первый primary click вызывает его один раз. F1/repeat сохраняют pinned; первый Escape закрывает только hint, следующий достигает внешнего контекста. Page errors отсутствуют. Теперь прежняя кнопка доступна opt-in, в default preview не показывается.

CDP dispatch настоящих touchStart/touchEnd: удержание закрепляет, click отпускания не вызывает action; следующий обычный tap вызывает action один раз и закрывает hint. Это desktop Chromium с touch emulation, не физическое Android/iOS evidence. Движение/scroll/cancel/disconnect, keyboard intent и подавление только нужного click также покрыты synthetic contract tests. AT/реальные mobile browsers/общая UX-приёмка не заявлены.

`remove-hint-pin-button-20261027`, уточнённая поставка: build и check PASS; `node --test tests/hint-contract.test.mjs tests/hint-interactions.test.mjs` — 12/12. Default preview без pin button; opt-in восстанавливает её, выключение сохраняет pinned state/anchor; forwarding через GvAction проверен. F1/touch/public observation и изоляция от primary сохранены. Никаких cloud/app data/live изменений; candidate собирает app owner отдельно. Тяжёлый/полный browser suite не запускался.

Текущий standalone Chromium153 probe PASS: default preview без pin button → `action.hintPinButton=true` показывает работающую кнопку → она закрепляет без primary action → false сохраняет pinned state/anchor, close работает → обычный primary once, F1/Escape сохранены. PageErrors0, hint/anchor одинаковой ширины. Это изолированный desktop case, не AT/physical mobile/общая UX-приёмка.

App owner сообщил PASS для нового `optional-pin-2` candidate: тот же public opt-in/default/runtime-toggle контракт в реальном consumer, help/hover/focus/primary once; temporary compiled backend + memory DB, API writes/external requests/pageErrors0; Fastify51assets и publish dry-check. Kit owner отдельно read-only сверил все51files SHA/size с `.cache/optional-pin-2-manifest.json` и актуальный kit input. Candidate ещё не означает live publication; deployment/restart/commit у координатора. Отчёт owner: `.cache/optional-pin-2-probe.json`; app probe не повторялся kit owner.

## Сообщённый Chromium smoke приложения

Источник: NOTICE владельца `uikit-senoir-expert`, `ui-kit-full-migration-20261026`, 2026-10-26. Kit owner этот прогон не повторял. Scope: отдельный GhostProxyServer + `:memory:` DB, staged local bundle, короткий Chromium smoke; не проверка production процесса 8767.

- Reported PASS: contextual cancel/save/503 draft, closeDisabled Escape/hide=false/disabled Cancel и single POST; dirty draft при refresh; multiline textarea с leading/trailing whitespace и LF; raw copy/reveal; secret search; create rule/route; feed select options/commit; шесть экранов и mobile overflow.
- Windows clipboard readback в этом прогоне менял LF на CRLF, test oracle учитывает ОС; stored value сохранил исходный LF. Это не основание trim/normalize реального секрета в kit.
- При повторном fill после cancel ждать hidden dialog: gv-close/open=false означают начало закрытия. Locators используют реальные accessible names, включая required marker в проверенном control.
- Native hint state/close и disclosure в это сообщение ещё не включены; расширения уже поставлены kit owner, их app проверка — следующий шаг frontend-владельца.
- В последующем `migration-reading-06` frontend-владелец отдельно сообщил Chromium PASS для aria-current/pressed. Это не общий AT claim.
- AT/IME/CSP/all-browser claims не делаются. Сообщение владельца не является общей UX-приёмкой пользователя и не закрывает весь перенос.

## Что проверять

| Изменение | Нужное доказательство |
|---|---|
| Types/default/event | Positive/negative public-contract cases; прежний caller |
| State/async | Transitions, stale completion, cleanup, две instances |
| Form/input | Submit/reset/autofill/IME/Undo/caret; field/server error |
| Hint/dialog/collection | Keyboard/touch/nested action/focus/viewport/context |
| CSS/theme/layout | Old/new states, nested theme/vendor/overlay, long/narrow content |
| Copy | Source identity/value, rejection/dispose, no secret diagnostics |
| Package/dependency | Public artifact, imports/assets/reset/support/rollback |
| Документация | Размеры/index/links/anchors/достижимость/актуальность примера |

Не добавлять тест, который только воспроизводит branch или число тегов. Regression fixture воспроизводит реальный наблюдаемый failure. Для обратимой low-impact текстовой правки достаточно relevant structural/manual review.

## Детерминизм

Clocks, async completions, random IDs и network fixtures контролируются. Сценарий late A после B задаёт порядок явно, не «подождать достаточно долго». Locale/timezone указывается; системная locale developer machine не является условием правильного теста.

Fake/controlled time не заменяет browser interaction там, где важен native focus/editing/clipboard. Применимый механизм и limits указываются в evidence; не обещать покрытие password manager из одного synthetic input event.

Visual baseline обновляется после review причины: новый snapshot сам по себе может узаконить regression. Проверять contrast/semantics/keyboard и нужные themes, а не только один screenshot.

## Производительность и большие данные

Representative synthetic fixtures: long secret/URL, deep unknown JSON, streaming updates, repeated mount/dispose, two instances. Измерять DOM work, retained resources/copies, memory и responsiveness по задаче.

Virtualization/lazy render не должны молча терять данные или обещать full browser Find при partial DOM. Если performance budget нужен, определить его на measurements/requirements, не по произвольному красивому числу.

## Definition of done

- Публичный контракт/defaults/states/events актуальны; compatibility/consumers рассмотрены.
- Проверены relevant success/failure/cleanup cases, примеры и links; данные synthetic.
- Kit owner подтверждает component contract; consumer owner — реальное app wiring/data/context.
- Passed, failed, skipped и unverified различаются. Техническая доставка не объявляется пользовательской UX-приёмкой.
- Limitations/release notes/owner next action записаны; open decision не выдан за implemented behavior.

Dev misuse diagnostic содержит безопасные field/component/version/code и не раскрывает secrets. Production не должен silently выполнять опасный fallback: documented reject/disabled/unknown/error по контракту, с recovery где возможно.

Повторять/расширять проверки при новом failure/изменении/неразрешённом риске. После достаточных checks не прогонять всё заново без причины.
