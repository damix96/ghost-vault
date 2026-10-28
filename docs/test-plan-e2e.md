# GhostVault E2E Test Plan: OpenCode CLI & Zero-Knowledge In-Flight Masking

## 1. Цели тестирования

Верификация сквозного жизненного цикла сетевой изоляции секретов при работе автономного CLI-агента OpenCode с языковой моделью `deepseek-v4-flash` через прокси GhostVault.

| Цель | Инвариант проверки | Метрика успеха |
|---|---|---|
| Zero-Knowledge Outbound Masking | Исходящий JSON-пейлоад к LLM не содержит открытых значений секретов | Все вхождения `http://127.0.0.1:9099/internal-bank` строго заменены на `$${<BANK_URL>}` |
| Inbound Tool Call Unmasking | Стриминговый или пакетный ответ модели с `$${<BANK_URL>}` прозрачно раскрывается перед передачей в среду исполнения агента | Аргумент инструмента (`curl`, `bash`, `powershell`) получает реальный URL `http://127.0.0.1:9099/internal-bank` |
| Real Target Hit | Целевой внутренний сервис принимает реальный сетевой трафик от локального агента | Мок банковского сервиса фиксирует HTTP GET `/internal-bank` со статусом 200 |
| Streaming SSE Integrity | Буфер скользящего окна (`SlidingStreamTransformer`) и сборщик SSE чанков не нарушают целостность потока | Поток `text/event-stream` декодируется без ошибок синтаксиса, задержка окна <= 64 символа |
| Dashboard Visibility | UI-инспектор перехвата фиксирует событие маскирования | Эндпоинт `/api/vault` возвращает запись `lastCall` с метаданными вызова для отображения в Last Call Inspector |

## 2. Контекст архитектурных решений

### 2.1 Двустороннее преобразование в потоке
- **ПОЧЕМУ:** CLI-агенты вызывают локальные команды ОС на основе ответов LLM. Если модель видит реальный URL, данные утекли во внешний периметр. Если агент исполняет псевдоним `$${<NAME>}`, вызов `curl $${<NAME>}` завершится ошибкой DNS/сетевого резолвинга.
- **ДЛЯ ЧЕГО:** Гарантия Zero-Knowledge для LLM-провайдера при сохранении 100% работоспособности локальных инструментов.
- **КАК:** На исходящем плече (Agent -> Proxy) выполняется пре-трансляция через индекс предвычисленных форматов (`raw`, `urlEncoded`, `jsonEscaped`). На входящем плече (LLM -> Proxy -> Agent) выполняется детекция токенов `$${<IDENTIFIER>}` и подстановка реального значения в потоке SSE или JSON-теле.
- **ПОЧЕМУ НЕ ИНАЧЕ:** Замена пост-фактум в системном выводе или bash-оболочке не защищает от утечек через параметры командной строки и переменные окружения, перехватываемые внешними трассировщиками процесса.

### 2.2 Поддержка протоколов агентов (OpenAI / Anthropic)
- **ПОЧЕМУ:** OpenCode использует протокол OpenAI Chat Completions (`/v1/chat/completions`) для шлюза `opencode-go`, тогда как классические CLI-агенты (Claude Code) используют Anthropic Messages API (`/v1/messages`).
- **ДЛЯ ЧЕГО:** Универсальная совместимость шлюза с широким спектром инструментов разработки без модификации бинарников агентов.
- **КАК:** GhostProxyServer маршрутизирует оба эндпоинта (`/v1/messages` и `/v1/chat/completions`), применяя идентичную подсистему `VaultStore` для поиска и демаскирования.
- **ПОЧЕМУ НЕ ИНАЧЕ:** Принуждение агента к трансляции протокола на клиенте требует плагинов, нарушающих воспроизводимость в production-песочницах.

## 3. Архитектура тестового стенда

```
+-----------------------------------------------------------------------------------+
| E2E Test Suite Orchestrator                                                       |
|                                                                                   |
|  1. Start Mock Bank Target Server (Port 9099)                                     |
|     - Endpoint: GET /internal-bank                                                |
|     - Response: 200 {"status":"ok","balance":1000000,"account":"KZ888"}          |
|                                                                                   |
|  2. Start Mock Upstream LLM Server (Port 9098)                                    |
|     - Emulates deepseek-v4-flash on /v1/chat/completions and /v1/messages        |
|     - Validates: Incoming prompt contains $${<BANK_URL>}, NOT raw URL             |
|     - Responds: Tool call with argument $${<BANK_URL>}                           |
|                                                                                   |
|  3. Start GhostProxyServer (Port 8765)                                            |
|     - Vault populated with: BANK_URL -> http://127.0.0.1:9099/internal-bank       |
|     - Target API Base: http://127.0.0.1:9098                                      |
|                                                                                   |
|  4. Execute OpenCode CLI in Isolated Sandbox                                      |
|     - Config: opencode.json pointing to http://127.0.0.1:8765/v1                  |
|     - Command: opencode run "Fetch internal bank balance" --model ... --auto      |
|                                                                                   |
|  5. Collect & Verify Invariants                                                   |
|     - Verify Outbound LLM payload log: raw URL absent, alias present             |
|     - Verify Inbound Tool execution: agent calls curl/fetch with raw URL          |
|     - Verify Target hit: Mock Bank received HTTP GET from agent                   |
|     - Verify Dashboard API: /api/vault reports lastCall                           |
+-----------------------------------------------------------------------------------+
```

## 4. Спецификация тестовых сценариев

### Сценарий 1: Управление секретами и API хранилища
1. Выполнить `POST /api/vault/secret` с телом:
   ```json
   {
     "key": "BANK_URL",
     "realValue": "http://127.0.0.1:9099/internal-bank",
     "description": "Internal Banking Core API"
   }
   ```
2. Проверить ответ `200 OK`, генерацию алиаса `$${<BANK_URL>}` и 4 предвычисленных форматов (`raw`, `urlEncoded`, `jsonEscaped`, `base64`).
3. Запросить `GET /api/vault` и удостовериться в наличии секрета в ручном списке.

### Сценарий 2: Outbound Masking перехват
1. Агент отправляет запрос `POST /v1/chat/completions` со строкой `Access balance at http://127.0.0.1:9099/internal-bank`.
2. GhostProxyServer перехватывает тело, производит строковую замену по словарю `VaultStore`.
3. Мок-сервер апстрима (`deepseek-v4-flash`) получает запрос.
4. Валидация: тело апстрима содержит `Access balance at $${<BANK_URL>}` и не содержит `http://127.0.0.1:9099/internal-bank`.

### Сценарий 3: Inbound Tool Unmasking и Real Target Hit
1. Мок-сервер апстрима возвращает SSE поток `chat.completion.chunk` с `tool_calls`:
   ```json
   {
     "name": "bash",
     "arguments": "{\"command\":\"curl -s http://127.0.0.1:9099/internal-bank\"}"
   }
   ```
   где в ответе LLM сгенерирован токен:
   `curl -s $${<BANK_URL>}`
2. GhostProxyServer перехватывает поток/ответ и заменяет `$${<BANK_URL>}` на `http://127.0.0.1:9099/internal-bank`.
3. OpenCode принимает аргументы инструмента и выполняет команду в PowerShell/Bash.
4. Сервер банка на порту 9099 принимает HTTP запрос и отвечает телом баланса.
5. Валидация: счетчик запросов целевого сервиса равен 1, в заголовках зафиксирован User-Agent вызова.

### Сценарий 4: Верификация Last Call Inspector в Web Dashboard
1. Выполнить запрос `GET /api/vault`.
2. Проверить структуру `lastCall`:
   - `direction`: `"outbound"` или `"inbound"`
   - `rawUrl`: `"http://127.0.0.1:9099/internal-bank"`
   - `alias`: `"$${<BANK_URL>}"`
   - `key`: `"BANK_URL"`
3. Проверить HTML-инспектор `/dashboard`: разметка карточки содержит правильные индикаторы направления и кнопки Promote/Copy.

## 5. Протоколы и форматы тестовых сообщений

### 5.1 Формат OpenAI Chat Completions (OpenCode Go)
```typescript
interface ChatCompletionRequest {
  model: string;
  messages: Array<{
    role: 'system' | 'user' | 'assistant';
    content: string;
  }>;
  tools?: Array<{
    type: 'function';
    function: {
      name: string;
      description: string;
      parameters: Record<string, unknown>;
    };
  }>;
  stream?: boolean;
}
```

### 5.2 Формат ответа Target Mock
```typescript
interface BankAccountResponse {
  status: 'ok';
  accountId: string;
  balance: number;
  currency: 'USD';
  timestamp: string;
}
```

## 6. Критерии приемки (Definition of Done)
1. Все 4 сценария выполняются полностью автоматически без ручного вмешательства.
2. Протокол тестирования сохраняется в `docs/test-report-e2e.md` с точными дампами тел сетевых пакетов.
3. 0 открытых вхождений `http://127.0.0.1:9099/internal-bank` в логах апстрим-модели.
4. Целевой мок-сервис подтверждает получение демаскированного запроса.
5. Отсутствие регрессий в существующих модулях GhostVault.
