# Copy и clipboard

[Раздел](index.md).

Цель — копировать обещанное значение, а не DOM-картинку или данные другого объекта. Clipboard — чувствительный output, не debug transport.

## Контракт действия

На активации захватить source object/representation/revision и точное value. Если пользователь переключил masked/original или объект, следующий copy использует новый выбранный источник. Pending предыдущий copy не перечитывает случайный новый DOM.

Label указывает, что переносится: полный URL, реальное значение, подстановка, saved text или readable JSON. Если preview скрывает чувствительные части, не копировать маску вместо рабочего значения; значимый факт реального содержимого виден рядом с action.

Переносимый текст не включает syntax wrappers, line numbers, invisible-character markers и decoration. Не выполнять trim/locale formatting/Unicode normalization без source-specific контракта.

## Асинхронный результат

Clipboard operation хранит свой source token. Успех относится к записи этого значения; он не означает, что clipboard никогда не изменится другим приложением. Failure не объявляется успехом потому, что action был нажат.

Если source view закрыт, не писать в его DOM и не присваивать результат новому объекту. Допустим scoped app result с безопасным названием/действием, без вывода секрета и без захвата focus.

Browser может ограничить доступ. Обрабатывать rejection/unsupported path; не запускать бесконечные попытки и не ослаблять browser security. Fallback — явно предложенный selectable текст/ручной copy по текущему раскрытому контексту, а не автоматический dump в log/title.

Копирование внутри pinned hint не должно закрывать его из-за pointer selection/interaction. Не мешать обычным Ctrl/Cmd+C и browser context menu.

Механика API/permissions: [Clipboard specification](https://w3c.github.io/clipboard-apis/). Конкретные supported browsers/paths записываются после проверки, не выводятся из наличия одного метода.

Проверка: корректный source до/после защиты, raw versus decorated copy, whitespace, failure, закрытие source во время promise, два последовательных copy и pinned selection.
