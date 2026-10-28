# Concurrent edits, cancel и Undo

[Раздел](index.md).

Почему: локальный promise и browser tab не определяют состояние общего сервера. Цель — применять подтверждённый результат к правильному объекту и честно обозначать границы гарантий.

## Несколько вкладок/клиентов

Controller приложения владеет transport, snapshots и concurrency policy. Kit отображает переданные baseline/draft/conflict/pending states; не создаёт собственный global store, BroadcastChannel или API revisions без задачи.

Update из другой вкладки не является user input: не запускать autosave/change notification как эхо. Сравнивать entity и известную revision/base snapshot; dirty draft сохранять отдельно.

Если backend поддерживает optimistic concurrency, отправлять предусмотренную им revision и обрабатывать конфликт. Если revision/compare-and-set нет, read-before-save и polling лишь best effort: между чтением и записью возможна гонка. Не обещать предотвращение lost updates, не изобретать endpoint/ETag.

Объект изменён во время save: результат привязать к operation/entity/base revision. Изменённый после отправки draft не объявлять saved. Объект удалён другим клиентом: прекращение доступных действий по реальному API, а не автоматическое создание похожей записи.

## Cancel и поздний результат

| Действие | Что означает |
|---|---|
| Закрыть editor | Убрать представление; операция может продолжаться |
| Прервать ожидание/запрос | Только поддерживаемая cancellation; side effect мог выполниться |
| Отменить бизнес-изменение | Отдельная предусмотренная операция/compensation |
| Локальный Undo | Возврат draft/history; не отмена server save/delete |

Поздний success не обновляет закрытую форму/новый объект. Controller может обновить общий snapshot и scoped result. Сообщение содержит объект/действие без real secret; не перехватывает чужой focus. Поздний failure не портит новый draft.

## Optimistic update

Перед provisional change сохранить точную baseline и operation identity. На failure откатывать только если текущая версия ещё соответствует этому provisional change. Если за ним уже пришло другое изменение, не восстанавливать вслепую старый snapshot: refetch/reconcile или conflict по domain policy.

Успех фиксирует возвращённый/подтверждённый snapshot. При неизвестном результате не повторять side effect автоматически, если idempotency не известна. Busy предотвращает лишнюю локальную активацию, но не заменяет server guarantees.

Проверка: A/B clients, B update между read/save A, close→success, close→failure, optimistic A→newer B→failure A. Нельзя считать один успешный promise доказательством сохранности всех изменений.
