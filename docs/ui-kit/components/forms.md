# Формы и нативное поведение

[Раздел](index.md).

Цель — не ломать ожидаемое поведение browser forms собственной обёрткой. Бизнес-проверка/сохранение принадлежат controller; kit предоставляет доступные controls и состояние формы.

## Composition и submit

- Один form owner; HTML-формы не вкладывать друг в друга. Form layout и FormActions не создают скрытый второй `<form>`.
- У кнопки внутри формы явно выбран тип: обычный action — `button`, сохранение — `submit`; `reset` используется только с согласованной reset-моделью.
- Enter проходит native submit-путь с учётом submitter, а не случайный соседний action или второй keydown-callback.
- Submitter/действие проверяются по контракту; busy не является серверной гарантией идемпотентности.
- Поле имеет уникальные id/name и видимый label; placeholder не заменяет label. Группы имеют доступное имя, validation связывается с нужным control.

## Read-only / disabled

Native disabled control обычно не участвует в form entry list; read-only не означает то же самое. Поддержка readonly зависит от вида control. Не обещать универсальный `readonly` для checkbox/select без определённой семантики.

Для disabled fieldset сохранять правила browser, включая исключения первого legend, а не вычислять blanket disabled по любому DOM-предку. Wrapper не снимает disabled у внутреннего поля из-за собственных props.

Источники: [HTML form infrastructure](https://html.spec.whatwg.org/multipage/form-control-infrastructure.html), [forms/labels](https://html.spec.whatwg.org/multipage/forms.html). Native submission/validation не является авторизацией или полной бизнес-валидацией.

## Reset

Контракт различает initial value, current draft и последний подтверждённый saved snapshot. Определить, к какому из них ведёт reset всей формы, группы и отдельного поля.

Native reset и reset модели должны согласоваться. Controlled control не может остаться визуально сброшенным со старой model value. Сброс ошибок/dirty зависит от выбранной baseline; reset не сохраняет данные на сервере.

## Autofill / managers

Определить подходящие name/autocomplete/type без ложного обещания одинакового поведения всех password managers. Не считать, что один keyboard handler наблюдает все изменения.

Синхронизировать supported native events; перед submit получать актуальные значения ассоциированных controls и применять предусмотренную validation. Не опрашивать глобально все поля/секреты. Проверить autofill, paste, clear и manager replacement в поддерживаемых browsers.

## Native editing

Не переприсваивать input value на каждый render. Во время composition не нормализовать незавершённый IME draft; после изменения сохранить caret/selection/direction с учётом реально удалённых символов.

Программная трансформация может нарушать native Undo/Redo. Выбрать минимальное изменение, либо normalize on commit/blur, если domain допускает; подтвердить поддерживаемую стратегию interaction проверкой. Не обещать сохранение undo stack без evidence и не писать новый editor engine ради маскировки проблемы.

Reveal/mask не пересоздаёт поле и не меняет рабочее значение; вернуть selection/focus, не утечь через debug. См. [editing](../interaction/editing.md).

## Если выбраны Web Components

Custom control участвует в FormData/reset/validity через согласованный form-associated adapter или documented внешний механизм. Видимый UI, native entry list и controller value должны совпадать. Disabled fieldset/reset проверяются отдельно; сам custom tag не доказывает native form integration.
