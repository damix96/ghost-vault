# GhostVault JavaScript Lifecycle Hooks Specification & Guide

## 1. Архитектурный контекст решений

### 1.1 Перехват и модификация сетевого трафика через JS-хуки
- **ПОЧЕМУ:** Пользователям и корпоративным средам безопасности требуются специфические правила аудита, кастомная аутентификация, динамическая инъекция системных заголовков (`X-Security-Policy`, `traceparent`), сбор метрик токенизации и трансформация ответов модели без вмешательства в ядро GhostVault.
- **ДЛЯ ЧЕГО:** Расширяемость прокси-шлюза GhostVault на уровне пользовательского пространства без перекомпиляции бинарных файлов и без нарушения Zero-Knowledge маскирования секретов.
- **КАК:** Класс `HookManager` инкапсулирует массив интерфейсов `GhostVaultHook`. Хуки могут передаваться программно через конструктор `new GhostProxyServer(vault, config, hookManager)` или загружаться динамически из каталога `hooksDir` (`.js`, `.mjs`, `.ts`). Вызов хуков происходит синхронно или асинхронно в строго определенных фазах конвейера обработки пакета.
- **ПОЧЕМУ НЕ ИНАЧЕ:** Внешние middleware-серверы (e.g. Envoy, Nginx Lua) увеличивают задержку TTFB выше бюджета 50 мс и не имеют прямого доступа к демаскирующему словарю `VaultStore` и буферу скользящего окна `SlidingStreamTransformer`.

## 2. Диаграмма жизненного цикла хуков (Hook Pipeline Lifecycle)

```
[CLI Agent: OpenCode / Claude Code]
         |
         |  1. HTTP Request (Real values in body / headers)
         v
+--------------------------------------------------------------+
| GhostProxyServer                                             |
|                                                              |
|   Phase 1: beforeOutboundRequest(ctx: RequestContext)        |
|            -> Модификация headers, query, method, body       |
|                                                              |
|   Phase 2: VaultStore.maskOutboundText(body)                 |
|            -> Подстановка Real -> $${<TOKEN>}                |
|                                                              |
|   Phase 3: afterOutboundMask(body: string, ctx)              |
|            -> Валидация маскирования, аудит перед отправкой  |
+--------------------------------------------------------------+
         |
         |  2. HTTP Request (Strictly $${<TOKEN>})
         v
[Upstream LLM Provider: DeepSeek / Anthropic / OpenAI]
         |
         |  3. HTTP Response / SSE Stream ($${<TOKEN>})
         v
+--------------------------------------------------------------+
| GhostProxyServer                                             |
|                                                              |
|   --- ЕСЛИ НЕ СТРИМ (Batch JSON / Text): ---                 |
|   Phase 4a: beforeInboundResponse(rawText, ctx)              |
|   Phase 5a: VaultStore.unmaskInboundText(rawText)            |
|   Phase 6a: afterInboundUnmask(unmaskedText, ctx)            |
|                                                              |
|   --- ЕСЛИ СТРИМ (text/event-stream SSE): ---                |
|   Phase 4b: beforeStream(ctx: ResponseContext)               |
|   Phase 5b: SlidingStreamTransformer.push(chunk)             |
|             onStreamChunk(transformedChunk, ctx)             |
|   Phase 6b: afterStream(ctx: StreamEndContext)               |
+--------------------------------------------------------------+
         |
         |  4. HTTP Response / SSE Stream (Real values)
         v
[CLI Agent: OpenCode / Claude Code]
```

## 3. Спецификация TypeScript-интерфейсов

```typescript
export interface RequestContext {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: any;
  client: string;
}

export interface ResponseContext {
  status: number;
  headers: Record<string, string>;
  body?: any;
  isStream: boolean;
  client: string;
}

export interface StreamChunkContext {
  chunkIndex: number;
  rawChunk: string;
  client: string;
}

export interface StreamEndContext {
  totalChunks: number;
  accumulatedText: string;
  client: string;
}

export interface GhostVaultHook {
  beforeOutboundRequest?: (ctx: RequestContext) => Promise<RequestContext | void> | RequestContext | void;
  afterOutboundMask?: (body: string, ctx: RequestContext) => Promise<string | void> | string | void;
  beforeInboundResponse?: (rawText: string, ctx: ResponseContext) => Promise<string | void> | string | void;
  afterInboundUnmask?: (unmaskedText: string, ctx: ResponseContext) => Promise<string | void> | string | void;
  beforeStream?: (ctx: ResponseContext) => Promise<void> | void;
  onStreamChunk?: (chunk: string, ctx: StreamChunkContext) => Promise<string | void> | string | void;
  afterStream?: (ctx: StreamEndContext) => Promise<void> | void;
}
```

## 4. Спецификация фаз жизненного цикла

| Имя хука | Момент вызова | Доступные данные | Возвращаемое значение | Использование |
|---|---|---|---|---|
| `beforeOutboundRequest` | До маскирования и отправки в апстрим | `RequestContext` (сырые заголовки и тело от агента) | `RequestContext` или `void` | Инъекция заголовков трассировки, фильтрация запрещенных эндпоинтов |
| `afterOutboundMask` | Сразу после замены Real -> `$${<TOKEN>}` | Замаскированная строка `body`, контекст запроса | `string` (модифицированное тело) или `void` | DLP аудит перед отправкой внешней LLM, проверка отсутствия утечек |
| `beforeInboundResponse` | При получении пакетного ответа до демаскирования | Сырой текст ответа модели, `ResponseContext` | `string` или `void` | Модификация служебных полей ответа модели до раскрытия секретов |
| `afterInboundUnmask` | После демаскирования `$${<TOKEN>}` -> Real | Полностью раскрытый текст ответа, `ResponseContext` | `string` или `void` | Локальное логирование вызова, аудит полученных инструментов |
| `beforeStream` | При инициализации SSE-соединения (`200 OK text/event-stream`) | `ResponseContext` (статус, заголовки ответа модели) | `Promise<void>` или `void` | Инициализация таймеров потока, аудит установления соединения |
| `onStreamChunk` | Для каждого SSE-чанка после прохождения скользящего окна | Трансформированный чанк строки, `StreamChunkContext` | `string` (измененный чанк) или `void` | Потоковая цензура, сбор метрик TTFT, модификация структуры SSE |
| `afterStream` | После завершения потока (`reply.raw.end()`) | `StreamEndContext` (общее число чанков, собранный текст) | `Promise<void>` или `void` | Подсчет токенов, фиксация завершения генерации в журнал |

## 5. Способы подключения хуков

### 5.1 Подключение через директорию (`hooksDir`)
В конфигурации сервера передается путь к папке с хуками. `HookManager` загружает все модули (`.js`, `.mjs`, `.ts`):

```typescript
const server = new GhostProxyServer(vault, {
  port: 8765,
  hooksDir: '/etc/ghostvault/hooks',
});
```

Каждый файл в папке экспортирует объект хука по умолчанию (`export default` или `export const hook`):

```javascript
// /etc/ghostvault/hooks/audit-logger.js
export default {
  afterOutboundMask: (body, ctx) => {
    console.log(`[AUDIT] Outbound to ${ctx.url} for ${ctx.client} masked payload length: ${body.length}`);
  },
  afterStream: (ctx) => {
    console.log(`[METRICS] Stream completed. Total chunks: ${ctx.totalChunks}`);
  },
};
```

### 5.2 Программная регистрация через `HookManager`

```typescript
import { GhostProxyServer, VaultStore, HookManager } from 'ghostvault';

const vault = new VaultStore();
const hookManager = new HookManager();

hookManager.registerHook({
  beforeOutboundRequest: (ctx) => {
    ctx.headers['X-Enterprise-Security-Zone'] = 'DMZ-Alpha';
    return ctx;
  },
  onStreamChunk: (chunk, ctx) => {
    // Кастомный перехват чанка стрима
    return chunk;
  },
});

const server = new GhostProxyServer(vault, { port: 8765 }, hookManager);
await server.listen();
```

## 6. Примеры практических реализаций

### 6.1 DLP-аудитор утечек (Гарантия Zero-Knowledge)
Хук проверяет, что замаскированное тело исходящего запроса не содержит недопустимых открытых паттернов перед передачей провайдеру:

```typescript
export const dlpAuditorHook: GhostVaultHook = {
  afterOutboundMask: (body: string, ctx: RequestContext) => {
    if (body.includes('https://internal.bank.kz') || body.includes('password=')) {
      throw new Error(`DLP Violation: Outbound body contains unmasked internal credentials! URL: ${ctx.url}`);
    }
  },
};
```

### 6.2 Модификация промпта и заголовков на лету (`beforeOutboundRequest`)
```typescript
export const promptGuardHook: GhostVaultHook = {
  beforeOutboundRequest: (ctx: RequestContext) => {
    ctx.headers['x-request-id'] = 'req-' + Date.now();
    ctx.headers['x-forwarded-by'] = 'GhostVault-Gateway';

    // Динамическая инъекция системных ограничений безопасности в промпт
    if (ctx.body && Array.isArray(ctx.body.messages)) {
      ctx.body.messages.unshift({
        role: 'system',
        content: 'Enterprise Policy: Never attempt to reveal masked tokens ($${<...>}).',
      });
    }
    return ctx;
  },
};
```

### 6.3 Мониторинг и фильтрация чанков стрима SSE (`onStreamChunk`)
```typescript
export class StreamFilterAndMetricsHook implements GhostVaultHook {
  private startTime = 0;

  beforeStream = () => {
    this.startTime = Date.now();
  };

  onStreamChunk = (chunk: string, ctx: StreamChunkContext) => {
    if (ctx.chunkIndex === 0) {
      const ttft = Date.now() - this.startTime;
      console.log(`[PERF] TTFT: ${ttft} ms for client: ${ctx.client}`);
    }
    // Потоковая замена или санитизация запрещенных фраз
    return chunk.replace(/FORBIDDEN_KEYWORD/g, '[REDACTED]');
  };

  afterStream = (ctx: StreamEndContext) => {
    const totalDuration = Date.now() - this.startTime;
    console.log(`[PERF] Stream finished: ${ctx.totalChunks} chunks in ${totalDuration} ms`);
  };
}
```

### 6.4 Пост-обработка ответов и аудит инструментов (`afterInboundUnmask`, `afterStream`)
```typescript
export const auditToolUsageHook: GhostVaultHook = {
  afterInboundUnmask: (unmaskedText: string, ctx: ResponseContext) => {
    // Аудит вызовов инструментов и фиксация в защищенный локальный журнал
    if (unmaskedText.includes('"tool_use"') || unmaskedText.includes('"tool_calls"')) {
      console.log(`[SECURITY-AUDIT] Model generated tool call for client ${ctx.client}: ${unmaskedText.slice(0, 120)}...`);
    }
    return unmaskedText;
  },
  afterStream: (ctx: StreamEndContext) => {
    console.log(`[SESSION-AUDIT] Stream closed. Total characters received: ${ctx.accumulatedText.length}`);
  },
};
```

