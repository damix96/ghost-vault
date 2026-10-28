# Реальное подключение OpenCode к Zen через GhostVault

Текущий результат: `ghostvault-zen/big-pickle` прошёл реальный masked cloud smoke, HTTP 200; alias отправлен в Zen, исходный canary восстановлен в ответе. Рабочий gateway: `http://127.0.0.1:8767/dashboard`. Evidence: `.cache/live-zen-big-pickle-native-report.json`.

## Схема

```text
OpenCode provider: ghostvault-zen
  -> http://127.0.0.1:8767/opencode/v1/chat/completions (Node: mask)
  -> private loopback relay in OpenCode/Bun (native upstream transport)
  -> https://opencode.ai/inference/openai/v1/chat/completions
  -> GhostVault SSE transformer (unmask) -> OpenCode
```

Это отдельный провайдер. `opencode`, `opencode-go`, `zen`, `anthropic`, `openai` и тестовый `ghostvault-test` при его добавлении не изменяются. Встроенный `opencode` — имя маршрута GhostVault, а не выбор существующего провайдера в OpenCode.

| Параметр | Значение |
|---|---|
| Entry point | `src/zen.ts` |
| Запуск | `npm run build`, затем `$env:GHOSTVAULT_PORT='8767'; npm run zen` из `ghostvault`; без env default port 8765 |
| Dashboard | `http://127.0.0.1:8767/dashboard` |
| База gateway | `ghostvault/.cache/zen-live.db`, отдельно от пользовательской `~/.ghostvault/vault.db` |
| Config провайдера V2 | `%USERPROFILE%/.config/opencode/opencode.json`, только `providers.ghostvault-zen` |
| Runtime V2 | `canonical: "opencode"`; runtime/catalog наследуются от встроенного Zen; адрес в `settings.baseURL` |
| Авторизация V2 | Активная OpenCode Console connection через локальный `ghostvault.provider.zen-connection`; явный `public` удалён |
| Локальный plugin | `ghostvault/opencode/zen-connection/`, подключён как directory в `plugins`; ключи в plugin/config не копируются |
| Native transport | Включён plugin option `nativeTransport: true`; реальный Big Pickle smoke подтверждён |
| Base URL клиента | `http://127.0.0.1:8767/opencode/v1` |
| Upstream route | `https://opencode.ai/inference` |
| Free models | `deepseek-v4.1-flash-free`, `beam-free`, `mimo-v2.6-flash-free`, `big-pickle` |
| Обычная модель Zen | `deepseek-v4-flash`, требует соответствующего доступа/баланса Zen; в этом проходе не вызывалась |

## Проверка 2026-10-24

Реальный OpenCode был запущен из новой временной директории. Существующие providers и Go credential не использовались. Запросы достигли облачного endpoint Zen, mock server не запускался.

| Модель | Реальный HTTP результат | Assistant response |
|---|---|---|
| `ghostvault-zen/beam-free` | 429 `FreeUsageLimitError`: `Free usage limit reached` | Не получен |
| `ghostvault-zen/mimo-v2.6-flash-free` | Тот же 429 | Не получен |

Это подтверждает реальную маршрутизацию, но **не успешную генерацию облачной модели**. Зафиксирован отказ сервиса для тестового подключения; состояние лимита рабочего подключения пользователя не проверено. Дополнительные автоматические inference attempts остановлены.

Последний stdin-сценарий подтвердил наличие alias в отправленном `maskedPrompt` и отсутствие точного зарегистрированного synthetic canary. Значение содержало кавычки, backslash, newline и Unicode. Тестовый key после проверки удалён.

Первый argv-сценарий менял кавычки/Unicode до входа в proxy. Совпадение только префикса canary не считалось доказательством утечки; после сравнения decoded request проверка исправлена на stdin. Локальные evidence: `.cache/live-zen-smoke-report.json`, `.cache/live-zen-smoke-cli-diagnostics.txt`.

## Авторизация нового провайдера

Для free-прогона использовался анонимный маркер `public`; после отказа он удалён из options, чтобы не перекрывать отдельный настоящий credential провайдера.

Для модели с доступом по ключу сохранить отдельный credential через `/connect` → `Other` → ID `ghostvault-zen`, предварительно убрав явный `settings.apiKey: public`. Ключ не нужно записывать в репозиторий или отправлять в чат. Это не подключает и не изменяет `opencode-go`. Ключ сам по себе не устраняет ограничение free-tier clients: [Inference API](https://opencode.ai/v2/docs/console/api/inference#authentication).

## Обновление до OpenCode V2

Установленная версия: `v2.1.4`. Команда `opencode models --standalone` подтвердила обе записи: `opencode/deepseek-v4.1-flash-free` и `ghostvault-zen/deepseek-v4.1-flash-free`.

Только добавленный `ghostvault-zen` перенесён в native V2 `providers` / `canonical` / `settings`; определения остальных providers сохранены. Изначально использовался `settings.apiKey: public`; после выявления отличия авторизации он удалён. Актуальная конфигурация использует адаптер подключения Zen ниже.

Реальный V2-прогон DeepSeek Free достиг Zen и получил последовательно 403 `FreeTierError` и 429 `FreeUsageLimitError`. Assistant response отсутствует; успешная генерация по-прежнему не подтверждена. В обоих запросах synthetic canary заменён alias и его исходное значение отсутствует. Evidence: `.cache/live-zen-v2-smoke-report.json`.

## Сравнение с рабочим Zen

Рабочая модель пользователя: `opencode/big-pickle`, вариант default, free. URL проверен также по установленному `~/.cache/opencode/models.json`: provider API и model API равны `https://opencode.ai/inference/openai/v1`; gateway добавляет `/chat/completions`. Ошибка адреса в проверенном маршруте не обнаружена.

Первоначальный generic runtime не наследовал catalog defaults. Новый провайдер исправлен на `canonical: "opencode"`; DeepSeek наследует штатные capabilities, model-level `settings.baseURL` явно указывает тот же gateway. Подсказка админки использует этот же способ наследования. Существующие providers сохранены семантически неизменными; перед правкой создан backup глобального config.

Изолированный loopback capture сравнил generic и canonical без cloud inference: оба отправляют POST `/v1/chat/completions`, `User-Agent: opencode/latest/2.1.4/cli`, `x-opencode-client: cli`; canonical также передаёт `x-opencode-org-id`. Повторный реальный canonical-запрос всё равно получил 403, затем 429. Причина различия с рабочим подключением пользователя пока не установлена; одного отказа недостаточно для вывода об общем исчерпании его лимита. Ручные подстановки client headers не применяются.

Evidence: `.cache/opencode-provider-capture.json`, `.cache/live-zen-v2-smoke-report.json`; предыдущий generic-прогон сохранён в `.cache/live-zen-v2-smoke-report-previous-generic.json`. Заголовки cloud-попыток проверены через in-memory `/api/hooks/context?id=...`: обе содержат org/client headers. Persisted `/api/sessions` возвращает `request.headers: {}` и не доказывает отсутствие заголовков в реальном запросе.

### Различие авторизации

Изолированное сравнение штатного `opencode/big-pickle` и canonical-копии подтвердило совпадение path, основных body fields и набора из 12 tools. Существенное отличие — Authorization: копия использовала явный `public`, штатный OpenCode — другую авторизацию. Значения не сохранялись; сравнение выполнялось в памяти по fingerprints. `opencode auth list` подтвердил сохранённый API credential интеграции `opencode` / OpenCode Console. Старый `auth.json` не отражал актуальную авторизацию V2.

Контроль без `settings.apiKey` отправил новый provider ID без Authorization: `canonical` наследует каталог, но не активное подключение. Отказы анонимной копии не доказывают исчерпание лимита рабочего подключения пользователя.

Первый реальный Big Pickle smoke с `public`: отдельный запрос заголовка сессии получил 403; основной запрос с 12 tools получил 429. Это две операции, а не retry одного запроса. Маскирование изменило только пользовательский canary, системный prompt сохранился. Decoded JSON leaves исходящего `maskedPrompt` содержали alias и не содержали canary; исходный `request.body` в инспекторе сохраняется до маскирования и не является доказательством сетевой утечки. Evidence: `.cache/live-zen-big-pickle-report.json`, `.cache/opencode-builtin-canonical-comparison.json`, `.cache/opencode-canonical-inherited-auth.json`.

### Адаптер подключения Zen

`ghostvault/opencode/zen-connection/index.mjs` регистрирует отдельный `ghostvault-zen` на основе штатного каталога с `integrationID: opencode`. Авторизацию разрешает сам OpenCode; ключ не читается адаптером, не копируется в config или БД GhostVault. `opencode-go` не используется. Provider/model endpoints заменяются loopback URL; опция plugin `baseURL` по умолчанию равна `http://127.0.0.1:8765/opencode/v1` и принимает только loopback HTTP(S).

Адаптер создаёт provider через `provider.transform` до штатного config plugin: внешние плагины обрабатываются раньше создания custom providers из config. Попытка обновлять только ещё не созданный alias ничего не меняла. Штатный config plugin затем сохраняет заранее установленный integration ID.

В V2 `plugins` принимает директорию с index/server module, не путь отдельного файла: [Plugins](https://opencode.ai/v2/docs/plugins). Для локальных capture tests обе model/provider baseURL и plugin option baseURL должны указывать capture server; анонимная конфигурация изолированной config directory не проверяет авторизацию рабочего global store.

Локальная проверка адаптера со штатным global store: `ghostvault-zen` без inline key получил тот же authorization fingerprint, что builtin, а несвязанный `ghostvault-probe-other` остался без Authorization. Все запросы направлялись на loopback capture, получали намеренный 404; облачная генерация этим тестом не проверялась. Исходный provider и его model definitions не мутируются; invalid/remote plugin endpoint и Go integration не регистрируют копию. Evidence: `.cache/zen-connection-plugin-local-test.json`, `.cache/zen-connection-plugin-global-key-isolation.json`.

Конфигурация текущего workspace:

```json
{
  "plugins": [{
    "package": "file:///E:/projects/aegis-gate/ghostvault/opencode/zen-connection",
    "options": {"baseURL": "http://127.0.0.1:8767/opencode/v1", "nativeTransport": true}
  }],
  "providers": {
    "ghostvault-zen": {
      "canonical": "opencode",
      "settings": {"baseURL": "http://127.0.0.1:8767/opencode/v1"},
      "models": {"big-pickle": {"name": "Big Pickle"}}
    }
  }
}
```

Cloud smoke запускается из временной project config с `agents.title.disabled: true`, `small_model: "ghostvault-zen/big-pickle"` и выбранной free-моделью для summary/compaction. Это исключает побочные платные/builtin auxiliary вызовы; пользовательский global default model/agents не меняются.

### Облачный контроль после подключения авторизации

Расширенная проверка 2026-10-24: семь настоящих paid POST на `deepseek-v4.1-flash`, все HTTP 200, через обычный Node gateway с memory DB. Тестовый API-клиент использовал Authorization из фактического предыдущего CLI capture только в памяти; это не семь CLI запусков. Четыре manual secrets с quotes/backslash/newline/Unicode проверены одним запросом. Подтверждены безопасный function-call → фиксированный локальный результат → повторная отправка результата (два POST) и изоляция одновременных JSON/SSE ответов (два POST). Первый long-stream завершился `finish_reason:length` без собранного content; причина по сохранённым данным не доказана. Дополнительный один POST с per-request thinking disabled: HTTP 200, `stop`, ноль reasoning deltas/tokens, три aliases реально пересекали границы delta events, upstream/downstream content совпал после единственной ожидаемой подстановки. Ответ 118 слов вместо заданных 120–180: генеративное ограничение длины не выполнено, передача текста и восстановление подтверждены. User OpenCode settings, existing providers и Go не менялись; raw новые streams/credentials в aggregate не сохранялись. Evidence: `.cache/deepseek-paid-validation/report.json`, `long-stream-thinking-off.json`.

Платная `deepseek-v4.1-flash` проверена отдельным временным provider через обычный Node upstream, `nativeTransport: false`: transaction `tx-1792860037233-dsd7`, HTTP 200, CLI exit 0, один model POST, реальный assistant `hello` с восстановленным synthetic canary. Outgoing capture подтверждает model ID без `-free`, `max_tokens: 256`, alias вместо canary, одинаковый Authorization; изменился только `messages[1].content`. Global config не менялся; Go и штатный relay OpenCode/Bun не использовались. Evidence: `.cache/live-zen-deepseek-v4.1-flash-paid-report.json`, HTTP captures `.cache/deepseek-paid-capture/`. В запросе остались 12 штатных tool definitions несмотря на временный model setting `tools: false`; tool execution и многошаговый цикл этим тестом не проверены.

Почему: нужно отделить отказ free tier от работоспособности обычного Node proxy. Для чего: проверить настоящий cloud mask/unmask без специального транспорта. Как: выбранная пользователем платная модель, краткий prompt, memory vault и полные ingress/egress одного вызова. Почему не иначе: успешный free запрос через Bun relay не доказывает работу прямого Node upstream; результат одного платного запроса не устанавливает причину прежних free-limit отказов.

| Вариант | Факт | Evidence |
|---|---|---|
| Новый provider через gateway, canary | 429, assistant отсутствует; actual Authorization совпал с builtin fingerprint, не `public`; canary замаскирован и удалён | `.cache/live-zen-big-pickle-report.json` |
| Тот же новый provider напрямую, `Reply with hello.` | Assistant `hello`, CLI exit 0; direct SDK hook отдельно подтвердил HTTP 200; global config не изменялся | `.cache/live-zen-big-pickle-direct-control.json`, `.cache/live-zen-big-pickle-sdk-header-comparison.json` |
| Новый provider через gateway, тот же `Reply with hello.` | 429; между исходным JSON body и decoded maskedPrompt нет изменений | `.cache/live-zen-big-pickle-proxy-control.json` |
| Node HTTPS HTTP/1.1 replay того же gateway request | 429, redirect отсутствует | `.cache/live-zen-big-pickle-http1-replay.json` |
| Node HTTP/1.1 replay с минимальными штатными заголовками | 429; удаление accept/encoding/tracing/connection отказ не устранило | `.cache/live-zen-big-pickle-http1-minimal-replay.json` |
| Bun fetch replay того же сохранённого gateway request | HTTP 200; parser не извлёк assistant text; это реальный inference POST, не mock и не только metadata GET | `.cache/live-zen-big-pickle-bun-replay.json` |
| Public trace GET из Node и native OpenCode/Bun | Публичный egress IP совпал; Node использует HTTP/2, Bun — HTTP/1.1; proxy env отсутствует; inference не отправлялся | `.cache/network-egress-report.json` |
| Полный native transport путь через GhostVault 8767, canary | HTTP 200, CLI exit 0; реальный ответ `Hello! [restored]`; outbound alias присутствует, decoded raw canary отсутствует, inbound canary восстановлен; временный key удалён | `.cache/live-zen-big-pickle-native-report.json` |

Сравнение настоящего direct SDK request с gateway context подтвердило совпадение Authorization, org/client headers, модели, tools и пользовательского hello. System prompt отличается только переменным cwd; стабильный prefix совпал. Различаются transport/tracing/session headers. Причина 429 proxy path пока не установлена; версия «достаточно переключить Node на HTTP/1.1» контроль не прошла. Успех direct нельзя выдавать за успешное маскирование через gateway.

### Штатный транспорт OpenCode

`native-relay.mjs` создаёт внутри OpenCode/Bun временный HTTP relay на loopback port 0. Scoped `http.request` hook только для `ghostvault-zen` добавляет URL relay и случайный capability token к запросу в loopback GhostVault `/opencode/...` или `/zen/...`. `proxy/upstream-client.ts` для официального Zen делегирует уже замаскированное тело этому relay; остальные upstream сохраняют обычный fetch. Relay отправляет запрос в Zen средствами OpenCode/Bun и возвращает stream; существующий GhostVault SSE transformer восстанавливает псевдонимы.

Relay проверяет token, POST и официальный HTTPS origin `opencode.ai`; разрешены только `/inference|zen/openai|anthropic|google/...`, Go исключён. Служебные relay headers, hop-by-hop, устаревшие length/encoding не попадают в облако; outbound bytes сохраняются через arrayBuffer. Response streaming не буферизуется. При остановке plugin relay закрывается. Новые providers и endpoints исходного `opencode`/Go не меняются.

Опция `nativeTransport` по умолчанию выключена; в текущем workspace явно включена для нового Zen provider. Это compatibility adapter, а не установленное объяснение внутренней политики Zen. Сборка, 9 прежних suites и новая `test-native-transport` прошли; local OpenCode integration подтверждает loopback marker/token. Полный cloud запрос с маскированием через адаптер подтверждён: transaction `tx-1792851772366-dyna`, HTTP 200, исходный canary с кавычками/backslash/newline/Unicode восстановлен в ответе. Остальные модели и реальные cloud tool calls этим smoke не проверялись.

Для отдельного экземпляра поддержан `GHOSTVAULT_PORT` (по умолчанию 8765). Фоновый запуск/перезапуск через Start-Process был отклонён автоматической проверкой tool: `blocked by policy`. После явного разрешения пользователя новая версия запущена на 8767 обычной управляемой foreground exec-сессией; существующий процесс на 8765 сохранён. Только настройки нового provider/plugin переведены на 8767; определения остальных providers и default model/agents сохранены, config backup создан.

Команда ручного V2-запуска:

```powershell
opencode run --standalone --model ghostvault-zen/big-pickle "Привет"
```

Флаг V1 `--pure` в V2 отсутствует. Модуль `clients/opencode-cli.ts` определяет установленную major version, выбирает совместимые executable/flags и передаёт prompt через stdin для сохранения кавычек/Unicode на Windows. `clients/opencode-config.ts` формирует соответствующий V1/V2 config; тот же генератор используется в E2E и подсказках админки.

В V2 локальная командная tool называется `shell`, в V1 — `bash`. Mock E2E выбирает фактически объявленную клиентом tool и её `command` schema, а не подставляет старое имя. Это относится к автономному тесту, не к реальному Zen upstream.

Основание: [V2 custom providers](https://opencode.ai/v2/docs/providers#custom), [V2 configuration](https://opencode.ai/v2/docs/config). Наличие модели в каталоге не подтверждает доступность free tier через custom gateway.

## Контекст решения

### Интернет-проверка ограничений Zen, 2026-10-24

| Источник | Установлено | Предел вывода для GhostVault |
|---|---|---|
| [Официальный Inference API](https://opencode.ai/v2/docs/console/api/inference#authentication) | Free-tier chat разрешён внутри OpenCode; для других клиентов документирован HTTP 403 даже с API key | Поддержка free Zen через произвольный gateway не гарантирована |
| [OpenCode #56662](https://github.com/anomalyco/opencode/issues/56662) | Аналогичная схема official CLI → custom gateway → Zen; issue закрыт как not planned, ответ repo bot называет отказ relayed requests намеренным | Ответ bot не раскрывает реализацию серверной проверки; не доказывает конкретную причину нашего 429 |
| [OmniRoute #16598](https://github.com/cheaper-inference/OmniRoute/pull/16598), [#16858](https://github.com/cheaper-inference/OmniRoute/pull/16858) | Авторы воспроизвели 403 при изменённых session values / tools, сообщили live 200 после исправлений | Чужие A/B относятся к их запросам и времени; не основание подделывать identity, session или tools реального OpenCode |
| [OpenCode #58103](https://github.com/anomalyco/opencode/issues/58103), [#58205](https://github.com/anomalyco/opencode/issues/58205) | 22 октября пользователи сообщили чередование free-limit отказов и успешных ответов, а также FreeUsageLimitError без расхода в текущем окне | Текст лимита сам по себе не доказывает исчерпание пользовательской квоты или TLS fingerprint gate |

Наш контролируемый replay `.cache/same-peer-final-pair-report.json`: один captured body/header source, одинаковый выбранный peer `172.65.90.23`; Node HTTP/1.1 получил 429 JSON `Free usage limit reached`, OpenCode/Bun — 200 SSE `hello`. Cloudflare POP suffix при этом различался (`DTW` / `PHL`); одинаковый IP назначения не гарантирует одинаковый внутренний маршрут. ClientHello различается, но серверный критерий отказа не установлен. Нельзя объединять документированный 403 client gate и наблюдаемый 429 quota response в доказанную общую причину.

Почему: hosted Zen применяет ограничения вне клиентского кода. Для чего: отличать дефект пересылки от отказа сервиса. Как: сохранять status, error body и request ID; сравнивать реальные ingress/egress одного вызова, отдельно от контрольных replay. Почему не иначе: успех через Bun и публичные описания ограничений не доказывают корректность всех заголовков нашего Node proxy или точный серверный алгоритм.

### Захват внутри прокси

`GHOSTVAULT_CAPTURE_DIR` включает однократный захват первого POST вне `/api/` самим GhostVault. Без переменной захват не создаёт файлов и не подписывается на сетевые события. Файлы:

- `ghostvault-incoming-request.txt`: request line из IncomingMessage, все `rawHeaders` в исходном порядке, исходные payload bytes через `preParsing`, до разбора JSON/маскирования.
- `ghostvault-outgoing-request.txt`: для HTTP/1.1 фактические bytes `socket.write` HTTP-клиента прокси; для HTTP/2 фактически отправленные header fields и `bodyChunkSent` в декодированном текстовом представлении, без бинарного HPACK/frame framing.
- `ghostvault-request-capture.json`: общий transaction ID, destination, protocol, response status и размеры; при redirect отдельные outgoing attempts сохраняются с suffix.

Классы `RequestCapture` и `WireCapture` связывают входящий Fastify request с исходящими Undici events через AsyncLocalStorage и WeakMap. Все значения, включая Authorization, пишутся как получены/отправлены; logger не выбирает credential, не подставляет значения из OpenCode logs и не исправляет исходящие поля. У H1 событие `sendHeaders` возникает до дописывания Content-Length, поэтому одного этого события недостаточно: используется tap фактического `socket.write`. H2 channel уже содержит сформированные pseudoheaders/headers, body берётся из события реальной отправки.

Назначение: сравнивать две стороны одного вызова proxy, а не независимые повторные Node/Bun отправки. Предыдущие Desktop-файлы `opencode-success-request.txt` и `ghostvault-node-request.txt` относились к контрольным replay и не являются ingress/egress парой GhostVault. Корректная пара создаётся только новым захватом внутри proxy.

Локальная проверка: exact payload whitespace/Unicode, duplicated incoming headers/order, совпадение outgoing body с фактическим mock upstream, manual alias вместо canary, добавленные клиентом Host/Content-Length, one-shot при параллельных запросах, отдельное concurrent ALS pairing, capture-off без файлового IO. Harness: `.cache/test-request-capture-local.mjs`; cloud-захват требует нового реального запроса через proxy с включённой переменной.

Реальный однократный cloud-захват завершён: `tx-1792858967647-frwu`, временный provider `ghostvault-capture`, memory gateway 8768, Big Pickle; global config не менялся, temp project удалён. На Desktop созданы `ghostvault-incoming-request.txt` (25838 bytes), `ghostvault-outgoing-request.txt` (25894 bytes) и `ghostvault-request-capture.json`. Incoming HTTP/1.1, outgoing HTTP/2 в описанном выше текстовом представлении; Authorization совпадает, изменён только `messages[1].content` — synthetic canary заменён alias. Upstream вернул HTTP 429 JSON `Free usage limit reached`; успешная генерация этой попыткой не подтверждена. CLI остановлен после отказа до повторной отправки; observed model POST count = 1. Evidence: `.cache/captured-real-opencode-report.json`.

Предыдущая попытка с project override того же plugin/provider ID попала на глобальный 8767 и не создала capture-пару. Для изолированного теста применена временная копия plugin с отдельными plugin/provider IDs; сначала локальный preflight со штатным global store подтвердил нужный endpoint и отсутствие relay headers. Изолированная config directory с имитацией global config не доказывает реальное правило слияния пользовательской конфигурации.

| Почему | Для чего | Как | Почему не иначе |
|---|---|---|---|
| Mock проверяет агентный цикл, но не облачный сервис | Выполнить реальное подключение, запрошенное пользователем | Новый custom provider, локальный gateway и настоящий Zen upstream | Подготовленный ответ не подтверждает доступ к облачной модели |
| Рабочие providers должны сохраняться | Проверять отдельно от Go и остальных подключений | Добавление только нового provider ID с проверкой неизменности прежних записей | Перезапись baseURL встроенного provider меняет существующий рабочий путь |
| Generic custom provider теряет defaults Zen | Сравнить штатный OpenCode runtime через отдельный маршрут | V2 `canonical: "opencode"`, provider/model baseURL на gateway, без изменения встроенного provider | Ручное копирование заголовков не сохраняет штатную модельную конфигурацию и не устанавливает причину отказа |
| Новый provider ID не наследует подключение, `public` отличался от рабочей авторизации | Использовать штатную Zen connection без копирования ключа | Локальный plugin создаёт только `ghostvault-zen` с integration `opencode`, своим endpoint и копией каталога | Изменение builtin baseURL затрагивает рабочее подключение; копирование key в JSON дублирует credential; Go не относится к этому тесту |
| Одинаковый snapshot получает 429 из Node и 200 из OpenCode/Bun; точная transport причина неизвестна | Проверить исходящую отправку штатным OpenCode при сохранении фильтра GhostVault | Opt-in native relay с capability token и ограниченным upstream; существующий codec/SSE pipeline переиспользуется | Подмена User-Agent уже не нужна и не устранила проблему; отключение HTTP/2 и минимальные headers не помогли; новый адаптер нельзя объявлять рабочим до cloud E2E |
| Free endpoint возвращает 429 | Не выдавать отказ за успешную проверку | Сохранить фактический HTTP status; ждать доступного лимита/credential | Повторные одинаковые запросы и mock не заменяют успешную генерацию |

Документация: [Zen](https://docs.opencode.ai/docs/zen/), [Inference API](https://opencode.ai/v2/docs/console/api/inference), [Custom providers](https://opencode.ai/docs/providers#custom-provider).
