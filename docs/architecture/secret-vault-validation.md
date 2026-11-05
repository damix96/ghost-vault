# Secret Vault 0.2.0: приёмка

Исходный этап: 2026-11-05; окончательная интеграция и локальная поставка: 2026-11-06. [Контракт](secret-vault-implementation-contract.md); [проверочный запуск и карта модулей](secret-vault-checks.md). Требуемый результат: защищённое хранение на Windows, теоретическая поддержка macOS/Linux, создание и защита ручных записей в UI, инициирование локальной формы ввода через MCP. Этот объём реализован и проверен.

## Окончательная интеграция и локальная поставка

Независимая QA `PASS_SCOPED_CURRENT_SOURCE`: свежая Node22.13 сборка,124 собственных cases и5 выбранных suites PASS. Закрыты context/full-history/raw-SSE/pre-DONE findings; поздняя защита, snapshot coherence, сохранность client/hooks/request и учёт private cache проверены.191 input hashes соответствуют текущим исходникам; manifest SHA256 `fa40f8877301630f08ee79107a9d419bb488ce552a84c1901f4afa0776467e13`. Единственное финальное изменение EOF теста отдельно перекомпилировано QA: все564 emitted files идентичны принятой сборке. Новых открытых findings в проверенном scope нет.

Root сверил окончательный архив `2817a99e…` с QA и установленной копией:388 tar members exact;111 production JS и111 declarations побайтно совпадают с QA;111 maps равны после нормализации outDir-relative `sources`;51 UI file совпадает с принятой frontend-сборкой. Все8083 файла подготовленного consumer graph совпали с durable installation. Это проверка конкретного пакета и graph, не гарантия будущего разрешения ranges. Предыдущий архив `0bebe5d5…` остаётся отклонённым.

На `http://127.0.0.1:8767/dashboard` запущен runtime0.2.0 из `%LOCALAPPDATA%/GhostVault/releases/0.2.0-2817a99ee619/node_modules/ghostvault`. До замены legacy-процесса создан consistent SQLite backup; его identity/порт и соответствие рабочей БД проверены. После запуска: authenticated runtime status, health, dashboard/assets, обе secret-input страницы и реальный stdio MCP bridge PASS; четыре инструмента и initialize instructions доступны. Исходные строки всех девяти таблиц сохранены, integrity ok; миграция добавила registry reservations и vault identity. Существующие ручные значения не помечались защищёнными автоматически, тестовые секреты в рабочую БД не добавлялись.

Backup: `%LOCALAPPDATA%/GhostVault/backups/zen-live-before-0.2.0-20261105T202840Z.db`. Durable installation отделена от пользовательского checkout с незакоммиченными изменениями. Настройки сторонних harness, PATH и Startup не менялись. Обновление не отменяет ограничений OS-backed storage и не превращает старые backups в зашифрованные.

Точные evidence: `.codex/tasks/secret-vault-delivery-20261105/verification-final-retest.md/json`, `final-delivery-reconciliation.json`, `live-final-backup.json`, `live-delivery-acceptance.json`, `live-mcp-check.json`. Более ранние pending/FAIL ниже описывают прежние snapshots, не текущее состояние.

## Доказательства и границы

| Требование | Выполненная проверка |
|---|---|
| Windows DPAPI CurrentUser | Реальный native x64 provider на Node22.13/26.8.2; Unicode/NUL/CRLF, restart, tamper, неверный контекст, unavailable provider, атомарный rollback и отсутствие plaintext fallback |
| macOS/Linux | Keychain/явный Secret Service, AES-256-GCM; injected системные fixtures проверили roundtrip, restart, потерю/недоступность ключа. Настоящие ОС не проверены |
| UI create/mark/replace | Реальный browser/source API с fileSQLite/WindowsDPAPI: создание, защита текущего значения, замена без загрузки оригинала, rename/delete, conflict/cancel/lost-response и обычные записи |
| MCP ввод | Официальные SDK clients, локальная форма, атомарные multi-name/CAS операции, status/cancel/TTL/reconnect, metadata-only receipts. Значения не передаются через MCP |
| Native opener | Установленный production launcher открыл Chrome156 через Windows; HTTP document navigation и JS страницы подтвердили visible/focused. Synthetic page без секретов; сервер закрыт, вкладка могла остаться |
| Masking и restoration | Независимая QA воспроизвела и закрыла NUL, malformed UTF16 и composite-with-token findings; полный HTTP history, активный/retired SSE preview и actual outbound masking; точное обратное восстановление без каскадной подстановки |
| Установленный пакет | Чистая установка, CLI/bin path с пробелами, stdio first-start, MCP/DPAPI/proxy/UI/setup/status/stop; независимая сверка архивных и установленных файлов |

Защищаются явно отмеченные ручные значения и их принадлежащие операции архивные/диагностические копии. Обычные значения и вся SQLite БД не становятся зашифрованными. Экспорт protected rows содержит `valueOmitted:true`; это не backup секретов. Cleanup pending означает committed success; исторический receipt и текущее состояние Vault различаются намеренно.

## Проверенный артефакт

`ghostvault-0.2.0.tgz`, SHA256 `80ce61ba07d04930a24e2f38b36bad37f10e4dabed264e511bcc83b49b6b9ba1`.

Независимый verdict: `PASS_SCOPED_ARTIFACT_RECONCILIATION`.382 archive files побайтно совпали с installed payload;109 production JS и109 declarations — с независимо испытанной QA-сборкой;51 UI file совпал с принятым frontend.109 source maps различались только относительным prefix в `sources` из-за разных outDir.384 captured inputs неизменны во время сверки; последующие изменения касались только документации для публикации исходников.

Consumer установил168 dependency packages, без GhostVault. Все14 прямых зависимостей удовлетворяли manifest ranges. Относительно source lock разрешились45 новых версий и4 дополнительных package paths; zero-drift не заявляется. Этот фактический graph проверен отдельно:43 baseline/secret/variable tests и runtime integration/SDK bridge. Будущее разрешение semver ranges не покрывается тем же verdict автоматически.

Полные suites проверены по группам; исходный `test:all` остановился на устаревшем ожидании семи SQLite columns. Единственное исправление теста добавило утверждённые `is_secret,protected_value,write_revision`, после чего targeted schema/composite проверки прошли. Оставшиеся группы тоже прошли; исходный exit1 не переписан как exit0. В installed-test harness исправлялись только отсутствующий parent report directory и слишком длинный fixture cwd; production payload не менялся.

## Интеграция с актуальным main

Дополнительная поставка объединяет `main` на `08ba948` с Secret Vault `cb83cf1`: сохраняются контексты замен, потоковый обзор, нормализация имён и выравнивание копирования. При объединении исправлены две несовместимости: `SecretCache` обращался к удалённому DOM-элементу; `ResponseChangeEvidence` обрезал текст до маскирования и раскрывал часть длинного protected neighbor. Теперь кеш очищается через текущий stream API, а диагностический контекст строится после full-text projection с пересчётом UTF16 границ. Клиентский payload не меняется.

Root baseline `test:all` прошёл целиком за128s. После исправлений: свежая TypeScript сборка,27 Secret Vault tests,5 affected suites, protected request snapshots и runtime integration PASS. Источники290 captured inputs не менялись во время этого запуска. Реальный Chrome/fileSQLite/DPAPI browser acceptance подтвердил protected create/mark/replace, очистку кешей/полей, отсутствие старого значения, committed cleanup notice без повторной записи; public index SHA256 `a372c89cb69e8a06636fe93bf199a02c4aa340b804b052df894252316173768a`.

Новый архив `ghostvault-0.2.0.tgz`: SHA256 `0bebe5d58a6d31808fc985d900dddfbe95f92d76f1ffaa75f86e1b90344fa9b2`. Все385 tar members совпали с чистой установкой;330 production output files совпали с текущей сборкой. Installed verifier PASS на Node22.13/26.8.2;6 affected compiled tests PASS с dependencies именно чистой установки. Отдельная ошибка PowerShell arguments при создании test-fixture junction исправлена; package/consumer не менялись. Исходный архив выше остаётся историческим evidence, не артефактом этой интеграции.

Независимая QA: `FAIL_SCOPED_CONTEXT_PRIVACY`, `verification-context.md/json`. Исходная обрезка длинного protected neighbor исправлена, но защищённый composite с вложенным PUBLIC token меняется при restoration и теряет full-form recognition в after diagnostic copy. Его прежний суффикс раскрывается через public history: реальные TCP JSON/SSE/decoded-tool JSON/tool-SSE подтвердили один дефект;94 cases,89PASS/5FAIL. Actual client/hooks/request payload остаются точными. Сборка выше не принята для live; требуются correction и отдельный retest сохранённых counterexamples.

Evidence этого этапа: `.codex/tasks/secret-vault-delivery-20261105/`; прежние FAIL сохранены. Read-only backup пользовательской БД и проба миграции копии прошли: integrity ok, все исходные строки сохранены; добавлены22 alias registry rows и vault identity setting. Live delivery и миграция рабочей БД не выполнялись.

Последующий независимый retest исправленного source manifest `67f150f2…`:112 собственных case checks и5 выбранных suites PASS. Закрыты прежние context/full-response/raw-SSE/pre-DONE counterexamples; late mark/update/rename/delete и old/fresh request snapshots проверены, actual clients/hooks точны. Финальная source-приёмка остаётся условной: во время проверки добавлен private diagnostic cost accounting в шести файлах. Это не новый заявленный дефект, но требуется свежая компиляция и targeted проверка данного delta перед новым package/live verdict. Прежний архив `0bebe5d5…` не становится принятым автоматически.

## Фиксированный снимок после учёта private cache

Окончательный owner manifest/results `final-cache-accounting.json`, SHA256 `4d6ed1f8537f7ef2814616ac33c0d4dd5470a1d5c725f5a7a826c1660d8ff34f`:188 source files. Root подтвердил их совпадение, выполнил новую компиляцию,28 Secret Vault tests,4 affected retention/evidence/stream suites, protected request snapshot и runtime integration. Все PASS;293 captured inputs неизменны во время сборки/проверок. Предыдущий126s `test:all` также завершился exit0, но изменения accounting во время прогона были зафиксированы; он не выдаётся за проверку нового неизменного снимка.

Новый архив SHA256 `2817a99ee619f31b642e88432c25a313946c3f059000aa7bd4a3db99e4e0d3c2`, путь `.cache/delivery-final-artifacts/ghostvault-0.2.0.tgz`. Чистая установка:388 members exact;333 production output files совпадают с frozen build; принятый UI index остаётся `a372c89c…`. Installed verifier PASS Node22.13/26.8.2;9 affected tests PASS с этой dependency closure, включая private cost/snapshot/context/runtime API. Предыдущий `0bebe5d5…` остаётся отвергнутым для live. Evidence: `frozen-checks`, `frozen-input-delta`, `frozen-package-checks`, `frozen-installed-reconciliation` в каталоге этапа. Независимое окончательное заключение по accounting delta и live rollout пока не заявлены.

## Воспроизведение

В `ghostvault`: `npm run setup:dev`, `npm run build`, затем `npm run test:all`. Точечный набор новой функциональности — `npm run test:secrets` (28 tests). `node scripts/stage-release.mjs --out EMPTY_DIRECTORY` собирает отдельный production stage; после установки его зависимостей `node scripts/verify-release.mjs --stage STAGE` проверяет установленный runtime на synthetic данных. Выбирать отдельные пустые каталоги, не рабочую БД.

Подробные локальные evidence координатора находятся в `.codex/tasks/secret-vault-20261105/`: `verification-final-source`, `verification-final-artifact`, `frontend-final-review`, `final-artifact-result-review`, `goal-completion-audit`; browser/network fixtures — в `.cache`. Они сохраняют ранние FAIL и границы каждого прогона, не входят в исходный Git/package payload.

Не выполнялись live Unix/ARM64/другая Windows учётная запись/reboot или публикация в registry. Изоляция от произвольного кода того же пользователя, удаление внешних backups и физическая очистка всех носителей не обещаются.
