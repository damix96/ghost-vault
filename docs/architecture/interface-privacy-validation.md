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

## Обратимое шифрование и группировка

Дополнение2026-11-07 заменяет прежний односторонний checkbox. Новая установка включает плоскую группировку auto по последнему `_` при≥2 членах, полные singleton-строки, короткий preview, удаление повторных/технических helper-абзацев и снятие шифрования без повторного ввода. Названия вкладок не выбраны пользователем и сохранены.

| Проверка | Результат и границы |
|---|---|
| Backend owner, Node22.13 | `test-variable-encryption-toggle`, affected protected-storage/protected-api: реальные DPAPI/on→off→restart→on, current+архивы, exact NUL/Unicode/CRLF/forms/aliases, SQL/provider/corrupt rollback, current/export ordinary originals, protected соседние данные/history/settings остаются projected. PASS; подробный отчёт `.codex/tasks/variable-encryption-toggle-20261107/backend-result.md`. |
| Editor, root Node22.13 | `scripts/test-variable-encryption-editor.mjs`, реальные Chrome/API/DPAPI на synthetic UiTestHost: пять PATCH, сохранение current при пустом поле, повторное включение, value+flag одной записью, sensitive cancel clearing, original при разрешённом отображении, lost-response GET-only без replay. PASS; screenshots0, без viewport matrix. `.cache/encryption-editor/result.json` в ghostvault. |
| Найденный frontend дефект | Первый blank-existing save блокировался cached native valueMissing при required=false. Перед показом формы теперь завершается обновление textarea и очищается её custom validity; новые обязательные поля сохраняют обычную проверку. Первый FAIL не выдан за PASS; после исправления тот же настоящий click/save сценарий проходит. Дополнительный fail fixture был обращением к temporary empty array после переключения privacy; исправлен null-safe predicate, не продукт. |
| Группы | Owner pure+browser8cases PASS: точные6 имён пользователя, arbitrary suffix length, поиск/full membership/восстановление раскрытия, singleton dissolution, keyboard/Ctrl, pending focus/selection/hint refresh и privacy purge. Root сверил6source hashes и опубликованные HTML/assets; browser matrix повторно не запускал. |
| Общая сборка/пакет | `npm run build` PASS; UI пересобрана после точечного validity fix.391 файлов установленного tarball равны исходному payload; новый release установлен offline с прежним lock, dependency version/integrity drift0. `.cache/encryption-release/{pack.json,install.log,candidate.json}`. |
| Live/SDK | PID39328, instance37cf0f2a-03c7-4e8e-8bcf-a7c89e5daecf. Новая CLI/SDK bridge возвращает names-only catalog; live HTML совпадает, checkbox существующей encrypted записи доступен, короткий preview/удалённые helper элементы подтверждены. pageErrors=[], liveWrites0, screenshots0. Проверка live не меняла шифрование пользовательских записей. |
| Доставка данных/конфигурации | Backup integrity_check ok, keyed digests строк всех пользовательских SQLite-таблиц до/после совпали. Новый runtime убирает только устаревшие prevent_demotion triggers; shape checks остаются. OpenCode command и Startup обновлены на новый release, остальные настройки сохранены. |

Artifact SHA256: `6e9f59690ac70e5a1d86f1364e561fe1d091c4b67141e37dc5025a9e85cc1bf0`.
Installed: `%LOCALAPPDATA%/GhostVault/releases/0.2.0-6e9f59690ac7/node_modules/ghostvault`.
Backup: `%LOCALAPPDATA%/GhostVault/backups/zen-live-before-encryption-toggle-20261106T212052Z.db`.
Фактическая доставка: `.cache/encryption-release/{deployment.json,live-verification.json}`. Предшествующие UI-only публикации в `.cache/vault-grouping/` сохранены; их overlay заменён полным новым release. Старые исходные отчёты/артефакты не переименованы в новые доказательства. Общие crypto/provider/full UI suites заново не повторялись: использована указанная затронутая область; новых Unix/ARM/reboot заявлений нет.
