# GhostVault E2E Test Report: OpenCode CLI & Zero-Knowledge In-Flight Masking

## 1. Сводка результатов тестирования

| Тестовый сценарий | Ожидаемый результат | Фактический результат | Статус |
|---|---|---|---|
| Zero-Knowledge Outbound Masking | URL `http://127.0.0.1:9099/internal-bank` заменен на `$${<BANK_URL>}` в запросе к LLM | В теле запроса к LLM зафиксирован токен `$${<BANK_URL>}`; открытый URL отсутствует (0 байт) | PASSED |
| Inbound Tool Unmasking | Токен `$${<BANK_URL>}` в SSE стриме раскрыт в реальный URL перед передачей агенту | Агент получил вызов `curl.exe -s http://127.0.0.1:9099/internal-bank` | PASSED |
| Real Target Hit | Целевой внутренний банковский сервис принимает сетевой запрос от локального процесса | Mock Bank Server (порт 9099) зафиксировал HTTP GET `/internal-bank` от `curl/8.13.0` со статусом 200 | PASSED |
| Streaming SSE Integrity | Целостность Server-Sent Events потока сохранена при посимвольной фильтрации через скользящее окно | OpenCode успешно распарсил все SSE чанки, выполнил tool_use и сформировал финальный ответ | PASSED |
| Dashboard & Last Call Inspector | Эндпоинт `/api/vault` и Web UI отображают перехваченный вызов | `/api/vault` вернул запись `lastCall` с `direction: "outbound"`, `alias: "$${<BANK_URL>}"`; HTML `/dashboard` валиден | PASSED |
| Регрессионное тестирование | Обратная совместимость с Claude Code (`/v1/messages`) | Сьют `dist/test-server.js` (Non-stream, SSE stream, Vault CRUD) прошел с кодом 0 | PASSED |

Общий статус E2E тестирования: **100% SUCCESS (6/6 checks passed)**.

## 2. Контекст решений и верификации

### 2.1 Изоляция Outbound сетевого периметра
- **ПОЧЕМУ:** При использовании облачных моделей (DeepSeek, OpenAI, Anthropic) передача внутренних URL адресов и токенов авторизации приводит к компрометации защищенного периметра предприятия и нарушению стандартов DLP/SOC2.
- **ДЛЯ ЧЕГО:** Обеспечение абсолютной конфиденциальности локальной сетевой топологии (Zero-Knowledge): модель знает о существовании ресурса только как абстрактной переменной `$${<BANK_URL>}`.
- **КАК:** На уровне Fastify-прокси исходящий поток запроса сканируется по предвычисленному индексу `VaultStore` (`raw`, `urlEncoded`, `jsonEscaped`). Реальный URL подменяется до отправки в сокет внешней модели.
- **ПОЧЕМУ НЕ ИНАЧЕ:** Любая попытка локальной фильтрации на уровне bash-скриптов или плагинов агента ненадежна: агент отправляет системный промпт и контекст напрямую через сетевой стек Node/Bun, минуя локальную песочницу.

### 2.2 In-Flight Inbound демаскирование для инструментов
- **ПОЧЕМУ:** Если модель возвращает сгенерированную команду с псевдонимом `curl $${<BANK_URL>}`, стандартные утилиты ОС (`curl.exe`, `Invoke-RestMethod`, `fetch`) завершатся ошибкой `Could not resolve host: $${<BANK_URL>}`.
- **ДЛЯ ЧЕГО:** Прозрачное выполнение системных команд без необходимости модификации исходного кода CLI-агента или бинарных файлов утилит.
- **КАК:** GhostProxyServer перехватывает SSE-поток чанков ответа модели. `OpenAiSseHandler` буферизует аргументы функции до момента готовности блока или конца стрима, производит замену `$${<BANK_URL>}` -> `http://127.0.0.1:9099/internal-bank` и передает клиенту полностью готовые для исполнения аргументы.
- **ПОЧЕМУ НЕ ИНАЧЕ:** Замена псевдонима внутри запущенного процесса PowerShell/Bash через wrapper-скрипт требует глобального перехвата системных вызовов (API hook / LD_PRELOAD), что приводит к нестабильности на Windows и конфликтам с EDR-системами.

## 3. Точные сетевые дампы и артефакты

### 3.1 Outbound Request к DeepSeek LLM (Зафиксировано на порту 9098)
Ниже приведен фрагмент входящего JSON тела, полученного апстрим-моделью. Реальный адрес банковского API замаскирован.

```json
{
  "model": "deepseek-v4-flash",
  "max_tokens": 32000,
  "top_p": 0.95,
  "messages": [
    {
      "role": "user",
      "content": "\"Fetch balance from $${<BANK_URL>}\"\n \r\n"
    }
  ],
  "tools": [
    {
      "type": "function",
      "function": {
        "name": "bash",
        "description": "Executes a given Windows PowerShell (5.1) command with optional timeout..."
      }
    }
  ],
  "stream": true,
  "stream_options": {
    "include_usage": true
  }
}
```

Флаг утечки сырого URL: `rawUrlLeakedToLlm = false` (строка `http://127.0.0.1:9099/internal-bank` не обнаружена во всем теле запроса).

### 3.2 Inbound SSE Stream от DeepSeek LLM к GhostVault
Ответ апстрима, содержащий псевдоним:

```text
data: {"id":"chatcmpl-cmd","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"role":"assistant","content":null,"tool_calls":[{"index":0,"id":"call_bash_001","type":"function","function":{"name":"bash","arguments":"{\"command\": \"curl.exe -s $${<BANK_URL>}\"}"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-cmd","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

### 3.3 Inbound SSE Stream после демаскирования GhostVault к OpenCode
Стрим, поступивший в процесс `opencode`:

```text
data: {"id":"chatcmpl-cmd","object":"chat.completion.chunk","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"command\": \"curl.exe -s http://127.0.0.1:9099/internal-bank\"}"}}]},"finish_reason":null}]}

data: {"id":"chatcmpl-cmd","object":"chat.completion.chunk","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}

data: [DONE]
```

### 3.4 Выполнение инструмента в среде OpenCode (Event Log)
Фрагмент журнала событий OpenCode (`--format json`):

```json
{
  "type": "tool_use",
  "timestamp": 1790711216828,
  "sessionID": "ses_f114b4d75ffehvXAvSGOClLrq8",
  "part": {
    "type": "tool",
    "tool": "bash",
    "callID": "call_bash_001",
    "state": {
      "status": "completed",
      "input": {
        "command": "curl.exe -s http://127.0.0.1:9099/internal-bank"
      },
      "output": "{\"status\":\"ok\",\"account\":\"KZ-PRIV-9912\",\"balance\":1450000.5,\"currency\":\"USD\",\"holder\":\"GhostVault Internal Asset\",\"timestamp\":\"2026-09-29T19:46:56.808Z\"}",
      "exit": 0,
      "truncated": false
    },
    "title": "curl.exe -s http://127.0.0.1:9099/internal-bank"
  }
}
```

Финальный ответ агента:
```json
{
  "type": "text",
  "part": {
    "text": "Balance for KZ-PRIV-9912 is 1450000.50 USD."
  }
}
```

### 3.5 Запись сетевого вызова на целевом сервисе (Mock Bank Port 9099)
Сервер банка зафиксировал прямое обращение:
- Endpoint: `GET /internal-bank`
- User-Agent: `curl/8.13.0`
- Host: `127.0.0.1:9099`
- HTTP Status: `200 OK`
- Payload:
  ```json
  {
    "status": "ok",
    "account": "KZ-PRIV-9912",
    "balance": 1450000.50,
    "currency": "USD",
    "holder": "GhostVault Internal Asset"
  }
  ```

### 3.6 Состояние Last Call Inspector в Web Dashboard
Запрос `GET http://127.0.0.1:8765/api/vault`:

```json
{
  "manual": [
    {
      "key": "BANK_URL",
      "realValue": "http://127.0.0.1:9099/internal-bank",
      "alias": "$${<BANK_URL>}",
      "maskInAi": true
    }
  ],
  "auto": [],
  "lastCall": {
    "direction": "outbound",
    "client": "OpenCode",
    "timestamp": "00:50:08",
    "rawUrl": "http://127.0.0.1:9099/internal-bank",
    "alias": "$${<BANK_URL>}",
    "key": "BANK_URL"
  },
  "maskedCount": 1
}
```

## 4. Инструкция по воспроизведению стенда

1. Сборка проекта:
   ```bash
   cd ghostvault
   npm run build
   ```
2. Запуск полного сквозного E2E тестирования с реальным CLI-агентом OpenCode:
   ```bash
   npm run test:e2e
   ```
3. Запуск модульного сьюта проверки совместимости с Claude Code:
   ```bash
   npm test
   ```

Все тесты детерминированы, автономны и завершаются с кодом возврата `0`.
