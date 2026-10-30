# Реализация меток секретов: передача backend

Дата: 2026-10-31 (Asia/Qyzylorda). Backend реализован и проверен на isolated synthetic data. Рабочий server, live DB и `public` не изменялись. Внешних модельных запросов не было. Коммит/публикация относятся к координатору; в рабочем дереве имеются другие изменения участников, их нельзя приписывать этому этапу.

Контракт: [secret-label-templates-contract.md](secret-label-templates-contract.md). Исходное исследование: [secret-label-templates-review.md](secret-label-templates-review.md). `docs/master-spec.md` §6.1 и строка restart синхронизированы с реализованным process-memory auto lifetime.

## Результат

| Область | Реализовано |
|---|---|
| Templates | `label_template` в SQLite/API/create/update/baseline/export/preview; named/numeric groups, escaping, missing/empty, Unicode sanitation, parser-based validation. Пользовательский `DB_HUB_$protocol_$1` поддержан буквально. |
| Allocation | CSPRNG 12 hex, atomic SQLite transaction, 16 collision retries, общий namespace всех форм, immutable aliases, hashes tombstones, отказ до upstream при исчерпании. |
| Lifetime | Новые auto originals только RAM. Legacy auto records не очищаются и загружаются явно как legacy; правила/manual остаются durable. Tombstones не содержат новых auto originals/открытых aliases. |
| Manual edit | Стабильный key, versioned wire alias при изменении original; maskInAi сохранён. Прежние originals только для inbound, `retainedVersions` в UI API; DELETE удаляет current+versions, hashes остаются. |
| Requests/streams | Immutable inbound snapshot после masking до async hook/upstream; edit/delete не ломают уже начатый response/SSE/tool arguments. После завершения snapshot освобождается обычным GC. |
| Multi-instance | Один активный VaultStore на DB, OS-released SQLite sidecar lock, явная ошибка второго процесса. Crash release проверен. |
| Preview/UI | Новый пример alias не создаёт mapping; suffix явно предварительный. Existing preview использует точный прежний alias. UI владелец получил контракт. После его проверки добавлены точные representations в vault/save/interceptedSecrets/export; backend integration подтверждает versioned manual + URL derived alias + exact original. UI проверяет актуальный dist отдельно. |

Почему нужны archive и tombstones: прежний token должен оставаться связанным с тем же original. Как: версии ручных mappings сохраняются в SQLite, удалённые/volatile aliases оставляют лишь резервирование. Почему не удалять всё при restart: это сломало бы прежние mappings без разрешения; process-memory политика применяется к новым auto originals, legacy сохраняется. Цена: archive/tombstones растут без автоматического TTL; экспорт и история могут сохранять originals.

## Файлы этого этапа

- Vault: `ghostvault/src/vault/{store,sqlite-db,pattern-engine,secret-representations}.ts`; новые `{alias-registry,runtime-lease,label-template,database-types}.ts`; `ghostvault/src/types/index.ts`, `ghostvault/src/telemetry/types.ts`.
- API: `ghostvault/src/proxy/{pattern-editor-api,rule-preview-api,rule-preview-worker,dashboard-api,workspace-api}.ts`. Некоторые из этих файлов уже были untracked до этапа; статус untracked не означает, что весь их код создан здесь.
- Request/stream: `ghostvault/src/proxy/{server,sse-transformer,stream-relay}.ts`, `ghostvault/src/protocols/stream-buffers.ts`.
- Проверки: новый `ghostvault/src/test-secret-labels.ts`; два точечных изменения старых fixtures в `test-protocols.ts` и `test-composite-alias-lifecycle.ts` для запрета повторного присвоения уже занятого alias.
- Dependency: `@eslint-community/regexpp` в `ghostvault/package.json`/`package-lock.json`; npm script `test:labels`.
- Документы: этот отчёт, контракт и адресные изменения `docs/master-spec.md`. Frontend/ui-kit не редактировались этим backend-этапом.

## Проверки

| Команда / проверка | Результат |
|---|---|
| `npx tsc --pretty false` | PASS, финальная компиляция перед freeze artifact. `npm run build` не выполнялся. |
| `node dist/test-secret-labels.js` | PASS: named/numeric/optional/empty/repeated/Unicode captures, unknown refs, no recursive interpolation, template edit non-retroactivity, API baseline/preview, forced collision/retry/exhaustion, manual/auto/derived namespace, DB rollback/no phantom cache, versions/maskInAi, all chunk splits, SSE tool args after deletion, second process rejection, crash release, restart/legacy/promotion, old schema migration/conflict preservation, gateway snapshot, versioned encoded representation в maskedPrompt/vault/interceptedSecrets/export и отсутствие upstream вызова при allocation failure. |
| `node dist/test-composite-replacements.js` | PASS: exact composite representations, reload stability, alias collision fixture и non-cascading restoration. |
| `node dist/test-protocols.js` | PASS: Anthropic/Chat/Responses/Gemini/Antigravity payload targeting, service fields, manual priority. |
| `node dist/test-protocol-streams.js` | PASS: fragments, parallel tools, terminal metadata/signatures. |
| `node dist/test-protocol-transport.js` | PASS: local synthetic transport. |
| `node dist/test-admin-regressions.js` | PASS. |
| `node dist/test-gateway-regressions.js` | PASS. |
| `node dist/test-sqlite-patterns.js` | PASS. |
| `GHOSTVAULT_DB_PATH=:memory:` + `node dist/test-server.js` | PASS; принудительно isolated default store. |
| Scoped `git diff --check` | PASS. |
| Stable artifact imports/allocation/close на temp DB | PASS; auto originals не записались. |

Все persistence tests используют temp directory или `:memory:`. Gateway test новых guarantees использует in-process fetch stub; прочие transport suites — локальные mocks. Никаких real-secret fixtures, live DB inspection или network inference.

## Stable artifact и migration preflight

Путь: `.cache/backend-labels-20261031-v2/`. `manifest.json` содержит SHA-256 244 файлов, timestamp freeze `2026-10-30T20:26:24.7425579Z` (= 2026-10-31 01:26 Asia/Qyzylorda). Состав: весь скомпилированный `dist`, package/lock, `node_modules/@eslint-community/regexpp`. Это достаточно для isolated migration preflight; полный serving runtime требует зависимостей package-lock в publish worktree.

Импортировать из stable artifact `dist/vault/sqlite-db.js` и `dist/vault/store.js`. Последовательность:

1. Координатор создаёт SQLite-consistent копию рабочей БД в отдельной папке. Не plain-copy активного WAL database без согласованного snapshot.
2. `const db = new VaultDatabase(copyPath)` применяет additive schema migration.
3. В `try` выполнить `const store = new VaultStore(db)`; это захватит lock копии и атомарно зарезервирует/проверит legacy aliases. Можно вывести только counts/storage categories; не originals/aliases/captures.
4. В `finally` выполнить `db.close()`, включая ошибку Store constructor. Никакого `GhostProxyServer`, listen или model call для preflight не требуется.
5. При конфликте не переименовывать/удалять оригиналы автоматически. Передать координатору тип ошибки; детали с секретами не печатать. Live продолжает работать до отдельного deployment решения.

Rollback и ограничения описаны в контракте: старый binary поверх новой БД игнорирует registry/version archive и не является безопасным откатом. Полный откат требует пары binary+consistent backup с явным решением о данных, созданных после backup. На этом этапе такая операция не выполнялась.

Координатор сообщил PASS preflight предыдущего artifact на SQLite-consistent копии live: integrity_check ok; прежние 7 таблиц/колонки, counts и SHA256 строк неизменны (33 legacy auto, 2 manual). Доказательства: `.cache/refinement-deploy-20261031/{baseline.json,migration-result.json}`. Финальный v2 добавляет сериализацию точных representations и их интеграционные проверки; его preflight координатор проверяет отдельно.

Ограничения доказательств: sudden power-loss durability не симулировалась. Lock проверен отдельным процессом и аварийным exit на локальной файловой системе; произвольные SQL writers, старые binaries, hardlink/network filesystem обходы не входят в supported deployment. Старые токены, чья связь была уничтожена прежним `INSERT OR REPLACE`, автоматически восстановить невозможно.
