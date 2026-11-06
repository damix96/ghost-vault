# Приёмка интерфейсных исправлений 2026-11-07

Требования: [interface-privacy.md](interface-privacy.md). Реализация и live-доставка завершены; прежние отчёты Secret Vault относятся к прежней политике безусловного скрытия и сохранены.

| Проверка | Результат и границы |
|---|---|
| Backend, Node22.13 | `test-interface-display`: реальные DPAPI/JSON/SSE, явный same-origin доступ к оригиналам, обычное значение остаётся видимо, скрытие зашифрованного, old-value snapshot после смены значения, отдельные SSE-каналы и 403 чужому Origin/Fetch-Site, освобождение RAM. PASS. |
| Смежные suites | Runtime retention/API, response evidence/private evidence, secret-input events/preview-stream/projection, variable requests, MCP catalog/HTTP/real Vault, admin regressions. PASS. Старый Node ApiClient-тест выявил отсутствие browser Origin; безопасный дефолт общего клиента сохранён, браузер применяет свою настройку. |
| Браузер | Chrome + Node22.13 + native DPAPI + ephemeral DB/HTTP: одна форма, create/replace, точные значения/неизменный alias, пустой защищённый редактор, очистка ввода, обычный черновик, lost committed response без повторной записи, выборочное скрытие/обратное включение/сохранение настройки, полный ответ. Desktop1440 и mobile390; pageErrors=[]; PASS. |
| Визуальная проверка | Исправлен перенос верхних действий и карточек на mobile; screenshots просмотрены. Impeccable focused detector exit0. |
| Установленный пакет | `verify-release.mjs` на отдельном временном сервере/БД: официальный SDK stdio, первый запуск, инструкции, каталог, protected batch и proxy roundtrip, безопасные старые API, DB/WAL canaries, setup/status/stop. Node22.13 PASS. |
| Live8767 | Новый runtime PID40508, instance `e3153845-ca2b-4e16-8f39-2eb3350e3496`; 387 установленных файлов dist/public byte-equal source build; dashboard exact HTML, live browser one button/default unchecked privacy/empty create, zero live writes. |
| OpenCode | User config command и Startup shortcut указывают на новую установку; остальные настройки сохранены. `opencode mcp list` из рабочего проекта: GhostVault connected, open-computer-use connected; фактические bridge-процессы используют новый release. Из отдельного интеграционного worktree CLI показал иной контекст без серверов; это не выдано за результат рабочего проекта. |
| Данные | SQLite backup перед заменой runtime, integrity_check=ok; keyed digest всех строк всех пользовательских таблиц до/после совпал. Значения не записывались в отчёт. |

Artifact SHA256: `28b63d5f16974196ba65dfd050b5fa367a66edeed5663389a5220ee848c07f55`.

Installed package: `%LOCALAPPDATA%/GhostVault/releases/0.2.0-28b63d5f1697/node_modules/ghostvault`.

Backup: `%LOCALAPPDATA%/GhostVault/backups/zen-live-before-interface-20261106T200417Z.db`. Дата UTC предыдущего дня соответствует локальному 2026-11-07.

Машинные доказательства в интеграционном worktree: `.cache/interface-release/{candidate,deployment,live-verification}.json`, `verify-installed.log`, `opencode-mcp-list-root.log`; `ghostvault/.cache/interface-ui/result.json` и screenshots; `ghostvault/.cache/test-runs/{run-octJaw,run-hS36uA,run-lK6b1Z}/results.json`. Первоначальный mobile fail и admin Origin fail сохранены в истории запуска, итоговые проверки выполнены после исправления.

Границы: опубликован Git, registry release не запрашивался; реальный reboot/macOS/Linux/ARM не проверялись. Выбор видимости действует в конкретном браузере; открытая старая страница требует перезагрузки. Старый RAM history не переживает штатную замену сервера, SQLite-записи сохранены. Экспорт защищённых записей остаётся metadata-only; скрытие не является изоляцией от программ того же пользователя.
