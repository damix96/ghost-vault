# Secret Vault: контракт реализации

Статус: реализация поручена 2026-11-05; готовность не подтверждена. Норматив требований: пользовательская цель ниже. Это следующий этап после принятого MCP-пакета 01987a0, не изменение результата его приёмки.

## Требование пользователя

> хранилище работает на windows + в теории работает на macos + linux. в интерфейсе можно отдельные "ручные" параметры помечать секретными или создавать новые там же и вводить. помимо этого mcp инициировать может ввод секрета. то етсь делается open http://localhost:port/vault-secret/new или подобное. /update?secrets=MY_API_KEY,GBDFL_ADDRESS и тд.

Уточнения по проверке, в порядке поступления:

> проверкой займусь я сам завтра, а вы подготовьте все нужные модули чтобы завтра точечно фиксить что не работает

> я про проверку непосредственно шифрования dpapi, а все что другое не требует моих действий можете тестить сами

> ну еслди можете и pdapi проверить не зависнув на этой проверки часами то проверяйте

Следствие для работ: реализовать все модули и проверить интеграцию самостоятельно. DPAPI — ограниченная по времени реальная проверка на синтетике, без длительного исследования чужих учётных записей/OS policy. Если системная проверка требует участия человека, зафиксировать конкретный непройденный пункт для завтра; остальные проверки продолжать. macOS/Linux providers должны быть реализованы, а не оставлены заглушками; выполнение на этих ОС здесь не заявляется без среды.

## Решения координатора в рамках цели

| Область | Требуемое поведение |
|---|---|
| Семантика | Новый признак секретности ручной записи независим от maskInAi; обычные записи сохраняют прежнее поведение |
| Существующая запись | Человек может пометить её секретной с сохранением имени, токена и точного значения |
| Новая запись | Человек создаёт/вводит секрет в UI, имя соответствует действующим ограничениям |
| Обновление | Секретное значение можно заменить; имя/токен стабилен. В UI старое значение не требуется получать/предзаполнять |
| Хранение | Windows через DPAPI CurrentUser; macOS/Linux через системные providers с явной ошибкой недоступности, без plaintext fallback |
| Канал модели | MCP принимает имена/операцию, не реальные значения; результаты и каталог содержат метаданные/токены, не расшифрованные значения |
| Браузер | MCP инициирует открытие нашей локальной страницы; поддержать прямые маршруты /vault-secret/new и /vault-secret/update?secrets=NAME1,NAME2 либо документированный эквивалент |
| URL | Только имена/идентификаторы запроса; без значений и долгоживущего MCP bearer. GET страницы не изменяет значения |
| Формы | Ввод нескольких имён, понятные успех/ошибка/отмена, ограниченное время жизни запросов; секрет не попадает в localStorage/URL/логи/MCP stdout |
| Совместимость | Устоявшаяся семантика rename/value/request snapshot и обычных переменных сохраняется |
| Миграция | Только synthetic DB в проверках. Живые БД/старые backups не трогать и не удалять. Объяснить, что превращение записи в секрет не стирает внешние исторические копии |
| Поставка | Рабочая сборка, зависимости без локальных sibling runtime paths, инструкции для завтра; registry publish/live rollout не входит |

Версия кандидата следующего этапа: `0.2.0`. Решение координатора: новый защищённый storage/UI/MCP набор отличается от принятого `0.1.0`; version-aware launcher должен распознавать обновление, а не переиспользовать прежний сервер как равную версию. Изменение manifest/lock не публикует пакет, не меняет действующий процесс и не создаёт git tag.

Почему отдельный признак: маскирование в промпте и шифрование хранимых данных решают разные задачи. Цель: пользователь выбирает защищаемые ручные параметры без изменения токенов и работы прокси. Механизм: secret metadata + системный provider + отдельные безопасные проекции API и ввода. Автоматически считать все maskInAi записи DPAPI-секретами нельзя: это меняет действующий контракт без выбора пользователя.

Защита диска не изолирует от любого кода, исполняемого под тем же пользователем и имеющего доступ к системному provider. Наши MCP/API не должны сами возвращать секрет модели. Политики reveal/export/demotion, конкретная схема хранения и методы provider должны быть явно согласованы владельцами и записаны здесь до зависимой реализации; не выдавать предложенную схему за уже согласованную.

## Владение

Workspace: E:/projects/aegis-gate/.cache/mcp-vault-implementation. Реестр: .codex/agent-team.json, next_phase. Координатор/return_thread_id: 01a19d5f-a86a-7330-bae9-fd90bf6bd1e8. Все поручения асинхронны; обязательный возврат через queue, без ожидания/опроса агентов.

| Владелец | UUID | Файлы |
|---|---|---|
| vault_backend | 01a1a2c3-65e7-7032-9c4f-55084d6d3655 | src/vault/**, новые src/security/**, src/types/index.ts, proxy/variable-api.ts, proxy/dashboard-api.ts, proxy/workspace-api.ts; собственные tests |
| mcp_protocol | 01a1a2c3-8d2b-7540-b729-a47057f476d4 | src/mcp/**, новые src/secret-input/**, runtime/service.ts, proxy/server.ts для mounting/diagnostic projection, proxy/runtime-sessions.ts для narrow sanitation integration, собственные tests; central event projection в owned secret-input/protected-events.ts |
| frontend | 01a1891f-d8c1-7cb3-ac1b-bc6a1831eb8e | frontend/**, собственные UI tests/evidence |
| verification | 01a1a302-7a1f-7020-bfc3-fc23493b05b0 | Read-only production; собственные verification-* reports, .cache/secret-vault-qa-* harnesses/evidence/outDir; scoped независимая storage/privacy приёмка |
| coordinator | 01a19d5f-a86a-7330-bae9-fd90bf6bd1e8 | package/lock/scripts, общие docs/контракт/реестр, интеграция/сборки |

Передача runtime/service.ts и proxy/server.ts владельцу MCP на этот этап — решение координатора; прежняя lifecycle-задача закончена. Общие типы DTO фиксирует backend после прямого согласования с frontend/MCP; input contract — MCP после прямого согласования с frontend/backend. Нормативный документ меняет координатор по сообщённым решениям. Новые зависимости устанавливает координатор в проверенный package root; роль сообщает exact package/version/назначение. Изолированные сборки каждой роли в своём .cache/*-dist; shared dist/public — только координатор.

## Принятые решения: dpapi-provider-install

2026-11-05, решение координатора по запросу vault_backend. Windows provider: exact runtime dependency `@primno/dpapi@2.0.1`, MIT, prebuilt N-API x64/arm64. [Первичный источник](https://github.com/primno/dpapi); API CurrentUser, x64 проверен владельцем на Node 22.13/26.8.2, arm64 здесь не проверялся. Координатор установил зависимость с явным source prefix и ignore-scripts; shared-package synthetic CurrentUser roundtrip прошёл Node 26.8.2. Результаты владельца (corruption/entropy/restart/hidden child/cross-runtime) пока являются сообщёнными доказательствами; точный отчёт/команды включаются в итоговую приёмку.

Причина выбора: готовый бинарный API позволяет избежать компилятора у потребителя и процесса PowerShell на каждую операцию; собственная криптография не нужна. macOS/Linux должны выбирать свой provider, не пытаться загрузить Windows native binding как обязательный startup шаг.

Согласовано для этого этапа: protected list/export дают метаданные без исходного значения; связанное protected archive тоже редактируется как metadata-only projection. Обычные записи сохраняют прежние export/DTO возможности. Reveal и снятие защиты не добавляются в этот этап; изменение secret value/rename/delete доступны по существующим и согласованным безопасным путям. Отсутствие нового reveal не заменяет проверку прочих API на раскрытие.

Уточнение по `protected-read-policy`: прежнее требование полного экспорта сохраняется для обычных данных. Для нового, явно выбранного пользователем protected-класса экспорт сохраняет запись/имя/разрешённые метаданные и явно обозначает отсутствие значения (маркер/summary согласуют backend/frontend); не молча удалять запись и не называть такой файл полной резервной копией защищённых значений. UI экспорта сообщает эту границу. Значения protected-записей и их архивов через export не возвращаются; отдельного human reveal/export grant в этом этапе нет. Это решение координатора о поведении нового класса, не дословное дополнительное требование пользователя.

Внешние session/history/hooks-context/telemetry проекции также скрывают protected originals/формы, обычный мониторинг сохраняет прежние данные. Внутренний processing/hook context и конечный proxy поток остаются в доверенном локальном процессе; восстановление значения для локального исполнителя необходимо по назначению GhostVault. Новые меры не обещают изоляцию от same-user arbitrary execution.

При защите существующей ручной записи текущая запись и все её архивы под соответствующим ключом защищаются атомарно; immutable snapshots/формы, содержащие тот же архивный оригинал, не могут оставаться обходным plaintext источником. Метаданные alias/identity и точность восстановления не меняются. Ошибка provider/SQL не оставляет частично защищённую логическую группу.

Нужно проверить действующую DB и WAL после штатного успешного mark/update на synthetic canary; использовать возможности SQLite для удаления принадлежащих записи старых bytes (например, secure_delete/checkpoint) там, где это применимо. Не обещать физическое стирание на SSD, во внешних backups, чужих копиях или исторических файловых snapshots. Если stale bytes текущего DB/WAL не удаётся исключить без изменения lifecycle, предъявить конкретное ограничение и согласовать механизм; не объявлять всю текущую DB защищённой только по отсутствию открытого SELECT.

Дополнительные telemetry-файлы передаются после конкретного trace/списка владельца. backend уже владеет dashboard/variable/workspace API; server/runtime mounting остаются MCP. Redaction не должна менять реальные payload потока proxy, который по назначению восстанавливает секрет для локального исполнителя.

## Принятые решения: system-keyring-dependency

По запросу vault_backend координатор установил exact runtime dependency `@napi-rs/keyring@2.1.2` с явным source prefix/ignore-scripts. [Первичный источник](https://github.com/Brooooooklyn/keyring-node). Native exports загружаются в Windows Node 26.8.2; это проверка установленного модуля, не проверка macOS/Linux хранилищ и не запись credentials Windows.

macOS provider использует Keychain; Linux явно выбирает `{linux:{store:'secret-service'}}`. Автоматический fallback библиотеки на непостоянный kernel keyring не допускается: ключ для восстановления DB должен переживать restart. Нужна работающая пользовательская Secret Service/D-Bus среда; недоступность/блокировка возвращает ошибку, а не plaintext или другой backend. Windows сохраняет прямой DPAPI CurrentUser, соответствующие bindings загружаются по выбранной платформе.

Согласована схема для macOS/Linux: стандартный Node `crypto` AES-256-GCM, случайный 256-bit ключ только в OS store, новый случайный 96-bit nonce на шифрование, проверяемый authentication tag. Envelope/provider identity должны валидироваться; отсутствие ключа для уже имеющегося ciphertext не исправляется тихой генерацией нового. Идентификатор vault для OS account сохраняется долговечно; в DB нет открытого master key. Привязка к записи не должна ломать rename: использовать стабильную identity либо явно перепаковывать соответствующий authenticated context.

Согласована предложенная additive SQLite схема `is_secret`, `protected_value`, `write_revision` в active/archive tables с default для прежних обычных записей и запретом непустого `real_value` у защищённой записи. Триггер должен предотвращать запись открытого original старым writer. Это не обещание полной совместимости downgrade: конкретное старое чтение/запись проверяются на fixture или честно отмечаются как неподдержанные. Связанные archive snapshots/формы остаются частью ранее согласованной защиты; новые columns сами по себе не закрывают такие копии.

Причина: OS store обеспечивает хранение ключа для произвольных объёмов значений, а встроенный AES-GCM обеспечивает стандартное authenticated encryption без собственных примитивов. Выбран постоянный Linux backend; временный kernel-only ключ потерял бы доступ к DB после reboot. Обычный Vault должен запускаться без доступного secret provider; защищённые операции и чтение защищённых данных не переходят к plaintext при ошибке.

## Принятые решения: protected-diagnostics-scope

Координатор разрешает предложенную backend нормализацию известных raw/encoded вхождений защищаемого значения в существующих `transactions.prompt_text`, `masked_prompt`, `model_response`, `intercepted_secrets`, `url`, `target_url`: заменить их соответствующими aliases в той же транзакции, которая защищает manual/current и связанные архивы. Сохранять строки, IDs, timestamps и прочие метаданные. Это намеренное изменение содержащих секрет диагностических строк, не полное сохранение их прежнего raw текста; UI защиты/экспорта сообщает эту границу. Сами архивные оригиналы сохраняются зашифрованными согласно принятому контракту. Обрабатываются только известные представления выбранных protected originals; blanket rewrite settings/hooks, удаление DB/backup и произвольная очистка всей истории не разрешены.

Почему: одна запись может содержаться одновременно в vault и прежней диагностике, поэтому одного encrypted column недостаточно для защиты текущей DB. Цель: исключить принадлежащие выбранному секрету открытые диагностические копии, сохранив историю событий. Механизм: точная known-forms подстановка в ограниченных diagnostic columns и шифрование полных vault/archive values. Безусловное удаление всей истории шире цели, а сохранение открытых известных копий противоречит выбранной защите.

`vault.redactProtected`/эквивалентный typed projector принадлежит backend; должен учитывать прежние protected values, пока их копии могут оставаться в runtime диагностике после update/delete. Сам projector не изменяет live proxy payload/request snapshots. Для интеграции RAM/session/lastCall/event boundaries координатор передаёт MCP владельцу narrow `src/proxy/runtime-sessions.ts` в дополнение к уже переданному `server.ts`. Backend/MCP напрямую согласуют mapper signature и точки вызова; ни один не редактирует одновременно чужой файл. Внешняя диагностика получает безопасную проекцию, plaintext не должен накапливаться в новых monitoring snapshots. Trusted hook execution отдельно от диагностической выдачи; произвольный пользовательский код остаётся same-user capability.

Для SQLite использовать `secure_delete=ON` и проверенный `wal_checkpoint(TRUNCATE)` по плану backend. Ошибка checkpoint после успешного commit НЕ означает rollback: нельзя восстанавливать plaintext, сообщать «ничего не сохранено» или автоматически повторно писать секрет. Результат должен явно различать committed encryption и pending/failed hygiene; exact safe result/error fields backend согласует напрямую с frontend/MCP. При ограничении busy-reader сохранить discovery/DB и описать дальнейший безопасный retry; не удерживать запрос бесконечно и не закрывать чужие соединения. Fixture проверяет успешный canary scan и отдельную ветку busy после commit.

## Центральная фильтрация событий: telemetry-projection-extension

Текущее решение MCP, принято coordinator: owned `src/secret-input/protected-events.ts` расширяет публичный `EventBroadcaster`, сохраняет base broadcast и применяет `vault.redactProtected` перед публикацией. `server.ts` передаёт один общий экземпляр всем producers, включая dashboard и `StreamRelay`. `src/telemetry/event-broadcaster.ts` и его public API не меняются. Ранее выданная narrow передача этого файла (queue01a1a82c-20a5-7021-9347-1ae95f394388) не понадобилась; исходный extension request superseded, не blocker и не поручение менять base class. `runtime-sessions.ts` остаётся в переданной MCP области.

Причина: `stream-relay.ts` публикует восстановленный preview через `stream_progress.details.text`; фильтрации только прямых server вызовов недостаточно. Цель: единая безопасная внешняя диагностика при сохранении фактических upstream/client payload и trusted hook arguments. Механизм: общий central adapter перед сериализацией, без правок producers и параллельного владения base class. Проверить полные/encoded/retired формы, snapshots до mark и preview/chunk границы; diagnostic truncation не должна предшествовать необходимой redaction.

Projection не мутирует source event/context. При ошибке callback событие безопасно пропускается без original fallback и без исключения в producer/proxy. Root обнаружил synthetic exception escape; owner исправил, root Node22.13 projection test и actual SSE injected-error test PASS. Этот `telemetry-projection-isolation` defect закрыт отдельно от ownership request. Штатная actual SSE проверка отдельно PASS: protected/retired формы скрыты, ordinary monitoring и intended final client payload сохранены. Передача `stream-relay.ts` в рамках этого этапа не запрашивается и не выдаётся.

Согласовано backend/MCP в `protected-preview-boundary`, записано coordinator по `record-preview-contract`: synchronous `vault.redactProtectedPreview(text:string):string` использует те же runtime-retained raw/encoded current/archive/retired формы. Аргумент — накопленный live preview, mapper stateless между вызовами, без per-event/session buffers. Полные совпадения маскируются; выбирается самый длинный неоднозначный terminal proper-prefix, который скрывается, пока следующий накопленный текст не завершит совпадение или не покажет расхождение. Полностью выданные alias tokens сохраняются с отдельным enclosing-value уточнением ниже. Это не гарантия сокрытия произвольных отдельно вырезанных fragments или удаления уже доставленного текста; preview-эвристика не переносится на complete records/public identifiers.

Backend implementation decision: cached prefix helper с линейной обработкой повторяющихся входов вместо квадратичного перебора suffix/prefix на значениях до64 KiB. Cache производен от тех же remembered forms, не является состоянием событий/сессий. Цель — bounded diagnostic work без нового provider/dependency/encryption policy. Реальную сложность и поведение длинного повторяющегося input подтверждают focused tests; одна декларация реализации не является performance PASS. Сам live-preview контракт не меняет generic final projection/proxy/hook payload; отдельный найденный full-value/outbound пропуск ниже требует собственного исправления точного маскирования.

`test-protected-preview` входит в `test:secret-storage`/`test:secrets`: exhaustive small-input oracle, 64 KiB repeated-prefix/divergence, overlapping full/prefix forms, raw/encoded splits и current/archive/retired lifetime. Это in-memory injected-provider fixture, не новое OS encryption доказательство. Owner Node22/26 и independent QA Node22 подтвердили исходную область на сохранённых snapshots; позднее добавленный composite-token regression и общая privacy приёмка остаются отдельно. Cache failure tables требуют O(sum form lengths) дополнительной памяти по реализации backend; один large-input PASS сам по себе не является универсальным benchmark.

Причина: накопленный preview может заканчиваться неполным началом известного секрета, которое full-form replacement ещё не видит. Цель: безопасная диагностика без изменения фактического proxy ответа. Механизм MCP: `ProtectedEvents(project, preview)` вызывает optional второй callback только для копии `stream_progress.details.text`, перед generic projector. Ошибка любого callback/publication пропускает событие без raw fallback/log/producer throw; source event и upstream/client payload не меняются. Base broadcaster и stream-relay не редактируются. Произвольное удержание всех событий не заменяет эту ограниченную live-text проекцию.

Source-приёмка закрыта независимым `verification-composite-retest.md/json`: прежние failing actual history/SSE/outbound fixtures и новая composite matrix проходят на Node22.13; root сверил шесть recorded production hashes, изменений нет. `test-secret-input-preview` покрывает cuts всех raw/encoded/retired форм, ordinary divergence и aliases; `test-secret-input-preview-stream` — actual network SSE, restored alias длиннее existing output window, наблюдение diagnostic progress до upstream DONE, точный final client output/tokenized upstream/ordinary lead. Оба входят в `test:secrets`. Final artifact reconciliation остаётся отдельно от source-приёмки.

Дополнительный QA case `qa-preview-token-containing-value` закрыт: известное защищённое значение содержит alias-shaped текст внутри более длинного original. Сохранность отдельного полного публичного alias не разрешает пропускать окружающий известный секрет или его неоднозначный preview suffix. Исправление backend сохраняет совпадения, целиком находящиеся внутри публичного token, но маскирует более длинный известный secret, содержащий token. Generic complete-form projection также входит в affected scope. Root fresh Node22.13 full/preview/actual SSE, установленный raw/URL proxy и независимые QA counterexamples проходят. Первоначальные failing snapshots сохранены.

Root Node22.13 дополнительно воспроизвёл `preview-token-containing-upstream`: enhanced actual network fixture доходит до точного final client content, но `upstreamBody.includes(secret)` остаётся true. Поэтому affected acceptance включает также outbound masking того же known protected value; сохранность отдельных aliases не разрешает отправлять окружающий original провайдеру. Следующие diagnostic assertions в этом failing run не достигнуты. Evidence `.codex/tasks/secret-vault-20261105/preview-contract-review.json`; владельцам/QA передан точный test snapshot без source изменений координатором.

Текущий outbound механизм сопоставляет manual/automatic формы с исходным текстом, сохраняет manual-first priority и не сканирует повторно уже выданные aliases. Это предотвращает каскадную замену generated token, сохраняя точный обратный roundtrip composite raw/encoded values. `test-masking-composite` добавлен в общий `test:secret-storage`/`test:secrets` рядом с preview/Unicode/NUL; всего25 named secret tests. Root combined source groups и installed consumer tests PASS. Старый `dbSchemaStable` regression ожидал только семь legacy columns; owner обновил точный список до согласованных `is_secret,protected_value,write_revision`, replacement/collision/reload assertions сохранены. Независимая QA и exact artifact comparison остаются самостоятельными критериями завершения.

## Проекция контекста замен до обрезки

Интеграция с `main`, 2026-11-05: backend/MCP согласовали внутренний synchronous `VaultStore.projectProtectedText(text)`:

```ts
{
  text: string;
  ranges: Array<{ start: number; end: number; replacement: string }>;
}
```

`ranges` — отсортированные непересекающиеся half-open диапазоны UTF16 исходного полного текста; только фактически заменённые полные формы. Используются тот же matcher, приоритеты containment и runtime-retained current/archive/retired raw/encoded формы, что в полной protected redaction. Результат содержит безопасный текст и replacement aliases, без SQL/provider вызовов или записи. Preview withholding сюда не переносится.

Причина: `ResponseChangeEvidence` вырезает96-character context; обрезка до redaction может оставить суффикс длинного известного секрета, который уже не совпадает с полной формой. Helper сначала проецирует полные before/after, затем пересчитывает границы целевого совпадения через исходные диапазоны и вырезает безопасный контекст. Граница внутри private range расширяется до границы целого replacement alias; `item.value` равен точному выделенному срезу безопасного after. Исходные event key/alias сохраняются. Без замен контексты и индексы остаются прежними.

Это проекция диагностических копий: фактические restoration/client/hook payload не меняются. Ошибка projector пропускает capture без raw fallback и без отказа proxy ответа. Простое маскирование уже обрезанного текста или удаление всех обычных контекстов не обеспечивает требуемую приватность и совместимость. Контракт согласован; HTTP/SSE integration acceptance этого исправления фиксируется отдельно от прежней приёмки0.2.0.

Уточнение после независимого `QA-DELIVERY-COMPOSITE-CONTEXT`: protected before span может содержать публичный token, который restoration раскрывает внутри него. Изменённая after-строка уже не обязана совпадать с известной полной формой. Сведения о таком before span должны переноситься через фактические `RestorationMatch` в after diagnostic copy и объединяться с прямыми after protected ranges до обрезки. Решение координатора по overlap: вложенные диапазоны сохраняют alias внешнего диапазона; одинаковые границы предпочитают точный after alias; пересекающиеся без вложения диапазоны объединяются с нейтральной пометкой `[protected]`, поскольку у union нет одного достоверного canonical alias. Соседний обычный контекст, согласованность индексов/value и исходные event metadata сохраняются. Фактический payload не меняется; последующая generic projection не должна нарушать безопасную проекцию. Этот policy согласован для реализации; закрытие найденного дефекта требует отдельной проверки, включая полный public diagnostic body.

## Диагностика неизменного request snapshot

Прямое соглашение backend/MCP `snapshot-diagnostics-contract`: внутренний `snapshot().diagnostics` предоставляет `redact<T>(value:T):T`, `project(text:string):ProtectedTextProjection`, `preview(text:string):string`. Используются original формы и их точные one-pass derived формы с поддерживаемыми encodings, вычисленные по неизменной inbound map этого запроса. Pull refresh при изменении protected remember учитывает последующую защиту/update/delete. Global derived registry, новые aliases, SQL/provider writes и изменение фактического payload не допускаются. Это согласованный API; его readiness и сквозная приёмка подтверждаются отдельно.

Причина: restoration может раскрыть PUBLIC token внутри известного protected composite, после чего новый текст перестаёт совпадать с исходной полной формой. Scope ограничен точными производными данного snapshot, без произвольного fuzzy fragment matching. MCP привязывает projector к request, полному diagnostic record и раннему stream preview. После завершения запроса latest session record сохраняет частный projector; replacement/eviction/clear освобождают его. Перекрывающиеся старые запросы используют собственную inbound map. Приватные capture provenance для повторной проекции evidence при поздней защите учитываются в существующем RAM budget и не сериализуются в public DTO/export/logs.

Дополнение backend/MCP `snapshot-diagnostics-retention-cost`: приватный `diagnostics.estimatedBytes():number` возвращает конечную неотрицательную оценку удерживаемых snapshot данных. Cached high-water учитывает local derived payload/alias refs, map/regex/potential prefix reserve и immutable inbound bookkeeping; исходный global value payload остаётся общим и повторно не учитывается как собственная копия. Оценка ограничена `Number.MAX_SAFE_INTEGER`, не является измерением heap или жёсткой границей памяти процесса. MCP прибавляет её к capture provenance и пересчитывает удержание при росте оценки, даже когда public text не изменился. Значения и этот внутренний API не добавляются в public DTO; отдельные tests проверяют generation/cache/dedup/growth/late mark и eviction integration.

Сырые wire/sample diagnostics могут разделять известное значение границами SSE-кадров. Если безопасная точная проекция raw недоступна, согласован фиксированный явный marker скрытия только для raw диагностического поля, требующего protected projection; безопасные semantic body/context/evidence/metadata сохраняются. Живой неоднозначный protected prefix также обрабатывается диагностическим preview. Само наличие protected записи не разрешает скрывать все raw responses: ordinary wire сохраняется. Actual client/hook bytes не меняются, скрытое raw не выдаётся за точную копию провода. Для новой public DTO shape требуется прямое согласование с frontend; строковый marker сохраняет существующую shape.

Точный marker raw omission: `[protected raw response omitted]`, в существующем raw string field. Trigger/routing принадлежит MCP: известная protected restoration либо request-local semantic/provenance projection защищённого original/derived содержимого, до потери этих сведений при безопасном отображении. Backend factory остаётся protocol-agnostic; SSE frame parser/fuzzy fragment matcher туда не добавляется. Сигнал и lifetime согласуются владельцами напрямую; корректная последующая проекция retained record обязательна.

## Согласованная storage boundary для intake

Источник: последнее прямое соглашение backend/MCP, подтверждённое backend в `storage-contract-source-correction` 2026-11-05. Заменяет начальный key/revision proposal, ранее записанный по `telemetry-projection-extension`; старую shape не восстанавливать. Согласованный public adapter interface: `ProtectedInputVault` в `ghostvault/src/secret-input/storage.ts`.

```ts
captureSecretTargets(names: string[]): Array<{
  name: string;
  expectedRevision: string | null;
}>;
commitProtectedManualBatch(input: {
  requestId: string;
  entries: Array<{
    name: string;
    value: string;
    expectedRevision: string | null;
    description?: string;
  }>;
}): {
  requestId: string;
  variables: Array<{ name: string; token: string }>;
  notice?: { code: 'SECRET_STORAGE_CLEANUP_PENDING'; message: string };
};
```

Операция synchronous all-or-none. Private write revision хранится долговечно и меняется при мутации записи; публичный catalog revision её не заменяет. `expectedRevision:null` означает create-only, существующая запись требует точного совпадения revision. Проверка выполняется внутри `BEGIN IMMEDIATE` до allocations/writes; ошибка revision — 409 `SECRET_WRITE_CONFLICT`, alias — 409 `ALIAS_CONFLICT`, invalid input — 400 `INVALID_SECRET_INPUT`; provider errors по согласованному 503/422 контракту. Store batch ≤32 entries, ≤64 KiB UTF-8/value, ≤1 MiB total; HTTP дополнительно ≤256 KiB. Значения не trim/normalize.

Уточнение `qa-unpaired-utf16`, принято coordinator по backend correction: значения на границе variable representations должны быть well-formed UTF-16. Lone surrogate отклоняется существующим `400 INVALID_SECRET_INPUT` до provider/SQL/alias mutations; batch целиком остаётся неизменной. Правило общее для ordinary/protected admin writes и protected batch; intake сохраняет согласованный safe error mapping. Корректные surrogate pairs, combining marks, literal U+FFFD, NUL, CRLF и пробелы не нормализуются. Причина: `encodeURIComponent` не кодирует lone surrogate и ранее давал URIError/500; минимальная явная validation сохраняет точность значений и atomicity. Silent replacement и новый собственный URL codec не допускаются; точный roundtrip произвольных UTF-16 в primitive DPAPI envelope не расширяет допустимый domain переменной. Existing data не переписываются этой проверкой. Source regression: `src/test-protected-unicode.ts`; native Windows Node22.13/26.8.2 owner PASS, root Node22.13 PASS.

Уточнение `qa-nul-protection-loss` / `qa-nul-diagnostic-plaintext`: native Node22 SQLite TEXT getter может обрезать строку на NUL при полных сохранённых bytes. Цель — защищать точное current/archive значение и санировать также diagnostic suffix после NUL. Backend `SqliteText` читает выбранные TEXT columns как BLOB и декодирует standard fatal `TextDecoder` по фактическому `PRAGMA encoding`, с сохранением BOM. Применение: current/archive/legacy-auto reads, прямое чтение защищаемых архивов и разрешённые diagnostic columns. Не меняются схема, сохранённые bytes, unrelated settings/hooks/routes readers; invalid byte sequences отклоняются до conversion. Запрет нового NUL input не исправил бы уже сохранённые строки, silent replacement нарушил бы exact semantics. Ранее потерянный suffix не восстанавливается. Owner `test-protected-nul` и независимый QA Node22.13 snapshot подтверждают current/archive27/27, отсутствие known plaintext после NUL, rollback/reader/reopen/hygiene; encoding fixtures UTF8/UTF16LE/UTF16BE не объявляются полной межплатформенной DB приёмкой.

`requestId` возвращается в receipt, не является durable journal/idempotency key хранилища. Dedup/status/TTL/cancel принадлежат intake runtime; повтор committed batch не исполняется автоматически. Receipt metadata-only: проверяются requestId, полный набор names и canonical tokens; `value` не переносится в результат.

Backend отдельно предоставляет внутренние admin helpers `captureProtectedTargets` с `{key,revision}` и `commitProtectedSecrets`. Они не заменяют `captureSecretTargets` и не являются второй допустимой формой intake API. Их наличие не добавляет dashboard UI обязательную ревизию.

`notice` сохраняется при преобразовании receipt в RequestView/HTTP/MCP; encrypted commit остаётся `completed`. Нельзя отбросить notice, сведя receipt только к `variables`, либо превратить hygiene pending в `failed`/автоматический replay. Точный manager transport согласуется MCP/frontend в их общей schema, семантика задана `storage-cleanup-result`. Первоначальная потеря notice в mapping `receipt.variables` выделена в проверку стыка: нужен actual committed notice в HTTP/MCP/UI, и отдельная актуальная vault retention projection после cleanup по разделу ниже. Source compilation и передача одного receipt сами по себе не завершают эту приёмку.

Причина исправления: первоначальная shape устарела после прямого соглашения владельцев, а bare-array projection теряет результат cleanup. Цель: одна совместимая intake boundary и честный postcommit исход. Механизм: typed request receipt с optional notice, отдельные admin helpers и тест цепочки adapter → HTTP/status/MCP/UI; успешная компиляция сама по себе не доказывает передачу notice.

## Принятое postcommit поведение: storage-cleanup-result

Решение coordinator по предложению backend 2026-11-05: успешный encrypted COMMIT остаётся успешным. Если последующий secure-delete/VACUUM/checked checkpoint hygiene шаг не завершился, mutation возвращает обычный safe success result с опциональным `notice: {code:'SECRET_STORAGE_CLEANUP_PENDING', message:string}`. Message фиксированный безопасный текст без exception/provider output. Значения/ключи/ciphertext в notice отсутствуют. Это не HTTP 503 failed-commit и не основание автоматически отправлять секрет повторно.

Пример для single-entry admin mutation: `{success:true,secret:SecretPublicEntry,notice?:{code,message}}`. Для batch/MCP согласованный receipt `{requestId,variables,notice?}` сохраняет committed tokens/успешное terminal state плюс notice; mapping в manager/view должен сохранить предупреждение. Обёртка не должна превращать committed-with-notice в `failed` и не должна терять предупреждение при формировании metadata-only ответа.

`retention.cleanupPending:boolean` отражает vault-wide состояние, доступное UI после повторного чтения. Состояние pending сохраняется долговечно вместе с защищаемой транзакцией до hygiene; очищается лишь после подтверждённого завершения. Crash между commit и cleanup не должен превращать pending в ложное clean. При следующей успешной записи pending hygiene повторяется; никаких бесконечных retry/polling, rollback в plaintext, удаления чужих backups или закрытия внешнего reader. Необязательный повтор при startup допустим только после существующего DB ownership и без ослабления shutdown/lifecycle.

Frontend показывает «сохранено» и отдельное предупреждение об ещё не подтверждённой очистке текущей базы; не сообщает полный провал сохранения/отсутствие изменений и не обещает физическое стирание внешних копий. После успешного retry warning исчезает при refresh. Обычные precommit/provider/SQL ошибки сохраняют прежнюю failure семантику.

Проверка: удерживаемый внешний reader вызывает hygiene pending после committed encryption; mutation/list/retention/MCP/UI не врут об исходе; release reader + следующая запись успешно очищают DB/WAL, flag меняется на false; после restart pending не теряется. Файлы при ошибке не удаляются. Для обычных последующих protected writes без legacy plaintext/pending не выполнять ненужную полную VACUUM; выбранную необходимость и границу времени backend фиксирует в отчёте.

## Согласованный DTO и защита существующей записи

Источник: frontend `frontend-dto-agreement`, прямое соглашение frontend/backend по `secret-dto-endpoints`; 2026-11-05. Это принятые части публичного API, не утверждение завершённой реализации.

| Контракт | Согласованное поведение |
|---|---|
| `SecretPublicEntry.isSecret` | Обязательный boolean, независимый от `maskInAi` |
| Protected DTO | `realValue`, `variants`, `representations` отсутствуют; не null/placeholder с доступным оригиналом |
| Protected export | Metadata rows сохраняются с `valueOmitted:true`; originals/variants/cipher отсутствуют, ordinary schema сохраняется. Такой export не является полной восстанавливаемой резервной копией секретов |
| `PATCH /api/vault/secret/:key` с `{isSecret:true}` | Защитить точное текущее значение существующей ручной записи; имя/основной токен/значение сохраняются |
| Тот же PATCH с `{name}` | Прежний rename-контракт сохраняется |
| Reveal/demotion | Не предоставляются в текущем этапе |
| Недоступное secret storage | HTTP 503, безопасный code `SECRET_STORAGE_UNAVAILABLE` |
| Ошибка расшифрования | HTTP 422, безопасный code `SECRET_DECRYPTION_FAILED` |

Точный payload не включается в diagnostic error; secret values/encoded forms не возвращаются через эту проекцию. DTO при успешном protect/rename должен оставаться безопасным; остальные agreed metadata поля сохраняются. Внутреннее представление для прокси не равно PublicEntry и продолжает восстанавливать текущий секрет по токену.

Уточнение `protected-post-contract` ниже закрывает protected POST create/update existence, provider-unsupported mapping и смешанный PATCH. До его получения `operation:create|update` являлся предложением; с этого уточнения он принят прямым соглашением backend/frontend. Недоступное хранилище нельзя интерпретировать как отсутствие записи.

Причина: защищённый editor не должен получать прежний оригинал, а создание и обновление имеют разные последствия при гонке. Цель: сохранение точного выбранного значения/токена без скрытого раскрытия или перезаписи другой записи. Механизм: явный флаг, редактированная проекция и отдельные операции; скрыть raw field только CSS или делать неоговорённый upsert недостаточно.

### Protected POST: protected-post-contract

Источник: backend принял предложение frontend напрямую и сообщил coordinator 2026-11-05. Сообщение подтверждает контракт; часть POST implementation ещё выполнялась, поэтому готовность не следует из согласования.

```ts
POST /api/vault/secret
{ key: string, realValue: string, description?: string,
  isSecret: true, operation: 'create' | 'update' }
```

| Условие | Результат |
|---|---|
| `create`, имя отсутствует | Создать защищённую ручную запись |
| `create`, имя занято | Fixed/manual запись — 409 `SECRET_ALREADY_EXISTS`; automatic/namespace/alias конфликт — 409 `ALIAS_CONFLICT` |
| `update`, fixed/manual запись существует | Заменить значение, сохранить основной токен/имя и protection |
| `update`, fixed/manual запись отсутствует, в том числе только auto | 404 `VARIABLE_NOT_FOUND`; не создавать/не promote автоматически |
| Новый UI protected POST | Явная operation; `expectedRevision` и DTO revision не требуются. Dashboard заменяет текущее сохранённое значение, без гарантии stale-write CAS |
| Intake batch | Сохраняет отдельный captured-revision CAS и all-or-none semantics |
| Прежний POST без `isSecret` | Прежний upsert и сохранение существующей protection, без silent demotion |
| `isSecret:false` для уже защищённой записи | 409 `SECRET_DEMOTION_UNSUPPORTED` |
| PATCH одновременно `{name,isSecret}` | 400 `INVALID_SECRET_INPUT`, не игнорировать одно из действий |
| Неподдерживаемый/недоступный provider | 503 `SECRET_STORAGE_UNAVAILABLE` |

Success использует принятую безопасную single-entry форму `{success:true,secret:SecretPublicEntry,notice?}`; отсутствие оригинала в protected DTO и postcommit cleanup notice сохраняются. Описание/значение не включать в error message. Эта existence граница предотвращает скрытое превращение create в overwrite и update в recreate, сохраняя прежний opt-in-compatible маршрут для старых обычных клиентов.

### Закрытое согласование: protected-post-existence-agreed

Прямое соглашение backend/frontend, подтверждено frontend 2026-11-05: dashboard protected POST использует указанный выше `operation:create|update` без обязательной ревизии. Frontend уточнил, что его `protected-post-revision-agreement` с required `expectedRevision`, DTO `revision:string` и proposed missing400/stale409 `REVISION_CONFLICT` был предложением; оно superseded, не являлось требованием пользователя. Это закрывает coordinator request `reconcile-protected-editor-revision` и согласуется с backend `protected-post-contract`.

Dashboard объясняет замену текущего сохранённого значения; create проверяет отсутствие, update — наличие fixed/manual записи. CAS на всё время открытой dashboard-формы не обещается. Внутренняя server transaction race защита сохраняется: сервер захватывает текущую persisted revision перед atomic batch, конфликт между capture и transaction может вернуть 409 `SECRET_WRITE_CONFLICT`. После неизвестного исхода HTTP допустима GET-only reconciliation без автоматического повторного POST. Intake отдельно сохраняет captured-revision CAS, атомарность всей пачки и свои ошибки конфликта.

Причина: обе стороны выбрали совместимый existence-контракт для dashboard вместо ранее предложенного дополнительного DTO field. Цель: editor не блокируется отсутствующей ревизией и не заявляет несуществующую защиту от lost update. Механизм: точные create/update условия и объяснение замены текущего значения; более сильная intake гарантия не переносится на dashboard без отдельного соглашения. Согласование не заменяет проверку реальных browser/API операций.

Protected export `valueOmitted:true` остаётся принятым правилом. Postcommit success+notice и durable `retention.cleanupPending` утверждены в `storage-cleanup-result`; точные adapter поля и общий сценарий проверяются владельцами.

## Граница сложности ввода

Этот раздел задаёт принятую простую lifecycle-модель; согласованные ниже HTTP части уточняют её.

Решение координатора после просмотра исходного design-only предложения MCP: реализация использует существующий runtime/listener и маршруты `/vault-secret/*`; отдельный ephemeral listener/origin не требуется. Приложение работает в существующей границе доверия локального пользователя; изоляция от произвольного same-origin/user кода не заявляется. Нужны отдельная ограниченная form authority, Origin/Host/content-type проверки, no-store и отсутствие значений в control/MCP канале; второй сервер и новое lifecycle-согласование не являются блокирующей зависимостью.

Request/status/cancel состояние допустимо хранить в RAM с TTL. После restart старый request недоступен/прерван, автоматического повторного commit не происходит; подтверждение через текущую UI/catalog metadata и новый человеческий ввод при необходимости. Внутри живого процесса повтор submit/request не должен создавать второй commit или повторное окно. Durable request journal/24h receipts/exactly-once recovery не обязательны для пользовательской цели и не должны блокировать этот этап. Сами защищённые значения сохраняются долговечно и batch атомарно; потеря ephemeral request не означает потерю сохранённых значений.

Механизм проверки конкурентных изменений владельцы выбирают минимальный совместимый; публичный catalog revision намеренно независим от secret value, не использовать его для CAS value. Устаревший проектный LEGACY_MIGRATION_REQUIRED не является запретом на обязательную защиту существующей обычной записи: этот переход входит в новую цель и approved storage policy.

Причина: новая цель требует работающих модулей/локальных форм, а не нового распределённого протокола восстановления. Цель: завершить весь запрос без неоговорённых гарантий. Механизм: единый runtime, атомарный storage, ограниченное ephemeral состояние и честные ошибки; усложнение допустимо только для конкретного неустранимого дефекта в этих требованиях.

## Согласованный intake HTTP/UI

Источник: прямое соглашение MCP/frontend `intake-http-ui-contract`, сообщения `frontend-intake-route-agreement`, `frontend-intake-wire-agreed` и уточнения `record-intake-http-agreement`, `intake-wire-refined` 2026-11-05. Exact delivery evidence: `.codex/tasks/secret-vault-20261105/mcp-intake-result.md`, frontend reply queue `01a1a82b-bb27-7ad0-982e-60a4d574e5ca`. Этот раздел заменяет прежние незакрытые вопросы о query UUID, URI и ordinary update. Готовность production mounting и полного сценария из соглашения не следует.

Browser routes на существующем listener: `/vault-secret/new` и `/vault-secret/update?secrets=NAME1,NAME2,...`. MCP передаёт `request=<UUID>` в query страницы; допустимы имена `secrets`, значения и credentials в URL отсутствуют. GET страницы не изменяет Vault. Полные DTO schemas принадлежат MCP в `ghostvault/src/secret-input/schema.ts`.

| Метод и полный маршрут | JSON запроса | Успех HTTP 200 |
|---|---|---|
| `POST /api/secret-input/session` | `{requestId?:string}` | `{formToken,expiresAt,request?}` |
| `POST /api/secret-input/requests` | `{operation:'new'\|'update',names:string[],idempotencyKey:string}` | `RequestView` |
| `GET /api/secret-input/requests/:id` | Нет body | `RequestView` |
| `POST /api/secret-input/requests/:id/submit` | `{submissionId:string,values:[{name:string,value:string}]}` | `RequestView` |
| `POST /api/secret-input/requests/:id/cancel` | `{}` | `RequestView` |

`RequestView` содержит `requestId, operation, names, state, expiresAt, launch`, опциональные `result:[{name,token}]`, `error:{code,message}` и `notice:{code:'SECRET_STORAGE_CLEANUP_PENDING',message:string}`. Состояния: `awaiting_input`, `committing`, `completed`, `cancelled`, `expired`, `failed`. Success create/status/submit/cancel — непосредственный view без `{success,request}` обёртки. Error — `{error:{code,message}}`, безопасный allowlisted code/message; terminal submit storage/provider failure дополнительно содержит `request` со state `failed`. Значения/encoded forms/form capability отсутствуют в control/MCP results.

| Authority | Требование |
|---|---|
| Bootstrap | Same-origin POST с точным `Origin`, JSON и `x-ghostvault-input:1`; отдельная authority от MCP Bearer |
| Остальные API routes | `Authorization: Intake <formToken>`; memory-only токен связан ровно с одним request |
| Все writes | Точный same-origin `Origin`, JSON, `x-ghostvault-input:1`; actual Host/loopback peer проверки |
| Authenticated GET | Отсутствующий Origin разрешён; переданный чужой Origin отклоняется. Actual Host/loopback peer и Intake token обязательны; переданный `Sec-Fetch-Site` только `same-origin` или `none` |
| Browser fetch | `mode:'cors'`, `credentials:'omit'`, `redirect:'error'`; custom header/JSON, браузер формирует Origin сам |
| Token persistence | Только память страницы; без localStorage/sessionStorage/URL/MCP result |
| Limits | Atomic ≤32 имени, ≤128 characters/name, ≤4096 суммарных name characters, ≤64 KiB UTF-8/value, ≤256 KiB весь HTTP body; все пределы действуют одновременно |
| TTL | 10 минут form/request authority в принятом RAM lifecycle; restart процесса не переигрывает submit |

| Операция или исход | Поведение |
|---|---|
| `new` | Имя отсутствует; автоматическое/чужое владение именем конфликтует |
| `update` | Существующая manual запись, обычная или protected; введённое человеком новое значение защищается атомарно, прежнее не предзаполняется |
| Dashboard mark | Отдельный PATCH `{isSecret:true}` сохраняет прежнее точное значение; не смешивать с вводом нового значения |
| Потерян ответ create | Повтор с тем же token/idempotencyKey возвращает тот же scoped request, без второго окна/записи |
| Потерян ответ submit | Прочитать status; без автоматического resubmit/replay |
| Validation 400 / mismatch 409 до commit | Остаётся `awaiting_input`; исправленный человеком ввод с новым submissionId допустим до исходного TTL |
| `COMMIT_IN_PROGRESS` | Только status; нельзя cancel/resubmit или начинать второй commit |
| Bootstrap вернул `request.state=committing` | Поля заблокированы; только GET status. Не повторять submit и не создавать автоматически новую session/request |
| Terminal provider/storage conflict/failure | State `failed`; старый request не переиспользуется |
| Ошибка decrypt при submit | 422 `SECRET_DECRYPTION_FAILED`, безопасный `{error,request:failed}`; отличается от unavailable provider 503 и не раскрывает исходный exception |
| Failed/cancelled/expired restart | Явное действие человека, новая session/request/idempotencyKey; без автоматической повторной передачи значений |

Accepted postcommit cleanup warning не относится к `failed/503`: encrypted commit завершён, state `completed`, canonical `notice` передаётся до UI/MCP согласно разделу `storage-cleanup-result`. Источник exact wire: прямое MCP/frontend соглашение, frontend acceptance queue01a1a849-d45f-7701-8824-563544072a76, отчёт frontend-result.md. Раннее соглашение `intake-warning-agreed` с `warning:HYGIENE_PENDING` superseded последующим canonical notice соглашением; frontend allowlists только canonical notice. Internal receipt `{variables,notice?}` сохраняет эту семантику. Широкие правила «все 409 терминальны» или «все 409 можно повторить» неверны; использовать code/state и границу commit.

Причина: человек вводит значения локально, модель инициирует форму и видит состояние. Цель: отдельная ограниченная browser authority, атомарная запись и понятный исход при потерянном ответе. Механизм: request-scoped token, guard маршрутов, metadata-only views, status перед явным повтором. Передача originals через MCP, токен в URL/storage или автоматический повтор после неизвестного исхода этой границе не соответствуют.

### Исторический receipt и текущее состояние cleanup

Окончательное direct MCP/frontend соглашение `intake-hygiene-result`, зафиксированное frontend в final report: `RequestView.notice` отражает состояние при commit. In-process status и same-submission replay сохраняют это notice вместе с `completed` и names/tokens. Такой ответ не является новым измерением текущего состояния cleanup и не повторяет запись.

Актуальное vault-wide состояние — durable `retention.cleanupPending` в `/api/vault`. После release reader + следующей успешной записи оно становится false; current Vault UI refresh убирает баннер только по явному false, отсутствие marker не доказывает clean. Dedicated completed page использует историческую формулировку «после записи не удалось подтвердить очистку» и ссылку на текущие переменные; не утверждает, что cleanup всё ещё не завершён. Фиксированный безопасный `notice.message` в HTTP/MCP тоже описывает состояние на момент commit; не использует утверждение о текущем pending после позднего status/replay. Уже отправленный receipt/историческое предупреждение не переписываются. Status read не запускает commit или hygiene write.

Решение coordinator: принять это совместимое разделение по итоговому соглашению и actual held-reader UI evidence. Собственное раннее уточнение `notice-current-status-policy` о динамическом изменении RequestView.notice withdrawn/superseded; это не было отдельным требованием пользователя. Не добавлять текущий storage getter в immutable receipt только ради прежней интерпретации. Ошибка раннего browser assertion «историческое notice должно исчезнуть» относится к изменённому expectation, не к потере commit/неработающему шифрованию; исходное evidence сохраняется.

Причина: результат завершённой операции и состояние общей очистки имеют разные сроки актуальности. Цель: честный успех/предупреждение и idempotent replay без ложного текущего статуса. Механизм: historical receipt + separate authoritative retention, явная UI формулировка/ссылка. Проверка: held reader -> completed+notice -> GET/bootstrap/replay сохраняют результат без повторного submit -> release+next write -> retention false/current Vault warning исчезает -> historical receipt не меняется; DB/WAL canaries отсутствуют. Отдельный request journal не требуется.

## Платформенные условия

| Платформа | Backend | Что необходимо | Проверенная здесь граница |
|---|---|---|---|
| Windows x64 | DPAPI CurrentUser | Сервер в контексте той Windows-учётной записи, которая защитила данные | Real primitive и storage integration на Node22.13/26.8.2; installed0.2.0 на Node22.13 проверен |
| Windows arm64 | DPAPI CurrentUser, bundled prebuild | Соответствующий Node/runtime architecture | Бинарник поставляется dependency; выполнение не проверено |
| macOS | Keychain через @napi-rs/keyring; AES-GCM blobs | Доступ к пользовательскому Keychain; master key требуется для восстановления DB | Native adapter реализован, contract fixtures PASS; live macOS не проверен |
| Linux | Явный Secret Service через @napi-rs/keyring; AES-GCM blobs | Пользовательская D-Bus session и persistent Secret Service provider, доступная/unlocked collection | Native adapter реализован, contract fixtures PASS; live Linux не проверен |

Перенос одной DB на другую машину/учётную запись не является поддержанным резервным восстановлением без соответствующего OS key material. Locked/unavailable provider не подменяется plaintext/keyutils. `npm install` должен сохранять optional platform dependencies native keyring; `--omit=optional` не является проверенным способом установки защищённого provider. Платформенные условия не равны гарантии исполнения: macOS/Linux явно остаются теоретической поддержкой по пользовательскому объёму до реальной проверки там.

## Приёмочные сценарии

1. Ограниченный real DPAPI roundtrip и перезапуск на synthetic input; точный failure при недоступности/порче, отсутствие plaintext fallback. ОС-настройки/учётные записи не менять.
2. Providers macOS/Linux реализованы и проверены контрактными fixtures; известные внешние prerequisites записаны; реальную проверку ОС не подменять mock PASS.
3. UI создаёт секрет, защищает существующую ручную запись и обновляет значение; обычная запись/rename/value edit продолжают работать.
4. MCP инициирует открытие local form; запрос не содержит значений; ввод через браузер меняет vault; catalog/proxy используют созданный либо прежний стабильный токен и актуальное значение согласно действующему контракту.
5. Защищённые значения не возвращаются обычными list/export/telemetry API и не остаются открытыми в принадлежащих операции persistent копиях; существующие historical backups имеют явно описанную границу.
6. Интегрированные сборка/фокусные regression/browser tests, проверка запуска пакета; краткая инструкция для проверки пользователем завтра. Не повторять не относящиеся suites без причины.

## Итоговая приёмка 2026-11-05

Все шесть сценариев выполнены в указанном объёме: Windows native DPAPI и UI/SDK/HTTP/proxy integration, контрактные Unix fixtures, actual Windows browser opener, исправленные NUL/Unicode/composite privacy cases и установленный npm-пакет. Независимая source QA: `verification-final-source.md/json`; independent artifact verdict: `verification-final-artifact.json` = `PASS_SCOPED_ARTIFACT_RECONCILIATION`. Root проверил verdict, unchanged384 product inputs,109 executable JS,51 UI files и382 archive/installed members. SHA256 архива0.2.0: `80ce61ba07d04930a24e2f38b36bad37f10e4dabed264e511bcc83b49b6b9ba1`.

Полная матрица доказательств и ограничения: `.codex/tasks/secret-vault-20261105/goal-acceptance-audit.md`; модульная карта/проверочный запуск: `delivery.md` в том же каталоге. Source/installed consumer dependency graphs различаются в разрешённых semver ranges; оба проверены, zero-drift не заявляется. Нет live Unix/ARM64/account-switch/reboot, пользовательской миграции, registry publication или изменения8767. Ранние pending/FAIL checkpoints выше сохранены как история и не отменяют более позднюю приёмку того же исправленного snapshot.

## Окончательная интеграция 2026-11-06

Интеграция с актуальным main и последующие диагностические исправления приняты независимой QA:124 cases+5 suites,191-input manifest `fa40f887…`, без открытых findings в проверенном scope. Root сверил окончательный пакет SHA256 `2817a99ee619f31b642e88432c25a313946c3f059000aa7bd4a3db99e4e0d3c2` с QA и durable installation; обновил8767 с consistent backup и проверкой сохранности всех исходных строк. Точные snapshot/installed/live границы: [приёмка](secret-vault-validation.md). Этот итог заменяет pending-статусы интеграции, не расширяет гарантии на непроверенные ОС или произвольные заранее обрезанные фрагменты.
