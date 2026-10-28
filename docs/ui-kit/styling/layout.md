# Layout, density и размеры

[Раздел](index.md).

Цель — компактный сравнимый UI, который сохраняет доступность при длинных данных/другом viewport. Общий layout primitive нужен для повторяемого отношения блоков, не как новый CSS language.

Сначала проверить существующие Stack/Grid/Split/Section или аналогичные принятые contracts. Если нужен новый layout, выбрать композицию, opt-in variant либо scoped component CSS по [policy](policy.md). Конкретные имена здесь иллюстративны.

## Responsive и density

- Строки подключений на desktop компактны; длинные детали раскрываются по месту. Мобильная адаптация не превращает каждый объект в гигантскую форму.
- Label/action/value остаются различимы; длинный URL/секрет не расширяет весь viewport и не обрезается молча как полное значение.
- Visual ordering не заменяет DOM reading/Tab order. Keyboard путь соответствует видимому смыслу.
- Проверить масштаб шрифта/zoom и long/localized labels. Fixed height не скрывает текст или required/error state.
- Density variant изменяет согласованные spacing/type, но не уменьшает interactive affordance до непроверяемой зоны.

## Measurement

Предпочитать declarative layout. Если нужен observer/auto-size: измерить→сравнить→применить необходимое изменение; не инициировать бесконечный update из собственного measurement.

Разделять geometry и data changes. Отбрасывать устаревшее измерение после resize/entity change/dispose. Cleanup observers проходит даже при прерванной анимации.

Экранная клавиатура, viewport edge и scroll контейнера проверяются с [overlays](../interaction/overlays.md). Нельзя считать единственное измерение при mount геометрией на весь lifecycle.

## Fonts/icons

Локальная доставка не должна требовать неожиданного CDN. Размер/placeholder для font/icon уменьшает нежелательный layout shift, но смысл action задаётся текстом/accessible name независимо от загрузки glyph.

Icon wrapper использует Lucide и принятые размеры/semantic versus decorative semantics. Missing icon не превращает action в безымянную кнопку. Vendor system icons также входят в asset inventory; глобальный обход private shadow DOM не считается поддержкой иконок.

Проверка: long secret, увеличенный шрифт, compact→normal, missing font/icon, repeated resize, nested overflow и mobile keyboard. Нужный CSS оценивается по ясности/scope, не только числу строк.
