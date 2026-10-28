# События и повторный вход

[Раздел](index.md).

Почему: скрытый порядок обновления и событий создаёт двойные действия и циклы. Цель — один понятный user intent с воспроизводимым результатом.

## Public event contract

Для события указать: occurrence или request, payload, момент, source, bubbling/composed/cancelability и effect отмены. Не сообщать DOM-node вместо устойчивого entity/value. Объекты события не содержат случайные реальные секреты.

Логический payload изменения: идентификатор поля/объекта, proposed value, причина (`input`, `clear`, `reset` при поддержке), instance/generation по задаче. Реальные имена/types 0.1.0 — в [каталоге](catalog.md); не каждый логический атрибут обязателен в каждом событии.

- Controlled input: сообщить предложение; принятую модель обновляет consumer. Не мутировать переданные props.
- Uncontrolled: обновить локальный draft, затем отправить согласованное notification.
- Программное применение props не изображает новый user input; не эхо-рассылать change при каждом render.
- Reset/clear semantics явны: не порождать два конкурирующих события об одном изменении.
- Consumer вправе синхронно изменить props из handler. После dispatch повторно проверить generation/current state, не продолжать действие по старому snapshot.

## Actions

Одна активация — один intent. Нельзя одновременно вызывать callback в pointer handler и ещё раз на `click`/native submit. Pending/error относятся к конкретному operation, не глобальному любому action.

Обычная кнопка не перехватывает Enter формы, hint не отбирает её primary action. Бизнес-операция не прячется в render/formatter/getter.

Для action в кликабельной строке выбрать одну dispatch-границу: row handler игнорирует вложенные interactive targets; кнопка выполняет своё действие. Без blanket `stopPropagation` на всём контейнере: оно ломает labels, tooling и вложенные элементы.

## Native/shadow events

Использовать `currentTarget` для владельца обработчика, не предполагать, что `target` всегда исходный внутренний узел. В Shadow DOM учитывать retargeting и composed path; consumer не ищет private internals селектором.

Public custom event пересекает границу только по принятому контракту. Не делать все внутренние events composed/bubbling ради удобства. Подписки освобождает владелец lifecycle.

`gv-hint-state` — публичный readonly snapshot, не доступ к HintState model. Повтор одной mode не уведомляет; [обновление последнего вызова и cleanup](../interaction/overlays.md) используют актуальное состояние view, а не необслуживаемый boolean/counter.

Основание механики: [DOM events](https://dom.spec.whatwg.org/#events). Контракт нашего event API и порядок business effects — решение kit/app owners, не правило браузера.

Проверка: input→sync props update, clear/reset, pointer+keyboard, nested action, prevented request, два экземпляра, shadow boundary и повторный mount.
