# Модели состояния 0.1.0

[Раздел](index.md) · [Компоненты](catalog.md) · [Concurrency](../interaction/concurrency.md).

Модели не зависят от DOM/сети, доступны из main entry и отдельных `@ghostvault/ui-kit/models`, `/clipboard`, `/hint-state`. Данные synthetic в [контрактных тестах](../../../ui-kit/tests/models.test.mjs). Обычные поля состояния читать, изменения выполнять методами: прямое изменение draft/baseline/pending обходит контракт.

## EditorSession

```ts
import { EditorSession, type Fields, type SaveTicket } from '@ghostvault/ui-kit/models';

const editor = new EditorSession('route-id', { upstream: 'https://example.invalid' });
editor.set('upstream', 'https://draft.invalid');
const ticket = editor.begin();
editor.complete(ticket, ticket.values);
```

`Fields = Readonly<Record<string,string>>`; `SaveTicket` содержит readonly `entity/generation/version/operation/values`. Snapshot и его values заморожены. Это плоская модель строковых форм, не произвольный JSON-form framework.

| Метод | Контракт |
|---|---|
| `new EditorSession(entity, values)` | Клонирует values в draft и baseline; не alias чужого object |
| `set(key, value)` | Без trim; только изменившаяся строка увеличивает draft version и очищает старую ошибку |
| `dirty(): boolean` | Сравнивает keys/values draft с baseline |
| `select(entity, values)` | Новый контекст/generation; очищает pending/conflict/error, старые completions отвергаются |
| `observe(values)` | Без dirty/pending обновляет baseline+draft; иначе сохраняет draft, отмечает conflict при расхождении remote с baseline |
| `begin(): SaveTicket` | Один pending save, повтор отвергается; snapshot соответствует моменту отправки |
| `complete(ticket, saved=ticket.values): boolean` | Только свой pending ticket; baseline подтверждается, newer draft сохраняется |
| `fail(ticket, message): boolean` | Только свой ticket; ошибка старой версии не помечает новую draft ошибочной |
| `reset()` | Возвращает draft к baseline, отменяет владение pending ticket |
| `close()` | Инвалидирует pending completion; не отменяет HTTP и не удаляет consumer listeners |

Состояния: `entity`, `draft`, `baseline`, `pending=false`, `conflict=false`, `error=''`, `generation=0`. Модель не reactive: consumer после метода вызывает собственный update. Она не хранит remote revision, не делает merge и не гарантирует atomic concurrency. `AbortController`/If-Match/API error mapping остаются у controller. После `gv-close` вызвать `close()` сразу; disconnect тоже инвалидирует модель.

## ClipboardTask

```ts
import { ClipboardTask } from '@ghostvault/ui-kit/clipboard';

const copy = new ClipboardTask(value => navigator.clipboard.writeText(value));
const copied = await copy.copy('payload-id:revision', '  exact raw text\n');
copy.dispose();
```

`ClipboardWriter = (value:string) => Promise<void>`. `copy(source,value): Promise<boolean>` захватывает raw строку, state `idle→pending→copied/failed`; второй pending reject. Ошибка writer → false, не secret-bearing diagnostic. `dispose()` меняет generation, сбрасывает `idle/source`; прежний completion возвращает false и не публикует state. Системную запись отменить нельзя; consumer не объявляет stale result успехом нового объекта.

## HintState

`mode: 'closed' | 'preview' | 'pinned'`, default closed. `preview()` открывает closed; `leave()` закрывает только preview; `pin()` переключает pinned/closed; `close()` закрывает всегда; `active()/pinned()` читают состояние. Placement/ARIA/focus/listeners принадлежат `GvHint`, не модели. Она не создаёт глобальный popup manager или сеть.

`HintViewState` — readonly snapshot type. Для уже смонтированного `gv-hint` consumer использует его `readState()/hide()/gv-hint-state`, не создаёт вторую модель и не читает private state; [контракт](catalog.md).
