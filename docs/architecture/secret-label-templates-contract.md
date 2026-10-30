# Метки секретов: реализованный backend-контракт

Дата: 2026-10-31. Реализовано в исходниках; публикация рабочего сервера — отдельный этап координатора. Заменяет предложения из `secret-label-templates-review.md` в части выбранного поведения.

## Имена и обнаружение

Почему: прежний scanner терял capture groups, а случайные ключи могли перезаписывать оригинал. Для чего: читаемые метки при неизменном восстановлении. Как: scanner передаёт полный match и вычисленный prefix; отдельный allocator резервирует токен. Почему не иначе: восстановление по тексту шаблона зависело бы от редактируемого правила и не сохраняло бы старые ответы.

| Поле / синтаксис | Контракт |
|---|---|
| `PatternRow.label_template` | `string | null`; отсутствующее поле старого правила равно null. `type` остаётся категорией. |
| Нет шаблона | Prefix `AUTO_<TYPE>`. |
| Есть шаблон | Prefix равен результату шаблона, без дополнительного `AUTO_`. Пример `DB_HUB_$protocol_$1` → `DB_HUB_POSTGRES_POSTGRES_<SUFFIX>`. |
| Числовые группы | `$1`, `${1}`, `$12` — группа 12, не группа 1 + литерал 2. Нумерация с 1. |
| Именованные | `$protocol`, `${protocol}`. Короткое имя `[A-Za-z][A-Za-z0-9]*`; `_` завершает ссылку. Для имён с `_` использовать `${group_name}`. |
| Экранирование | `$$` рендерится как `$`, затем нормализуется в `_`; backslash не создаёт второй слой интерполяции. Подставленные значения повторно не интерполируются. |
| Отсутствующая declaration | Ошибка 400: `$0`, `$99` без группы 99, `$unknown`, незавершённая ссылка. |
| Optional / empty / repeated | Существующая, но не участвующая группа → `NA`; matched empty → пустая строка; repeated capture → последнее значение native JS RegExp. |
| Нормализация | Только имя: uppercase, каждый символ вне `[A-Z0-9_]` → `_`, prefix до 96 символов. Оригинал не нормализуется. Template source 1–512 символов. Пустой итог использует `AUTO_<TYPE>`. |
| Обнаруживаемое значение | Для совместимости прежний full match с `trim()`, прежний фильтр длины >3; AnyIp проверяет isIP. Шаблон не выбирает замещаемую capture group. |
| Дедупликация | Точное равенство original в текущем store, manual перед auto. Уже существующий mapping сохраняет прежний alias независимо от нового template/type. |
| Изменение правила | Влияет только на новые mappings, не переименовывает выданные tokens. |

Флаги `gi` сохранены. Регулярку и declarations разбирает `@eslint-community/regexpp`; шаблон — данные, не JavaScript expression. Runtime и preview используют один `LabelTemplate`. Captures в wire label видны провайдеру; нормализация и random suffix этого не скрывают.

## API для frontend

| Endpoint | Поля и ошибки |
|---|---|
| GET `/api/patterns` | Каждый row включает `label_template: string|null`. |
| POST `/api/patterns` | `{name,pattern,type?,label_template?}`; type по умолчанию custom, template по умолчанию null. Ответ `{success:true,pattern}`; 400 при ошибке regex/template. |
| PUT `/api/patterns/:id` | `{name,pattern,type,enabled,label_template?,baseline:{name,pattern,type,enabled,label_template?}}`. Omitted draft template сохраняет текущее. Baseline omitted template означает null, а не игнорирование проверки. 409 при изменённой базе, 404 при удалённом правиле, 400 при неверном draft. |
| POST `/api/pattern-preview` | Прежние `{pattern,anyIp?,offset?,matchOffset?,snapshot}` плюс `{type?:string,label_template?:string|null}`. Ошибки 400 для template/regex, 408 для worker resource/time failure. |
| Preview result | Прежние поля + `{labelPrefix:string,alias:string,existing:boolean,labelNotice:string}`. Для existing — точный сохранённый alias. Для нового — пример с настоящим CSPRNG suffix, без резервирования/создания mapping; при runtime будет выделен другой suffix. Notice явно объясняет предварительность и видимость captures. |
| GET `/api/vault` | Manual rows: `storage:'manual'`, `retainedVersions:number`. Auto rows: `storage:'memory'|'legacy'`, `hitCount:number`. Каждый SecretEntry содержит `representations:Array<{value:string,alias:string}>` — точные выданные формы. Верхний уровень `retention:{auto:'process',legacyCount:number,notice:string}`. |
| POST `/api/vault/secret` | Прежний запрос `{key,realValue,description?}`; ответ `{success:true,secret}`. При edit существующий maskInAi сохраняется; alias может смениться при новом original. UI должен использовать alias ответа, не вычислять его из key. |
| POST `/api/vault/promote` | Закрепляет текущий auto mapping как durable manual без смены alias, включая его представления. |
| DELETE `/api/vault/secret/:key` | Удаляет текущую запись и прежние версии этого ручного key; aliases остаются занятыми tombstones. Для начатого запроса действует его immutable snapshot до завершения. |
| GET `/api/export` | Сохраняет version 1 и прежние scope/group. Patterns включают template. Auto включает действующие RAM + legacy originals с storage; manual row включает `versions` с прежними originals; current/versions/auto также включают точные `representations`. Экспорт — явная запись секретов в файл, даже для RAM auto. |

Новые `interceptedSecrets` содержат `representations:Array<{value:string,alias:string}>` — snapshot точных пар для показа исторического запроса и Ctrl+Click. Derived aliases нельзя строить из key: versions и registry collisions меняют их. Если массива нет, достоверна только raw пара alias/realValue.

Старый historical alias без точного `interceptedSecrets` остаётся неизвестным в UI. По совпадению key нельзя показывать нынешний original вместо исторического. Архивные originals не возвращаются в `/api/vault`: они используются для inbound и явного экспорта.

## Уникальность и операции записи

Почему: случайность не исключает коллизий, а раздельные таблицы не обеспечивали общий namespace. Для чего: выданный token никогда не обозначает другой original. Как: общий `alias_registry` с `PRIMARY KEY(alias_hash)`, SHA-256 полного alias, opaque owner UUID, индекс формы и nullable открытый alias. Allocation выполняется в `BEGIN IMMEDIATE`; память публикуется после commit. Почему не иначе: проверка с последующей независимой вставкой допускает гонку, `INSERT OR REPLACE` уничтожает старую связь.

- Автоматический suffix: 6 bytes `crypto.randomBytes`, 12 uppercase hex символов. До 16 попыток при конфликте; далее 503 `ALIAS_ALLOCATION_EXHAUSTED`. Запрос не уходит upstream без защиты.
- Общее пространство: manual, auto, raw и URL/Base64/JSON/slash формы. Derived aliases сохраняются, не перенумеровываются при последующем изменении набора записей.
- Новые auto резервируют только hashes aliases, owner UUID и порядковые номера форм. Ни original, ни открытая wire label в registry для них не сохраняются. Это резервирование, не восстановимый mapping.
- Manual/legacy сохраняют открытые aliases форм в registry для стабильной загрузки. Originals находятся в прежних таблицах или manual version archive.
- DELETE очищает открытые aliases в registry, но сохраняет hashes tombstones. Повторная выдача такого alias запрещена, даже после рестарта.
- Новый ручной key, совпавший с уже выданным/удалённым token, отклоняется 409; существующий ручной key допускает редактирование через новый versioned alias.
- Гарантия относится к одному vault DB. Между независимыми БД namespace не общий. Hash collision отвергает доступное имя, а не переназначает занятый token.

## Жизненный цикл

| Объект | Срок и операции |
|---|---|
| Новый auto original | Только Map текущего процесса; после остановки/crash не загружается. Никаких новых INSERT/UPDATE originals в auto_secrets по обнаружению. |
| Legacy auto | Прежние auto_secrets сохранены и загружаются со storage=legacy. Никакой автоматической очистки, включая прежнюю hardcoded cleanup. Hit count новых попаданий обновляется только RAM. Explicit promote/delete действуют по запросу пользователя. |
| Manual original | Durable. Обычный edit сохраняет maskInAi и key. Изменение original выдаёт новую версию wire alias, например `$${<DB_HOST_V_A1B2C3D4E5F6>}`, сохраняя key записи. |
| Прежние manual originals | Таблица `secret_versions`; только inbound, не активный outbound matcher. Накапливаются до explicit DELETE key, автоматического TTL нет. `retainedVersions` показывает число прежних значений. |
| Работающий запрос | Snapshot mappings сразу после outbound masking, до await hooks/провайдера. Edit/delete не меняют восстановление его обычного ответа, SSE delta, tool arguments или terminal snapshot. Новый запрос после удаления уже не получает удалённые mappings. |
| История / exports / backups | Политика не изменена; могут содержать originals независимо от lifetime mapping. SQLite DELETE не обещает forensic erasure из WAL/свободных страниц/копий. |

Почему single runtime: volatile originals недоступны соседнему процессу. Как: один VaultStore на connection плюс SQLite `BEGIN EXCLUSIVE` на canonical `<db>.runtime-lock` на срок его жизни. Второй процесс получает явную ошибку, без перенаправления запросов к неполному cache. Закрытие БД и аварийный выход освобождают ОС-lock. `:memory:` изолирована по connection. Почему не distributed cache: это меняет согласованный процессный lifetime и добавляет хранилище originals. Старые binaries, прямые SQL writers и обходные hardlink/network filesystem deployments не поддерживаются этой гарантией; все serving instances должны использовать новую реализацию.

## Миграция и rollback

1. Остановить приём новых запросов, дождаться активных streams, сделать SQLite-consistent backup рабочей БД и сохранить binary/dependencies. Работающий сервер этим этапом разработки не изменялся.
2. Новый binary добавляет nullable `patterns.label_template`, `alias_registry`/owner index, `secret_versions`. Старые secrets/auto_secrets/history не очищаются. Первый VaultStore атомарно резервирует текущие legacy aliases и формы.
3. Конфликт legacy ключей/aliases останавливает запуск с ошибкой; существующие данные сохраняются. Не исправлять конфликт автоматическим переименованием: исторически уже перезаписанный mapping нельзя восстановить из случайного suffix.
4. Повторный старт использует записанные aliases, не вычисляет новые имена для прежних форм. New auto originals исчезают, hashes остаются. Legacy/manual продолжают восстанавливаться.
5. Rollback старого binary поверх мигрированной БД небезопасен: старый allocator игнорирует registry, не загружает manual archives, может писать auto originals и переназначать tokens. Предпочтителен исправляющий новый binary. Полный rollback требует согласованной пары backup БД + старый binary/dependencies и означает потерю созданных после backup mappings/версий; не выполнять молча.

Издержки: registry хранит tombstones без автоматической очистки, растёт с количеством выданных форм; manual archive хранит прежние originals. Это цена запрета переиспользования и восстановления старых ответов. Изменение retention/tombstone cleanup требует нового контракта.
