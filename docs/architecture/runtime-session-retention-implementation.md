# Runtime-сессии: реализация хранения последнего вызова

Дата: 2026-11-01. Task: `runtime-session-retention-20261101`. Статус: backend исходники и isolated tests готовы; live-публикация выполняется координатором отдельно. Рабочий сервер `8767`, его DB, старые rows, backups и exports не изменялись.

## Поведение

| Область | Реализованный контракт |
|---|---|
| Область хранения | Отдельный `RuntimeSessions` на `GhostProxyServer`, только RAM. При новом server/process экземпляре сессий нет, даже если SQLite содержит прежнюю историю. |
| Содержимое | Один полный `TransactionRecord` на sessionId: request/headers/body до masking (после beforeOutboundRequest при наличии hook), maskedPrompt, итоговый response, representations/interceptedSecrets, необходимые метаданные. Системные сообщения, повторные сообщения, tool calls/results не вырезаются и не склеиваются с прежними вызовами. |
| Когда заменяется | Новый запрос сразу создаёт active snapshot и заменяет предыдущий. «Последний» определяется порядком старта, не порядком завершения. |
| Конкуренция | Все одновременные запросы одной сессии увеличивают activeCalls. Старый вызов продолжает сеть/восстановление, но не может изменить newest snapshot после начала следующего. Завершение старого вызова уменьшает счётчик и обновляет активность, не переписывает данные нового. |
| Streaming | Полный доступный response обновляется в RAM на progress (не чаще существующего интервала 250 мс) и окончательно при завершении. Event preview больше не обрезается до 16000 символов. Никакого урезания снимка ради бюджета. |
| Ошибки/abort | try/finally освобождает активность, включая hook error, allocation error, upstream error, stream failure и disconnect. Клиентский disconnect получает мониторинговый статус 499. |
| Удаление | DELETE сессии/всех сессий удаляет только runtime snapshots. Текущие вызовы продолжают работу, но их поздние callbacks не воссоздают удалённую сессию. Новый вызов с тем же sessionId создаёт отдельное поколение. |
| Рестарт | Runtime originals/сессии не загружаются с диска. Manual mappings/versions, legacy-auto, rules/routes/settings остаются по прежнему контракту; новые auto originals по-прежнему RAM. |
| Старые SQLite rows | Не удаляются, не изменяются и не появляются как runtime history. Требование не даёт разрешения очищать legacy traffic. |

Почему: повторно переданные CLI-контексты создавали дубликаты дисковой истории. Для чего: полный актуальный обмен без накопления истории. Как: один immutable cloned/frozen snapshot, lease на каждый in-flight вызов, object identity поколения и last-started transaction ID. Почему не иначе: latest-completed мог вернуть старый контекст после нового; один boolean active позволил бы вытеснить сессию с ещё работающим параллельным вызовом.

## Бюджет и вытеснение

- `200 МБ = 200_000_000 bytes` (десятичные MB). Учёт: UTF-8 длина JSON canonical payload `{id,firstSeen,lastSeen,activeCalls,record}` каждого сохраняемого snapshot. Сюда входят request до masking, maskedPrompt, response, точные representations, interceptedSecrets, headers и sampleStreamChunk, если присутствуют. Копии внутри сериализуемой структуры учитываются как отдельные поля, даже если JS разделяет ссылку.
- Служебные Map/index/callback/number bookkeeping, V8 overhead, transient API сериализация, preview-worker копия, socket buffers и in-flight processing старых superseded requests не являются retained monitoring snapshots и не входят в этот счётчик. Это не RAM/RSS/process limit.
- На begin/update/end корректируется размер заменённого снимка, затем выполняется eviction. Старый размер вычитается полностью; delete/clear уменьшают счётчик до нуля. Read API не обновляет LRU.
- Пока превышен бюджет и есть более одной сессии, удаляется целиком самая давно неактивная сессия (`activeCalls===0`). Порядок определяется монотонным activity counter, а не неоднозначным совпадением ISO timestamps. Реальная сетевая активность begin/update/end обновляет LRU.
- Активные сессии не удаляются ради бюджета. Единственная оставшаяся сессия сохраняется целиком, даже больше 200 МБ. Если все оставшиеся активны, превышение допускается до следующего завершения/изменения. Запрос/стрим не прерывается ради бюджета.
- DELETE — явное действие пользователя, поэтому допускается для активного мониторингового snapshot. Это не отмена сети и не стирание in-flight restoration snapshot.

Почему нужен отдельный счётчик: RSS включает неизбежную сеть, JS heap и временные копии. Для чего: воспроизводимый мягкий предел именно сохраняемых данных. Как: serialized UTF-8 accounting, один снимок, предсказуемый LRU. Почему не обрезать payload: это повредило бы проверяемый последний контекст и tool results.

## API и frontend-контракт

| Endpoint/event | Контракт |
|---|---|
| GET `/api/sessions` | Прежний массив metadata; `txCount=stepsCount=1`, endpoints только latest request. Добавлены `activeCalls`, `latestTransactionId`, `state:'active'|'complete'`. State относится к последнему запросу; complete может сочетаться с activeCalls>0, когда старый вызов ещё работает. |
| GET `/api/sessions/:id` | Массив длиной 0 или 1, полный latest TransactionRecord; response нормализуется прежним ResponseNormalizer для UI. Record дополнен state. |
| GET `/api/sessions/:id/full` | Сообщения только текущего вызова + его response; не история/слияние. Повторяющиеся сообщения не удаляются. Неизвестное request-представление остаётся доступным как payload. Основной полный источник — TransactionRecord. |
| GET `/api/history` | Metadata только текущих последних RAM snapshots, без SQLite fallback. Это совместимый URL, а не журнал всех вызовов. |
| GET `/api/hooks/context[?id=…]` | Только текущий snapshot; replaced/deleted/legacy ID возвращает `{empty:true}`. Hook sandbox default context тоже runtime. |
| GET `/api/runtime-retention` | `{bytes,budgetBytes:200000000,sessions,revision,unit:'UTF-8 JSON bytes',policy:'latest-started-call'}`. Revision здесь — изменение runtime state, не preview source revision. |
| DELETE sessions | Только RAM. Legacy SQL tables не очищаются. Конфигурация и mapping не затрагиваются. |
| SSE `request_started` | transactionId задаёт новый latest; request snapshot уже доступен. |
| SSE `stream_progress` | Только для текущего latest/неудалённого вызова. Содержит полный text preview; полный структурированный snapshot доступен API. |
| SSE `transaction_completed` | Добавлен `details.latest:boolean`; false для superseded/deleted/уже вытесненного вызова. UI не должен возвращать его как текущий диалог. |
| SSE `session_removed` | `{sessionId,reason:'budget'|'deleted'}`. Удалить локальный snapshot, включая pinned views. |
| SSE `sessions_cleared` | После explicit clear-all. Удалить локальные runtime snapshots. |
| Event subscriber backpressure | Медленный SSE monitoring subscriber закрывается при write=false вместо бесконечной очереди копий трафика; это не прекращает model stream. После reconnect актуальное состояние читается из API. |

Frontend владелец подтвердил интеграционные PASS на актуальном dist: active snapshot, latest=false, DELETE с pinned hint без возврата удалённого вызова, clear-all; preview 66 matches с revision/409/reset; полный контекст >128 KiB; fixture seed через server.recordTransaction. Backend frontend/ui-kit не изменял.

### Preview правил

- Источник — текущие полные request snapshots RuntimeSessions, по одному на sessionId; SQLite history не используется.
- Первый запрос по-прежнему содержит snapshot ISO, offset=0/matchOffset=0. Ответ дополнен `revision:number`.
- Для следующей страницы или продолжения matchOffset передать ту же revision. Если источник изменился, 409 с предложением запустить проверку заново; старые snapshots ради preview не удерживаются.
- Preview revision меняется при новом latest request, изменении его body/endpoint/client, удалении или eviction. Response-only streaming, headers/target metadata и завершение без изменения request не инвалидируют preview.
- Проверяется revision до и после worker. Нельзя вернуть смесь страниц разных состояний как единый стабильный результат. При reset UI должен очистить результаты и начать с offset=0.
- Ограничение worker времени/памяти остаётся прежним; ошибка preview не удаляет и не усекает retained request.

### Ассоциация с подключениями

Workspace/default-route availability используют endpoints текущих runtime snapshots и явную сохранённую конфигурацию workspace/routes. Legacy traffic не возрождает сессии/подключения. Custom/изменённые/явно выбранные настройки остаются durable. Удаление/eviction latest snapshot может убрать только runtime основание ассоциации.

## Запись на диск и совместимость

`GhostProxyServer` больше не вызывает traffic методы VaultDatabase. API, preview, workspace, route availability не читают legacy history. Mutating методы `upsertSession/saveTransaction/deleteSession/clearAllSessions` удалены из VaultDatabase, чтобы старый helper путь не мог продолжать запись/очистку. Read-only legacy getters сохранены для offline проверки/миграций, не для runtime UI.

RequestCapture отключён в server и заменён совместимым no-op; `GHOSTVAULT_CAPTURE_DIR` больше не создаёт файлы request/response/metadata. EventBroadcaster не пишет на диск. Штатный Fastify logger остаётся выключен. Произвольные пользовательские hooks, явно скачанные exports, внешний клиент/прокси и сторонние процессы не контролируются этой политикой; существующие файлы не удаляются.

Mapping originals в manual versions и legacy-auto не являются traffic history. Hash registry новых auto aliases продолжает писаться без новых auto originals. Изменение этой политики не заявляет исчезновения прежних секретов с диска или forensic erasure SQLite WAL/backups.

## Проверки и интеграция

Новые тесты:

- `test-runtime-retention.ts`: latest-started/out-of-order, active counter, late completion после delete/new generation, точный JSON UTF-8 accounting, Unicode, immutable reads, LRU, active overflow, singleton overflow, реальный payload `200_000_001` символов, unlimited growth singleton, preview invalidation и независимость store instances.
- `test-runtime-sessions-api.ts`: legacy SQLite baseline неизменен, пустой старт/restart/history/hooks, overlap, full context, hook/upstream error, реальный local HTTP abort с release activity/499, SSE, connection/workspace association, latest-only preview+409, clear, отсутствие traffic canaries в DB/WAL и capture-файлах при заданном GHOSTVAULT_CAPTURE_DIR.
- Старые fixtures адаптированы к latest-only: sqlite-patterns ожидает один вызов с полными тремя сообщениями; chunked/fixed transport использует отдельные explicit session IDs, сохраняя сравнение обоих типов передачи; label preview seed теперь RuntimeSessions, не SQL.

PASS: `npx tsc --pretty false`; runtime retention/API; secret labels; admin regressions; sqlite-patterns; gateway regressions; protocols; protocol transport; protocol streams; composite replacements; test-server и test-telemetry с `GHOSTVAULT_DB_PATH=:memory:`. Только вымышленные данные, temp DB и локальные mocks/stub fetch. Внешние модельные вызовы не выполнялись.

Схема SQLite этой задачей не мигрируется; legacy tables остаются без удаления. Deployment требует совместимого frontend-контракта, установленного baseline зависимостей и drain/restart координатором. Runtime snapshots теряются при restart намеренно. Старый binary после rollback снова будет накапливать трафик на диске; такой rollback меняет согласованную политику и не является прозрачным.

Артефакт/source snapshot и SHA manifest находятся в `.cache/runtime-session-retention-20261101/` (точный состав фиксируется `manifest.json`). Source snapshot включает только backend-файлы этого этапа и документацию, не frontend. Dist включает скомпилированный backend; зависимости берутся из согласованного package-lock проекта. Для интеграции: сравнить SHA, перенести перечисленные source files в publish worktree без reset/checkout общего workspace, установить baseline dependencies, выполнить tsc и целевые тесты, затем объединить с frontend владельцем. Live restart/backup остаются действиями координатора.

Коммуникация: queue root `01a17eef-84ea-76d2-ba66-412c58b60574` работает (проверен доставленный PROGRESS); координатор затем явно установил обычный collaboration final как разрешённый возврат результата; direct queue v2 frontend отклонён app-server (-32600), поэтому для его активации/согласования явно использован collaboration fallback. Backend UUID из environment metadata: `01a18dfa-7900-7642-a42a-377cc331ecbb`.
