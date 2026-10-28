# Фиксированные форматы сообщений GhostVault

## Область

Поддержка выбирается по структуре JSON и API endpoint, а не по имени модели. OpenCode является клиентом этих API. Для Antigravity реализована обёртка Gemini `request`/`response`, проверенная по установленному `opencode-antigravity-auth`. Перехват нативного IDE и реальные облачные подключения этой проверкой не подтверждены.

Конструктор схем, ручной выбор JSON paths и предупреждения неизвестных форматов в этот этап не входят. Шифрование и административная авторизация остаются отдельными задачами.

## Целевые поля

| Семейство | Запрос | Ответ и SSE |
|---|---|---|
| OpenAI Chat Completions / совместимые OpenCode providers | `messages[].content`, text parts, refusal/reasoning text; JSON tool arguments; legacy function arguments | `choices[].message` и соответствующие delta fields; сборка по choice/tool index |
| Anthropic Messages | `system`; message text, tool input/results, текстовый document source | `content[]` text и tool input; text/input JSON deltas и события завершения блока |
| OpenAI Responses | `instructions`; строковый `input`; message items; function/custom tool input/output; reasoning summary | `output[]`; typed text/refusal/summary/tool argument deltas и final snapshots |
| Gemini / Antigravity | `systemInstruction.parts`; `contents[].parts`: text, function args/results, executable code/result; то же внутри `request` | `candidates[].content.parts`, в том числе внутри `response`; text/code fragments и structured function args/results |

Не меняются model/role/IDs, имена и определения инструментов, JSON schemas, generation settings, usage, opaque signatures/encrypted thinking, thought parts, image/audio bytes и transport URL/query/headers. Неизвестные JSON-структуры и SSE events передаются без общего рекурсивного маскирования служебных полей.

Извлечение секретов из изображений/аудио, расшифровка reasoning blobs и произвольные новые API-поколения не заявляются.

## Модули

| Модуль | Ответственность | Замена/расширение |
|---|---|---|
| `vault/text-replacer.ts` | Непересекающиеся совпадения предвычисленных представлений; сохранение готовых aliases | Поиск изолирован от API-схем |
| `VaultStore` | Manual/auto индексы и прямое/обратное соответствие | Не знает transport/API endpoints |
| `protocols/payload-codec.ts`, `*-payload.ts` | Clone JSON, выбор адаптера и целевых полей | Общий `PayloadAdapter`; registry передаётся constructor-ом |
| `protocols/stream-buffers.ts` | Текстовые окна и JSON argument buffers | Использует существующий `SlidingStreamTransformer` |
| `protocols/*-stream.ts` | Delta fields, ключи блоков, события завершения | Общий `StreamAdapter` |
| `proxy/sse-transformer.ts` | SSE parser, dispatch и framing | Registry stream adapters передаётся constructor-ом |
| `proxy/stream-relay.ts` | Upstream, hooks, backpressure, ошибки и progress | Не ветвится по семействам API |
| `response-content.ts`, `stream-content.ts`, `public/request-content.js` | Читаемое представление в админке | Не меняет wire response провайдера |

`PayloadCodec.request(body, url, transform)` и `response(body, transform)` возвращают преобразованный clone. Text transform имеет сигнатуру `(text: string) => string`. Payload adapter выбирает поля и меняет только clone; в нём нет сети и SQLite.

## Порядок замены

1. В выбранной строке применяются manual secrets, с longest match внутри manual.
2. Auto detection сканирует остаток после manual masking; готовые aliases исключаются.
3. Auto replacement не пересматривает manual aliases.
4. JSON сериализуется штатным encoder после замены строк.
5. На обратном пути aliases восстанавливаются в выбранных полях; JSON arguments разбираются и сериализуются заново.

Индекс предвычисляет raw, URL-encoded, legacy slash-escaped, Base64, полное JSON string escaping и его slash-escaped вариант. Базовый поиск остаётся последовательным; переход на Ахо–Корасик не выполнялся.

JSON string escaping поддерживается на уровнях 1–3, включая slash-escaped варианты. `vault/secret-representations.ts` хранит точное представление для каждого alias: raw использует прежний `$${<KEY>}`, отличающиеся формы — отдельные идентификаторы `KEY__GV_JSON1/JSON2/JSON3`, `KEY__GV_URL`, `KEY__GV_BASE64` и т. д. После маскирования сохраняется информация о форме: обратная замена возвращает исходное URL/Base64/JSON-представление. Это необходимо, когда один секрет стоит рядом в разных видах; глобальное экранирование или один alias на все формы не обеспечивают roundtrip.

Индекс alias → representation строится из сохранённых значений без новой DB schema; после set/delete/promote cache сбрасывается. Зарегистрированные canonical aliases резервируются до назначения representation aliases, коллизия разрешается числовым суффиксом. При перезагрузке индекс восстанавливается детерминированно. Ранее созданный canonical alias не содержит сведений о потерянной encoded форме и сохраняет прежнюю raw-семантику.

## Изоляция стрима

`StreamRelay.run()` создаёт отдельный `SseTransformer` для каждого HTTP-запроса. Parser и buffers не разделяются с другими запросами/сессиями. Внутри ответа буферы различаются по choice/content block/tool index.

Скользящее окно сохраняет неполный alias между текстовыми delta events. JSON arguments собираются отдельно и преобразуются перед выдачей полного аргумента. При обрыве upstream текстовый хвост сохраняется, незавершённые arguments отбрасываются.

Входной хвост незаконченного alias и уже восстановленный выход буферизуются отдельно. Распознанный alias заменяется один раз; если реальный секрет сам содержит строку другого alias, она не подвергается каскадной замене при следующем push или flush.

Граница выдаваемого текста не разрезает UTF-16 surrogate pair: если cut попадает между high/low surrogate, пара остаётся в окне до следующей выдачи. Это сохраняет emoji при немедленном UTF-8 выводе каждого parsed delta клиентом; одной проверки склеенной JS-строки недостаточно, поскольку две половины склеиваются без ошибки, но отдельно кодируются как U+FFFD. Регрессия проверяет исходный и восстановленный emoji-текст при нескольких разбиениях входного SSE-текста.

При выборе protocol family для официального Zen маршруты `/vN[beta]/models/<model>:<method>` направляются в `/google/...`; Messages — в `/anthropic/...`, остальные поддержанные пути Chat/Responses — в `/openai/...`. Основание: Gemini использует отдельный Google endpoint; прежний default `/openai/` давал неверный адрес до обращения к модели. Локальные routing tests проверяют generate/streamGenerate с query и сохранение OpenAI/Anthropic/Go маршрутов; облачная Gemini-генерация этой проверкой не подтверждается.

Responses `sequence_number` формируется монотонно для выдаваемых событий: буферизация может изменить число delta events. Идентификаторы items/calls/models фильтром не подменяются.

## Контекст решений

| Почему | Для чего | Как | Почему не иначе |
|---|---|---|---|
| Поиск сериализованной строки пропускал пароль с кавычками/newline | Точно находить зарегистрированные значения | Выбор известных текстовых полей после разбора JSON + общий фильтр | Замена во всём JSON затрагивает служебные строки и зависит от escaping |
| SSE содержит отдельные JSON events, ответ содержит независимые blocks/tools | Сохранять целые aliases и arguments | Существующее окно + protocol adapters + request-scoped buffers | Framing разделяет части alias в сыром потоке |
| Метаданные/signatures участвуют в работе API | Сохранять совместимость | Явные text/argument fields и opaque passthrough | Рекурсивная замена всех строк меняет IDs, schemas и подписанные данные |
| API расширяются независимо | Заменять один формат отдельно | Интерфейсы и небольшие модули | Общий большой handler связывает сеть, parser и правила замены |

## Проверка

`npm test` включает `test-protocols`, `test-protocol-transport`, `test-protocol-streams`. Проверяются escaping/variants, manual priority, удаления, headers/query passthrough, metadata/signatures, arguments/results, SSE fragments и parallel tool calls.

`test-composite-replacements` включён в `npm test`, отдельно запускается `npm run test:composite`. В одном prompt все представления проверяются по секциям и склеенными подряд без разделителей, для object/JSON-string API carriers. Требуется полное точное восстановление текста, валидный JSON уровней 1–3, roundtrip nested tool arguments и отсутствие каскадного unmask. Дополнительно проверяются distinct aliases, коллизии и реконструкция после DB reload без изменения schema. Отчёт: `.cache/replacement-composite-regression-report.json`; проверка локальная, cloudCalls = 0.

2026-10-24: подтверждён и исправлен локальный случай chunked JSON. Специальный `node:http` клиент без Content-Length отправлял валидное тело с `Transfer-Encoding: chunked`; после разбора тела прокси передавал старый framing header в новый fetch, Undici отклонял его до обращения к mock upstream (`invalid transfer-encoding header`, Gateway 502). `UpstreamClient` удаляет старые Host/Content-Length, hop-by-hop headers и поля, перечисленные в Connection; HTTP-клиент формирует transport framing для изменённого тела. Для сохранения входящего режима chunked тело передаётся fetch как ReadableStream с `duplex: half`: на HTTP/1.1 исходящий запрос снова chunked без Content-Length. Fixed-length запрос остаётся обычным телом с новой длиной. Native relay сохраняет streaming body при входящем chunked. HTTP/2 не использует Transfer-Encoding: chunked. Authorization и обычные custom headers сохраняются.

Regression в `test-gateway-regressions.ts` проверяет реальную локальную chunked/fixed-length отправку, статус 200, masking и framing обоих режимов; `test-native-transport.ts` проверяет actual loopback HTTP/1.1 framing relay. Это искусственные локальные тесты с нулём cloud calls, не трафик рабочего OpenCode. Исходный repro и промежуточное исправление с Content-Length сохранены в `.cache/deepseek-paid-validation/chunked-local-{repro,after-fix}.json`; итоговое сохранение режима — `chunked-mode-preserved.json`.

Настоящий OpenCode проверяется через отдельный `ghostvault-test/zen-mock`. `GhostVaultE2eRunner` принимает порты, sandbox directory и evidence path; изолированный прогон не останавливает открытый demo и не меняет глобальные providers.

## Источники

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling).
- [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events).
- [Anthropic streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming).
- [Gemini content generation](https://ai.google.dev/api/generate-content).
- Установленный `opencode-antigravity-auth`: `dist/src/plugin/request-helpers.js`, `dist/src/plugin/core/streaming/transformer.js`; читался код плагина, не account/credential files.
