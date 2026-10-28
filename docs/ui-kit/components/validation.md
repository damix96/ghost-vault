# Валидация и ошибки

[Раздел](index.md).

Почему: один «error» flag не различает невалидный draft, старый server response и сетевой сбой. Цель — привязать сообщение к правильному объекту/значению и дать восстановление без потери ввода.

## Владение

Primitive проверяет свой supported type/interaction invariant. Domain/controller задаёт business constraints и server validation. Kit не объявляет неизвестную бизнес-проверку пройденной и не изобретает endpoint проверки.

Поле связывает error через доступное описание; критический смысл виден текстом, не только цветом. Summary формы ссылается на ошибочные поля. Pending/invalid/disabled/read-only различаются; их допустимые сочетания указаны в контракте.

## Время и зависимости

- Не превращать неполный ввод в ошибку сохранения на каждую клавишу. Validation timing (`input`, `blur`, `submit`) выбирается с понятным UX.
- Для зависимых полей описать directed dependencies. Изменение A может инвалидировать B; не сбрасывать B молча и не пересчитывать несвязанные поля без причины.
- Async check запоминает entity, field, value/draft revision и operation token. Применить результат только при совпадении актуальной редакции.
- Abort/ignore позднего ответа не означает, что server обязательно остановил проверку. После unmount обновлять исчезнувший control нельзя.

## Server и save

Mapping server fields→controls задан domain. Нераспознанная ошибка остаётся form-level текстом без потери исходных рабочих данных. Не подставлять весь sensitive response в UI/log.

Ошибка save относится к конкретному draft/operation. Если пользователь уже исправил значение, старый ответ не делает новое поле invalid. Видимый saved status относится к подтверждённому snapshot, а не любому завершившемуся promise.

Несколько ошибок: локальная field error рядом с полем; form error для общего action; background refresh error рядом со статусом свежести. Background error не закрывает editor/не перекрывает ввод глобальным overlay.

Retry не запускается render-циклом и не повторяет изменяющую операцию без известной семантики. Пользователь видит, что осталось сохранённым/несохранённым; busy снимается при успехе, failure, cancellation и disposal по владельцу операции.

Проверка: поздняя validation A после ввода B, dependent field, unmapped server error, save старой редакции, несколько ошибок, background refresh во время ввода. См. [concurrency](../interaction/concurrency.md).
