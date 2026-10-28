# GhostVault
Zero-Knowledge AI Security & Privacy Gateway for Corporate Environments.

GhostVault — локальный шлюз безопасности для работы AI CLI-агентов (Claude Code, Antigravity, Cursor, OpenCode, Aider) в корпоративных сетях с DLP-инспекцией, приватными данными и EDR-ограничениями.

## Проблемы и архитектурные решения

| Проблема | Причина | Решение GhostVault | Гарантия |
|---|---|---|---|
| Блокировка промптов корпоративным DLP | Передача внутренних URL, IP и токенов в облачный API | Zero-Knowledge Symbolic Variables (`$${<NAME>}`): исходящие секреты заменяются псевдонимами, реальные значения подставляются локально перед исполнением тулов | Модель и снифферы сети не видят открытых секретов |
| Overfetching (избыточный вывод Vault/БД) | Команды возвращают полные дампы секретов и схем | Cache-Inspect-Get Pipeline + `__as_json`: сырой вывод изолируется в локальном кеше, модели отдается только структурная схема типов | Нулевой объем нецелевых секретов в контексте LLM |
| Задержки и блокировки EDR/антивирусов | Частый spawn короткоживущих процессов | Persistent Execution Sessions: поддержание долгоживущих процессов вместо повторного создания | Исключение сканирования процессов при каждом вызове |
| Песочница CLI (`CREATE_NO_WINDOW`) | CLI-агенты запускают процессы без оконной станции (`winsta0`) | Windows Task Scheduler Breakout: запуск модальных окон подтверждения через `schtasks` без прав администратора | Доступ к активному экрану пользователя для ввода паролей и подтверждений |

## Архитектура системы

```
 [ AI CLI / IDE ]                    [ Локальная ОС / Внутренняя сеть ]
 (Claude Code, Cursor)               (Bash, PowerShell, Vault, DB)
           │                                        ▲
           │ HTTP (BASE_URL)                        │ Реальные вызовы
           ▼                                        ▼
┌────────────────────────────────────────────────────────────────────────┐
│                   GHOSTVAULT (SINGLETON DAEMON)                        │
│                                                                        │
│  ┌─────────────────────────┐         ┌──────────────────────────────┐  │
│  │   LLM Reverse Proxy     │         │     Cache & Data Filter      │  │
│  │  • Real -> $${<NAME>}   │         │  • Изоляция ответов в кеш    │  │
│  │  • $${<NAME>} -> Real   │         │  • Схема типов без значений  │  │
│  │  • Sliding window SSE   │         │  • field__as_json парсер     │  │
│  └───────────┬─────────────┘         └──────────────┬───────────────┘  │
│              │                                      │                  │
│              ▼                                      ▼                  │
│  ┌──────────────────────────────────────────────────────────────────┐  │
│  │             Secret Vault & Interactive Confirmation              │  │
│  │  • Two-Tier Storage (Auto Vault vs Manual Vault)                 │  │
│  │  • Native WPF Modal via Task Scheduler (Zero Admin Rights)       │  │
│  │  • Pre-computed Formats Index (Raw, URL, JSON-escape, Base64)    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
└────────────────────────────────────────────────────────────────────────┘
           │
           │ Промпты с псевдонимами $${<NAME>}
           ▼
    [ Внешняя LLM ] (Anthropic / OpenAI)
```

## Документация (Drafts & Specs)

- [AGENTS.md](./AGENTS.md) — правила и инварианты для AI-агентов.
- [engineering-style.md](./engineering-style.md) — стандарты кода, библиотечный стек и ограничения.
- [documentation-style.md](./documentation-style.md) — стандарты Agent-First документации и Zero Semantic Loss.
- [docs/master-spec.md](./docs/master-spec.md) — мастер-спецификация протоколов и задержек.
- [docs/core-architecture.md](./docs/core-architecture.md) — архитектура ядра, синглтон-демон и паттерн micro-MCP.
- [docs/zero-knowledge-tokens.md](./docs/zero-knowledge-tokens.md) — спецификация `$${<NAME>}`, round-trip цикл и Prompt Caching.
- [docs/cache-data-minimization.md](./docs/cache-data-minimization.md) — пайплайн Cache-Inspect-Get и виртуальная ветка `__as_json`.
- [docs/windows-gui-hacks.md](./docs/windows-gui-hacks.md) — обход изоляции окон через `schtasks` и нативный WPF.
- [docs/vault-and-monitoring.md](./docs/vault-and-monitoring.md) — двухуровневое хранилище и дашборд сессий.
- [docs/roadmap.md](./docs/roadmap.md) — этапы разработки и файловая структура.
