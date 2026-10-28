# Списки, выбор и навигация

[Раздел](index.md).

Цель — изменение порядка/видимости не подменяет объект действия. Domain задаёт данные/доступность, kit — понятный selection/action contract.

## Identity и выбор

- Key — устойчивый id, не индекс, label или текущая позиция.
- Sort не меняет entity открытого editor. Filter отдельно определяет visible set и selection.
- Если filter скрыл выбранную запись, явно сохранить selection с признаком hidden либо сбросить по documented contract. Не подставлять первую видимую как тот же объект.
- После удаления определить следующий осмысленный selection/focus: соседняя запись, список либо create action. Не обращаться к удалённому trigger.
- Исчезнувшую/disabled option не стирать из model молча. Показывать unresolved/unavailable состояние и доступный путь исправления.

Multi-select определяет order, duplicate policy и stable identity значений. Отдельно задать смысл clear и select-all: весь известный eligible dataset либо текущий filtered set. Если известна только страница, нельзя обещать выбор всего серверного набора.

Partial checkbox представляет отношение к eligible множеству; contract задаёт, что делает следующая активация. Визуальный indeterminate не является самостоятельным сохраняемым business value. Disabled items не включаются случайно в bulk intent.

## Nested actions и browser defaults

Интерактивная строка не должна быть сплошной несемантической ловушкой. Основное действие — подходящие button/link; вложенная кнопка не запускает row action. Pointer text selection не считается намерением открыть объект.

Ссылки сохраняют Ctrl/Cmd/middle-click/new-tab. Не перехватывать любой click и modifier одним SPA callback. Back/Forward и URL-state принадлежат routing приложения; component не переписывает history для собственной выделенности без контракта.

Shortcuts имеют scoped owner и не отбирают browser/editing shortcuts. Сначала проверить focused control/active overlay/modifiers; обеспечить keyboard путь без обязательного знания shortcut.

## Virtualization

Выбрать только после оценки объёма и tradeoffs. Model может хранить весь набор, когда DOM содержит окно; это ограничивает native Find, text selection/copy и assistive navigation. Не объявлять, что browser Find ищет все несмонтированные строки.

Logical active item хранится вне recycled DOM. Для keyboard перехода к offscreen item обеспечить mount/scroll и корректную accessible связь; исчезновение строки не сбрасывает focus в body. Если full native Find/copy необходимо, предложить unvirtualized/saved data view или поиск по данным.

DOM order согласован с visual order: CSS `order` не является изменением Tab reading order. Compact responsive rows сохраняют labels/actions и сравнимость; не размножать гигантские формы.

Проверка: sort/filter с editor, исчезнувшая option, filtered select-all, nested action/selection/modifier link, delete current и keyboard за пределом mounted window.
