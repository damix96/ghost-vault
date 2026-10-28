# Lifecycle и владение ресурсами

[Раздел](index.md).

Цель — повторный mount/update/dispose не умножает эффекты и не применяет результат к другому объекту. State/resources принадлежат class instance по E; сам stateless template lifecycle не предоставляет.

## Ресурсы

Владелец фиксирует listeners, timers, observers, subscriptions, object URLs, pending tasks и global registrations. Setup имеет обратный cleanup; повторный cleanup безопасен. Не освобождать shared resource, пока у него остаются владельцы.

Если mount упал на середине, освободить уже созданное. Error fallback не превращает частично смонтированный control в «готовый». HMR/remount проходит тот же путь, без отдельного бессрочного listener.

Импорт модуля не запускает fetch/timers и не меняет чужой DOM. Необходимую регистрацию объявить как явный entry effect с ограниченным scope; детали — [modules](../delivery/modules.md).

## Async

Каждая операция имеет owner lifetime и token/generation. Смена entity/dispose обесценивает старый view target. Запоздалые results не записываются в новый editor; исходный controller может отдельно обновить app data/status.

Abort — механизм прекращения ожидания/поддерживаемой работы, не гарантия отката server side effect. Отличать cancel UI, cancel request и business compensation.

Hidden не равно disposed: определить, что приостанавливается, что сохраняется и кто продолжает получать данные. Нельзя оставлять polling в каждом hidden control или терять draft при простом переключении вкладки.

При возвращении из background запросить актуальный snapshot через controller; не объявлять устаревший snapshot live и не перезаписывать dirty поля.

## Update

Стабильные entity keys сохраняют DOM/focus/selection; index списка не identity. Применять минимальные необходимые обновления. Whole-container innerHTML, уничтожающий активную форму, не является механизмом синхронизации.

Измерение и update разделены. Observer/auto-size не должен сам себя бесконечно инициировать; сравнивать geometry до записи, отменять obsolete measurement, проверять изменение шрифта/viewport.

Проверка: два экземпляра, повторный mount/dispose, setup failure, hidden→visible, response после смены entity, resize loop. Наблюдать именно ресурс/поведение, а не повторять implementation в тесте.
