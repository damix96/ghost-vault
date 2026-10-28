# Tokens и темы

[Раздел](index.md).

Почему: разбросанные значения и private selectors делают общий restyle непредсказуемым. Цель — одна семантическая система и versioned public styling contract.

## Источник значений

Tokens обозначают смысл: surface/text/border/focus/status, spacing/type/radius/density. Mapping в Tailwind/vendor variables хранится явно, без второй независимой палитры.

Компонент использует semantic token/accepted scale. Новый literal оценивается по роли: действительно уникальная техническая величина либо отсутствующий token. Не превращать каждое число в отдельный бессмысленный token; не разносить один и тот же смысл по raw colors callers.

Light/dark/forced-color поведение определяется на состояниях, не только background. Проверить focus/invalid/busy/disabled/read-only; цвет не единственный носитель информации. Статус configured/unknown не становится success от зелёного цвета.

## Наследование и overlays

Выбранная theme boundary определяет source для subtree. Portal/overlay должен получить тему своего initiating context либо явно общий app theme — не случайный document default.

Nested theme, modal и vendor shadow control проверяются вместе. CSS custom properties/parts — public hooks, обычные selectors внутреннего DOM vendor не public contract. Не клонировать всю тему в каждом child и не включать полный utility bundle в каждый shadow root без выбранной scoped delivery strategy.

## Изменения

Token rename/removal оценивается как API change. Найти direct consumers/mapping/examples; предусмотреть alias/deprecation, если нужна совместимость. Не менять значение под старым именем на иной смысл ради одного экрана.

Новая theme variation не меняет прежние defaults молча. Перед общим изменением проверить old/new theme, overlays, vendor hooks и contrast. Consumer `!important` не является способом обхода несовместимого release.

Reset/layer/specificity order записан на уровне доставки. Не подключать vendor native reset поверх Tailwind preflight по умолчанию. Документированное узкое override допустимо при ясном scope; не наращивать цепь global overrides.

Механика tokens: [Tailwind theme](https://tailwindcss.com/docs/theme). 0.1.0: [src/styles.css](../../../ui-kit/src/styles.css) задаёт `--gv-font`, `--gv-space-small/space/space-large`, `--gv-radius`, `--gv-surface/text/muted/border/focus`; цвета ссылаются на WA semantic variables. `wa-light/wa-dark` на document root; nested themes пока не public supported API. Палитра приложения не менялась.
