# Редактор и рабочий контекст

[Раздел](index.md).

Основание: [UX](../../frontend-ux-guide.md). Действие «Настроить» открывает editor только выбранного объекта на исходной странице. Каталог остаётся отдельной намеренной навигацией; kit не заставляет повторно выбирать объект.

## Модель

Разделить entity identity, baseline saved snapshot, draft, draft revision, pending operation, errors и last confirmed result. Это логические обязанности, не имена существующего API.

Dirty вычисляется относительно согласованной baseline по семантическому value, не относительно formatted label. Возврат к baseline снимает dirty; `0/false` и пустое значение сравниваются правильно. Не мутировать baseline вслед за draft.

## Открыть / закрыть / открыть снова

- Открытие захватывает entity и trigger/context. Запрос нового каталога не подменяет выбранный entity.
- Смена объекта явная; dirty draft не переезжает на другой id.
- Reopen contract указывает: сохранённый snapshot или retained draft. Retained draft хранится по entity и revision, не общей переменной «последний editor».
- Save/cancel/close сохраняют исходную страницу, выбранную сессию и scroll; focus возвращается живому trigger либо осмысленному соседнему action.
- Close не означает cancel server operation и не обещает Undo; см. [concurrency](concurrency.md).

## Refresh

Обновлять неактивные/чистые представления по stable keys. Dirty fields не перезаписывать silent refresh. Новый server snapshot сохранить отдельно и показать согласованное состояние конфликта/свежести; решение merge принадлежит domain.

Form errors/save status относятся к draft revision. Scroll, раскрытые details, caret/selection и pinned hint не уничтожаются из-за render списка.

Если объект удалён или недоступен, сохранить безопасный draft для текущего чтения, обозначить ограничение и прекратить unsupported save. Не обещать восстановление удаления без соответствующего API. Политика сохранения чувствительных draft — ниже.

## Хранение и восстановление

По умолчанию секретные drafts остаются только у активного owner в памяти. Не помещать real values/payload в URL, localStorage или debug, чтобы «восстановить всё после refresh».

Безопасные preferences, например density/theme, могут сохраняться отдельно по принятому контракту. Даже object/session IDs оцениваются на чувствительность и действительность после перезапуска; отсутствие записи обрабатывается как unknown, не похожий найденный объект.

Если требуется persisted draft или reload guard, согласовать scope, sensitive fields и срок жизни. Не добавлять автоматические подтверждения/хранилище как случайный эффект kit. Browser refresh/закрытие вкладки не гарантируют завершение сохранения.

Проверка: edit→poll, selected object changed/deleted, reopen, save старой редакции, cancel, refresh, keyboard focus return и сохранение страницы/сессии.
