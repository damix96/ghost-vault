# Представление данных

[Раздел](index.md).

Почему: prettify, truncation и локализация могут изменить то, что пользователь считает исходными данными. Цель — разделить value, readable view, preview и transfer source.

## Источники

Domain передаёт representation identity: объект/вызов, стадия/режим, snapshot revision и известные ограничения. Kit не реконструирует недоступный original из masked data и не выводит источник по похожему имени.

По [UX](../../frontend-ux-guide.md): CLI→GhostVault, GhostVault→провайдер и GhostVault→CLI различаются; сохранённый body может быть уже изменён hook/API. Не обещать raw HTTP или внутренний контекст модели.

## Readable / raw / preview

- Прочитанный known block сохраняет доступ к остальным полям; unknown/nontext block показывает тип и раскрываемую сохранённую структуру.
- Preview может быть ограничен, но это помечено. Полное значение не заменяется shortened string в модели, copy или файле.
- Prettified JSON и original text — разные источники. Действие copy называет один из них; не заявлять побайтовую точность после parse/stringify/normalization.
- Syntax highlighting/line numbers/decorations являются view-only. Их markup/префиксы не входят в value.
- Невидимые символы можно показывать отдельным representation с явным label; реальное значение не исправляется молча.
- Сохранять tabs/newlines в переносимом тексте. Browser selection/copy формат может отличаться; для точного значения использовать explicit copy action.

Locale formatting дат/чисел применяется к view, не к machine payload. Не превращать timestamp/id/счётчик в текст, который потом используется вместо исходных данных. Для больших чисел учитывать lossless boundary из [values](../components/values.md).

## Большие/глубокие данные

Раскрывать структуры постепенно и ограничивать DOM work, а не удалять поля. Полное исходное содержимое остаётся в известном источнике; partial rendering не означает partial stored data.

Не держать бессрочные дополнительные копии полного prompt ради каждого view/tooltip. Владелец освобождает obsolete snapshot/render resources; preview не перетирает final data. Реальная memory policy backend остаётся в MS, не переносится в kit.

Состояния loading/empty/no-results/unknown/stale/partial/error различаются текстом и доступным действием. Stored URL/configured не означает доступную модель; отсутствие данных не success и не пустое хранилище.

Проверка: unknown tool block, deep/large structure, special/invisible symbols, source switch, shortened URL, newline/tab, locale/large number и copy правильного snapshot.
