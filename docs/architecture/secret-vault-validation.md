# Secret Vault 0.2.0: приёмка

Дата: 2026-11-05. [Контракт](secret-vault-implementation-contract.md); [проверочный запуск и карта модулей](secret-vault-checks.md). Требуемый результат: защищённое хранение на Windows, теоретическая поддержка macOS/Linux, создание и защита ручных записей в UI, инициирование локальной формы ввода через MCP. Этот объём реализован и проверен.

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

## Воспроизведение

В `ghostvault`: `npm run setup:dev`, `npm run build`, затем `npm run test:all`. Точечный набор новой функциональности — `npm run test:secrets` (25 tests). `node scripts/stage-release.mjs --out EMPTY_DIRECTORY` собирает отдельный production stage; после установки его зависимостей `node scripts/verify-release.mjs --stage STAGE` проверяет установленный runtime на synthetic данных. Выбирать отдельные пустые каталоги, не рабочую БД.

Подробные локальные evidence координатора находятся в `.codex/tasks/secret-vault-20261105/`: `verification-final-source`, `verification-final-artifact`, `frontend-final-review`, `final-artifact-result-review`, `goal-completion-audit`; browser/network fixtures — в `.cache`. Они сохраняют ранние FAIL и границы каждого прогона, не входят в исходный Git/package payload.

Не выполнялись live Unix/ARM64/другая Windows учётная запись/reboot, миграция пользовательской БД, обновление действующего8767 или публикация в registry. Изоляция от произвольного кода того же пользователя, удаление внешних backups и физическая очистка всех носителей не обещаются.
