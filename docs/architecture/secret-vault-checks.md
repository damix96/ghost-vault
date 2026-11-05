# Secret Vault 0.2.0: сборка и точечная проверка

Команды ниже выполняются из корня репозитория. Реализация, независимая source QA и сверка итогового архива завершены успешно. Действующий [контракт](secret-vault-implementation-contract.md); [границы приёмки](secret-vault-validation.md). Это версия0.2.0, не прежний MCP0.1.0 пакет.

## Артефакт

Проверенный локальный артефакт координатора: `.cache/secret-vault-artifacts/npm-candidate-ymaflh0n/ghostvault-0.2.0.tgz`. Архив и подробные test evidence не включены в Git; исходники и команды воспроизводимой сборки включены.

SHA256: `80ce61ba07d04930a24e2f38b36bad37f10e4dabed264e511bcc83b49b6b9ba1`.

Чистая установка и installed CLI/MCP/DPAPI/proxy проверены на Node22.13. Все109 executable JS совпадают с независимой QA-сборкой, все382 tar members — с установленными файлами. Ничего не опубликовано в npm и не развёрнуто в пользовательской БД. Consumer разрешает зависимости по ranges; его фактический graph отдельно проверен и не объявляется идентичным source lock.

## Проверка отдельно от рабочей БД

После первоначальной установки и сборки, с Node.js22.13 или новее:

```powershell
Push-Location ghostvault
npm run setup:dev
npm run build
Pop-Location
```

Из корня репозитория:

```powershell
$vaultReviewData = Join-Path $env:TEMP ('ghostvault-review-' + [guid]::NewGuid().ToString('N'))
node ghostvault/dist/runtime/cli.js ensure-start --data-dir $vaultReviewData --port 18765
node ghostvault/dist/runtime/cli.js status --data-dir $vaultReviewData --port 18765
```

Явный новый `--data-dir` отделяет проверку от существующих данных; одинаковые параметры нужны всем командам. Если18765 занят чужим сервисом, выбрать другой порт и заменить его в командах/URL; `-force` для этого не нужен.

| Действие | Адрес/ожидаемый результат |
|---|---|
| Создать секрет в UI | `http://127.0.0.1:18765/dashboard`, страница «Секреты», «Добавить секрет»; после сохранения оригинал отсутствует в таблице |
| Защитить обычную ручную запись | «Защитить»; имя, значение, токен и maskInAi сохраняются, меняется хранение |
| Ввести через отдельную форму | `http://127.0.0.1:18765/vault-secret/new`; до32 имён, одна атомарная операция |
| Заменить два существующих значения | `http://127.0.0.1:18765/vault-secret/update?secrets=MY_API_KEY,BASE_URL`; поля пустые, прежние значения не загружаются |
| Вызвать из MCP | `ghostvault_request_secret_input` с именами и операцией; открывается локальная форма, значения вводятся человеком; `ghostvault_secret_input_status` возвращает только состояние/имена/токены |
| Остановить проверочный сервер | Команда ниже; данные сохраняются в указанной временной папке |

```powershell
node ghostvault/dist/runtime/cli.js stop --data-dir $vaultReviewData --port 18765
```

MCP-клиенту нужен stdio bridge именно с этими `--data-dir`/`--port`; подключение стандартной конфигурации ведёт к её собственному Vault. `setup --client codex|claude|cursor` без явного config выводит конфигурацию, не меняет клиент. Подключение MCP само по себе не настраивает прокси запросов.

## Где исправлять конкретный сбой

| Область | Основные файлы | Проверка из `ghostvault` |
|---|---|---|
| Windows DPAPI / Unix keyring | `src/security/windows-dpapi.ts`, `keyring-provider.ts`, `secret-protection.ts` | `npm run test:secret-providers` |
| SQLite, архивы, атомарность, очистка | `src/vault/protected-storage.ts`, `protected-writes.ts`, `protected-diagnostics.ts`, `sqlite-text.ts` | `npm run test:secret-storage` |
| UI mark/create/replace | `frontend/secret-protection.js`, `protected-editor.js`, `protected-editor-view.js`; `src/proxy/variable-api.ts` | `test-protected-api`; browser evidence в `frontend-result.md` |
| Страница ввода / draft / потерянный ответ | `frontend/secret-input-api.js`, `secret-input-page.js`, `secret-input-view.js`, `secret-values-form.js` | `npm run test:secret-input:integration` и browser fixtures из frontend report |
| MCP, session authority, TTL/CAS | `src/mcp/secret-input-tools.ts`, `src/secret-input/manager.ts`, `endpoint.ts`, `storage.ts`, `access.ts` | `npm run test:secret-input:core` и `npm run test:secret-input:integration` |
| Открытие браузера | `src/secret-input/browser-launcher.ts` | `test-secret-input-launch`; actual Windows evidence `native-opener-result.json` |
| Подстановки и stream diagnostics | `src/vault/text-replacer.ts`, `secret-redactor.ts`, `secret-preview.ts`, `src/secret-input/protected-events.ts` | `test-masking-composite`, `test-protected-preview`, `test-secret-input-preview-stream` |
| Запуск, один экземпляр, остановка | `src/runtime/**` | `npm run test:runtime`, `npm run test:shutdown` |

После исходных изменений сначала собрать `npm run build`. Полный набор: `npm run test:all`; новый Secret Vault набор: `npm run test:secrets` (25 executable tests). Для отдельного compiled теста: `node scripts/run-tests.mjs test-masking-composite` или другое имя из таблицы. Внутренние runner fixtures используют синтетические значения; production DB/config не нужны.

## Границы результата

Windows x64/native DPAPI проверены на Node22.13/26.8.2, включая точный restart, NUL/Unicode, повреждение ciphertext, отказ provider и cleanup при внешнем SQLite reader. Actual Windows opener открыл видимую Chrome-страницу без секретов; тестовая вкладка могла остаться. macOS Keychain/Linux Secret Service реализованы и проверены через системные contract fixtures; настоящие Unix/ARM64/другая Windows учётная запись/reboot не проверены.

Экспорт защищённых строк содержит metadata и `valueOmitted:true`, не backup значений. Secret mark шифрует current/archive copies и очищает известные формы в рабочей диагностике; внешние backups не удаляются. `SECRET_STORAGE_CLEANUP_PENDING` означает уже выполненное сохранение: не повторять ввод, смотреть текущее состояние Vault. Исторический receipt сохраняет своё предупреждение. Защита не изолирует от кода того же OS-пользователя; reveal/demotion не предусмотрены.
