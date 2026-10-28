# Модули и browser integration

[Раздел](index.md).

Цель — импорт и несколько экземпляров не создают скрытые эффекты; renderer не требует приватных патчей host. В 0.1.0 выбраны Lit/Web Components; точные registration/import/styles эффекты — [в доставке](running.md).

## Модули

- Public imports не запускают сеть/timers/polling и не меняют чужой DOM. Necessary global registration/styles объявлены отдельным документированным entry effect.
- Разделить type/contracts, state и renderer так, чтобы import cycle не требовал partially initialized instance. Не скрывать цикл lazy global lookup только ради прохождения сборки.
- Selective import проверяется по реальному dependency/asset graph; один control не должен неожиданно тянуть весь kit/icons. Не обещать tree shaking лишь по названию ESM.
- Потребитель не использует private source paths. Fixture импортирует public built artifact и нужные styles, а не внутреннюю функцию из рабочей папки.
- HMR/remount использует обычный cleanup; dev/prod различия effect registration документированы, а не случайны.

Загрузка, unsupported browser и failed upgrade отличаются от ready. Ошибка импорта/регистрации не оставляет видимый, но неработающий action якобы активным: owner показывает доступное failure/fallback с сохранёнными данными. Повторная попытка не монтирует второй набор handlers и не запускает несвязанный business request. Support claim привязывается к проверенной версии/пути загрузки, не наличию custom tag.

## Если выбраны custom elements

HTML attributes и JS properties — разные поверхности. Контракт указывает тип/serialization/reflect/default/removal. Boolean presence-контракт не трактует строку `"false"` как отсутствие; для object/array использовать принятый property path, не универсальный JSON attribute с secret payload.

Properties, выставленные до lazy registration/upgrade, сохраняются и проходят тот же validation/update путь после upgrade. Проверить собственное property, которое могло затенить prototype accessor; не терять раннее значение ради default.

Global registration имеет owner/name/version policy. Повтор той же версии не размножает эффекты; конфликт несовместимых версий не маскируется «если имя есть, просто пропустить». Scoped registry или adapter допустим только как выбранный supported механизм, не предположение.

Form-associated integration должна соответствовать [формам](../components/forms.md): value/validity/FormData/reset/disabled и control name. Нативная семантика не появляется автоматически от custom tag.

Shadow events и content slots описываются публичным контрактом; consumer не ищет внутренний target селектором. Theme/ARIA/slots границы проверяются вместе с [styles](../styling/policy.md).

Платформенное основание: [HTML custom elements](https://html.spec.whatwg.org/multipage/custom-elements.html). Конкретный framework может предоставлять свои adapters; использовать проверенный путь, не писать второй runtime.

## Host ограничения

Изолированная сборка учитывает CSP/Trusted Types, asset base URL и supported module loading. Не менять headers/config основного приложения для обхода несовместимости. Если выбранный пакет требует неприемлемую политику, это решение по выбору пакета, не случайный consumer patch.

Проверка: import без mount, import only-one-control, cyclic dependency, pre-upgrade property, two copies/version conflict, failed setup, HMR/remount, public-package consumption и формы.
