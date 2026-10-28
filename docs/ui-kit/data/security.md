# Секреты, markup и host security

[Раздел](index.md).

Почему: UI владеет реальными значениями и интерпретируемыми DOM sinks. Цель — не превратить presentation/help/diagnostics в другой канал утечки или исполнения.

## Данные не markup

User text, URLs, JSON и значения секретов передавать как данные. Escaping выбирается по контексту: text, attribute, URL и trusted component composition не взаимозаменяемы. Не использовать raw HTML prop как универсальную точку расширения.

Доверенная composition создаётся автором компонента/принятым renderer; статус не появляется из-за типа `string` или названия `safeHtml`. Небезопасная URL scheme не становится допустимой после HTML-escaping.

Unknown payload остаётся видимым текстом/структурой; не исполнять его как HTML/скрипт. Rich renderer/vendor sanitizer требует явного контракта и поддержки, не самописного regex «очистителя».

## Реальные значения

UI-маска не шифрует/не удаляет value из app memory. Не обещать confidentiality от screen masking. Reveal/copy intent явен; в Overview/title/data attributes не размещать скрытые credential values ради hover/debug.

Sensitive URL preview учитывает userinfo/query и известные secret representations в path. Не считать произвольный неизвестный path безопасным. Полный рабочий URL раскрывается/копируется по согласованному UX; destination/authorization не изменяются renderer-ом.

Alias/encoded variant связывать с реальным значением только по достоверному mapping. Похожий ключ не доказательство; unknown mapping так и обозначается. Detection count не выдается за точные occurrences/replacements без источника.

## Diagnostics и storage

Errors/events/logs/examples/screenshots/repro используют synthetic или redacted data. Не передавать всю модель формы ради сообщения о баге. Error содержит безопасные code/context/version, не request body/URL с credentials.

URL/localStorage persistence определяет app policy; реальные secret drafts туда по умолчанию не сохраняются. Preferences и sensitive values имеют разные правила. См. [editing](../interaction/editing.md).

## Capabilities и host

Domain передаёт read-only/allowed actions; disabled/hidden — UX state, не authorization. Server enforcement принадлежит backend. Permission failure обрабатывается как реальный failure, не обходится прямым private action.

CSP/Trusted Types ограничения host известны до выбора renderer/style delivery. Не требовать `unsafe-*` или pass-through Trusted Types policy, возвращающую любую строку, ради установки kit. Несовместимость записать и решить выбором реализации в её scope, без изменения backend headers сейчас.

Механика: [Trusted Types specification](https://www.w3.org/TR/trusted-types/). Поддержка конкретного browser/vendor остаётся отдельной проверкой; сам тип не доказывает безопасность всей страницы.

Проверка: synthetic markup/unsafe URL, encoded alias с неизвестным mapping, sensitive copy/title/log, read-only/revoked action и host restrictions без ослабления.
