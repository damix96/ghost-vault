# MCP, runtime и npm: проверка реализации

Дата: 2026-11-04. Реализованный контракт: [MCP/runtime](mcp-implementation-contract.md). Инструкции установки: [package README](../../ghostvault/README.md). Статус: общая сборка, полный `test:all`, установленный npm-архив и независимая заключительная сверка — PASS для проверенного Windows/Node22 scope. Git-доставка проверяется по опубликованному коммиту отдельно. Запись не означает публикацию в npm registry или обновление действующего gateway.

## Что проверил координатор

| Проверка | Результат и граница |
|---|---|
| Полная сборка | `npm run build` и сборка через `npm pack` завершились успешно; backend TypeScript и frontend Vite |
| Базовые регрессии | Все 12 тестов `npm test` прошли с отдельными рабочими каталогами и БД; отчёт `ghostvault/.cache/test-runs/run-I3IrUn/results.json` |
| Переменные | Все 6 тестов `npm run test:variables` прошли; отчёт `ghostvault/.cache/test-runs/run-bGG1uL/results.json`. Стабильные токены, rename/reuse, legacy migration, rollback, архивный экспорт и request snapshots |
| MCP | Catalog, HTTP и настоящий временный Vault с двумя SDK-клиентами прошли; initialize instructions, tool metadata, обновление каталога, фильтры, авторизация и отказ browser Origin |
| Минимальный runtime | Изолированный официальный Node.js 22.13.0 Windows x64, SHA-256 проверен по официальному манифесту. MCP HTTP/Vault, migration/reclaim и скомпилированная runtime-интеграция прошли; системный Node/PATH не менялись |
| Production CLI | Два stdio-клиента автоматически запускают один сервер; настоящий HTTP MCP и прокси проходят синтетический roundtrip; сервер остаётся после закрытия клиентов и завершается по stop |
| npm-кандидат | Настоящий `npm pack` с prepack, установка архива в отдельный consumer с `--ignore-scripts`, запуск установленного bin, разрешение всех runtime-зависимостей внутри consumer |
| Установленный пакет | На Node 22.13.0 прошёл сценарий два stdio-клиента → один runtime → HTTP MCP → обновление значения → proxy roundtrip. Implementation imports и CLI взяты из установленного пакета; источник не используется как fallback |
| Первый запуск с разным регистром пути | После исправления QA прошёл `runtime/test-paths.js` с независимо установленным stage на Node 22.13.0. Два заранее созданных settings для ещё отсутствующего Windows-каталога или DB с разным регистром приводят к одному экземпляру; другой DB отклоняется без создания |
| Обновлённый stage на минимальном Node | `scripts/verify-release.mjs --stage .../ghostvault-release-Axw17O` прошёл на Node 22.13.0: собственный SDK, stdio first-start, instructions/catalog, UI, OpenCode helpers, status, повторный setup без записи, lifetime после закрытия клиента, stop |
| UI review | Просмотрены изменения rename/API/recovery и мобильный скриншот. Все 51 файл UI совпадают по SHA-256 между проверенной frontend-сборкой, общим public и stage Axw17O; пропущенных или лишних файлов нет. Подробная браузерная матрица ниже принадлежит frontend-исполнителю |

## Кандидат после исправления shutdown

Архив `ghostvault-0.1.0.tgz`: 280431 bytes, 319 файлов, SHA-256 `86c5e2b2dd3636b098eef820c923174a91bac670865b7787e363b3037515b336`. Содержит актуальные path-identity и shutdown/relay исправления; заменяет все более ранние кандидаты и stage для окончательной приёмки. Подробные команды/пути/версии: `.codex/tasks/mcp-implementation-20261103/coordinator-final-package.json`.

- На Node 26.8.2 прошли полная сборка и весь `npm run test:all`, включая 11 сетевых shutdown-сценариев, hook failure/retry и backpressure. Хеши 291 входного файла не изменились между сборкой, тестами, упаковкой и установкой.
- Настоящий `npm pack` с prepack прошёл; packaged backend/UI/README/manifest побайтно совпадают с локальной сборкой. В архиве нет исходников, тестов, cache, БД и credentials; runtime-зависимостей на локальный ui-kit нет.
- Новая установка выполнена в чистый private consumer с предварительно проверенным явным `--prefix` и `--ignore-scripts`; exit 0. Установленный `.cmd` bin работает из пути с пробелами.
- На Node 22.13.0 прошли проверка разрешения runtime-зависимостей внутри consumer, установленная интеграция двух MCP-клиентов с прокси, все 11 shutdown-сценариев, bounded hook failure с безопасным retry, backpressure cancellation и установленный path regression. Использованы implementation imports и CLI из установленного пакета; тестовые harness размещены отдельно.
- В сетевых случаях сервер завершал/заменял экземпляр примерно за 5,4 секунды, сохраняя БД; upstream/клиент не освобождались тестом для искусственного завершения. Нормальный ответ укладывается в grace, клиентский disconnect обрабатывается отдельно. Это результат исполнения, а не только наличие таймеров в коде.

Независимая QA приняла этот точный архив: все 291 входных хеша совпали, все 88 исполняемых JS-файлов совпали с независимо испытанной сборкой, все 51 файл UI — с проверенной UI-сборкой, все 319 файлов архива — с установленным consumer. Дополнительно повторены installed CLI и dependency closure на Node22.13. Пересборка по результату этой сверки не требуется; подробности — `verification-final-artifact.md/json` в каталоге задачи.

Первая проверенная npm-сборка: `ghostvault-0.1.0.tgz`, 276970 bytes, SHA-256 `882cf9f5889210cdb043e54cd90a432dd500769df585d47127051cd561e36e0c`. Это промежуточный snapshot, а не финальный артефакт после последних изменений документации/manifest. Fresh install разрешил SDK 1.32.2, Fastify 5.12.8, Zod 4.6.7, semver 7.8.6, smol-toml 1.9.1; интеграция прошла с этими версиями. Source lock использует отдельно проверенные SDK 1.31.0/Fastify 5.12.5. Локальные подробности: `.codex/tasks/mcp-implementation-20261103/coordinator-npm-validation.json`.

## Проверки владельцев компонентов

| Владелец | Отчёт и выполненная проверка |
|---|---|
| vault_backend | Стабильные имена/формы, атомарные update/rename, освобождённые manual namespaces, collision rollback и restart, неисполняемые архивы, экспорт orphan rows и консервативный metadata marker. Strict/full compile и focused tests прошли |
| mcp_protocol | SDK instructions/tools, metadata-only projection, реальный Vault, независимые HTTP-клиенты, access-policy и close; bridge передан lifecycle и интегрирован им |
| lifecycle_setup | Listener-before-DB, concurrent starts/force, версии, чужой порт, crash/restart, timeout/failed-start cleanup, реальный proxy drain, setup merges/backup/no-op, фактический запуск временного Windows Startup shortcut |
| lifecycle_setup: поставка | Изолированный stage с README/OpenCode helpers, production install с нулевым дрейфом от source lock; собственный SDK stage, UI bytes, CLI/stdio, idempotent Codex setup и client-independent lifetime прошли |
| frontend | 15 групп Chromium-проверок: 400/404/409/500/network, drafts/focus/selection, блокировка повторного submit, GET-only retry после подтверждённой мутации, неоднозначный lost-response без автоматического повтора PATCH, stale GET, точные whitespace/Unicode values, disabled mask, размеры 390×844 и 1360×950 |

Отчёты владельцев находятся в `.codex/tasks/mcp-implementation-20261103/*-result.md`; UI evidence — `.cache/frontend-mcp-evidence/`. Это локальные рабочие артефакты, не обязательная часть npm-поставки. Отчёт специалиста не подменяет проверку общего результата координатором.

Промежуточный stage после `qa-case-first-start` — `ghostvault-release-Axw17O`; более ранние `lEUreS` и `1YGPAm` заменены им. Координатор отдельно повторил path regression и release verifier на Node 22.13.0, оба exit 0; evidence — `coordinator-paths-stage-checks.json` в каталоге задачи. Все эти stage предшествовали shutdown-исправлению; окончательная приёмка относится к новому архиву с SHA-256 `86c5e2b2…`, указанному выше.

## Воспроизводимая проверка из checkout

```sh
cd ghostvault
npm run setup:dev
npm run build
npm run test:all
npm pack
```

Для проверки установки создаётся отдельный пустой каталог с собственным private `package.json`; установка выполняется с явным `npm install --prefix <absolute-consumer> <absolute-tarball> --ignore-scripts`. После установки запускаются bin и MCP/proxy интеграция именно этого пакета. Временные серверы используют отдельные data-dir/DB и loopback-порты; тест не должен выбирать домашнюю БД или действующий порт gateway.

## Ограничения и границы

- Проверенная ОС — Windows; Linux/macOS runtime не выдаются за проверенные. Автоматическая регистрация запуска там явно не поддерживается. Windows Startup работает после входа пользователя; это не boot service или supervisor.
- SDK доставляет MCP instructions и tool description. Фактическое постоянное присутствие правил в model prompt, lazy loading, resume, compaction и cache hit разных harness не проверены и не гарантируются протоколом.
- MCP сам не настраивает прокси клиента. Подстановка работает только в поддерживаемом потоке GhostVault. Облачные вызовы и действующие конфигурации клиентов не использовались в новой приёмке.
- SQLite на Node 22.13.0 выдаёт предупреждение experimental. Шифрование Secret Vault и защищённый ввод человеком остаются будущим этапом.
- Миграция проверена на fixtures, без запуска на пользовательской БД. При намеренном старте с существующей БД нормализация выполняется атомарно; конфликт отменяет запись. Совместимость downgrade со старой позиционной схемой форм не установлена. Существующие архивы не удаляются и не исполняются.
- Промежуточная установка npm первоначально выбрала родительский пользовательский проект из-за отсутствия собственного package.json/явного prefix. Добавленный GhostVault и 163 пакета удалены; остальные прямые зависимости сохранены. Транзитивный Zod остался 4.6.7, исходная разрешённая версия не установлена; точное восстановление lockfile не заявляется. Пользователь уведомлён. Последующие установки используют проверенный явный prefix.

## Итог независимой QA

Актуальный `verification-result.md` и `verification-retest.md`: ошибка первого запуска с разным регистром отсутствующих Windows-путей закрыта независимым повторным тестом. Дополнительно прошли Node22 process/force/crash/drain/timeout/setup/реальный временный shortcut, архивные scopes/fidelity, два MCP-клиента с прокси, четыре объединённых UI-сценария ошибок и установленный npm bin/setup в пути с пробелами. Финальный backend review повторно проверил export/migration на Node22 — PASS.

Исходный `verification-shutdown-review.md` подтвердил: дедлайн launcher не ограничивал завершение самого сервера при upstream без ответа или бесконечном SSE. После трёх ограниченных по времени stop/force runtime оставался stopping; ручной abort клиента освобождал работу и позволял безопасный restart. Это был недостаток доступности, а не доказательство повреждения БД. Выбран [контракт shutdown](mcp-implementation-contract.md#shutdown-of-stalled-upstream-work): 5000 мс grace, затем отмена сетевых операций и до 2000 мс на фактическое завершение обработчиков до закрытия БД/порта. Исправление прошло общую сборку, установленные проверки координатора и независимую приёмку; дефект закрыт. Произвольный некооперативный custom hook имеет отдельное явно указанное ограничение.

Независимая приёмка дополнительно проверила реальный TCP slow reader: 92 случая backpressure, отмена и остановка за 5026 мс без освобождения клиента; DB закрыта ровно один раз после downstream. Проверены общий интервал endpoint/proxy, незавершённый token без ложного DONE, hook failure за 7002 мс с живой DB и безопасным authenticated retry. Отчёт — `verification-shutdown-acceptance.md`; полный список команд и evidence сохранён рядом.

Отдельное исключение среды QA: ошибка очистки временного fixture оставила один синтетический runtime после удаления discovery metadata. Автоматическая проверка отклонила проверенное по identity завершение/очистку с общей причиной `blocked by policy`; повторного обхода не выполнялось. Очистка этой среды остаётся незавершённой; проверки принятого архива прошли. Точные локальные пути/PID и read-only подтверждение сохранены в отчёте QA и checkpoint координатора; пользователь уведомлён.
