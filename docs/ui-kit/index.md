# UI-kit: карта документации

Статус: experimental kit 0.1.0 в `ui-kit/`; пользователь разрешил полный перенос, его выполняет отдельный frontend-владелец. Готовность переноса подтверждает его отчёт, не наличие kit. [Запуск](delivery/running.md), [API](components/catalog.md), [решения](delivery/decisions.md). Источник руководства — [принятый список 147 тем](../../.codex/ui-kit-approved-topics.md).

Требования проекта: [engineering-style](../../engineering-style.md), [AGENTS](../../AGENTS.md), [UX](../frontend-ux-guide.md), [master-spec](../master-spec.md). Руководство не меняет backend/API/хранение и не объявляет текущий UX принятым.

| Задача | Читать сначала | Затем только нужную ветку |
|---|---|---|
| Основания и область правил | [Индекс оснований](basics/index.md) | [Scope](basics/scope.md) |
| Использовать компонент | [Цикл потребителя](basics/workflow.md) | [Каталог/API](components/catalog.md) |
| Не хватает элемента | [Композиция и изменения](basics/composition.md) | [Открытые решения](delivery/decisions.md) |
| Создать/изменить компонент | [Контракты](components/index.md) | [Проверки](delivery/testing.md) |
| Поле/форма | [Значения](components/values.md) | [Формы](components/forms.md), [валидация](components/validation.md) |
| Редактор/список/диалог/поток | [Взаимодействия](interaction/index.md) | Нужный сценарий |
| Выбрать способ CSS | [Оформление](styling/index.md) | Utilities/vendor/scoped CSS |
| Copy/секреты | [Данные](data/index.md) | Источник, безопасность, результат |
| Пакет/release | [Доставка](delivery/index.md) | [Команды и артефакты](delivery/running.md) |
| Изменить документацию | [Правила документации](basics/documentation.md) | Тематический index |

Правила разработал архитектор по поручению пользователя; технические решения принял в предоставленных полномочиях. Они не выдаются за дословный выбор пользователя. Реализованные exports перечислены в каталоге; обсуждение иных сценариев в руководстве не означает наличие таких компонентов. [Непроверенные browser interactions](delivery/testing.md) не объявлены готовыми.

Не читать дерево целиком: выбрать задачу, открыть её leaf и ссылки по затронутому механизму. В каждой папке есть свой `index.md`.
