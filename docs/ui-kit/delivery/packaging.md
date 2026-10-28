# Пакет, assets и выпуск

[Раздел](index.md).

Почему: успешная локальная сборка не доказывает, что consumer получит совместимые JS/CSS/types/assets. Цель — независимый воспроизводимый kit без скрытого изменения приложения.

## Изоляция и выбор

Перед кодом записать path/package/runtime/vendor/tooling/public surface в [decisions](decisions.md). Не устанавливать зависимости в main app, не трогать её lock/build/public/server. Собственный package/playground использует synthetic data и не требует live gateway/Vault.

Готовый primitive сравнивается по нужным interactions/a11y, style hooks, class/lifecycle compatibility с E, browser support, объёму своего adapter и delivery. Для 0.1.0 архитектор выбрал [Lit/Web Awesome](decisions.md); пользователь не назначал эти библиотеки.

## Distribution contract

Публичная поверхность: entry/subpath exports, types, styles/theme/assets, version, side effects и поддерживаемый способ загрузки. Bare imports в browser требуют выбранного resolver/bundler/import map; Node package exports сами по себе browser loader не создают.

Фиксировать runtime versus dev dependencies, лицензии/notices, версии и reproducible lock/update ownership. Новая зависимость требует обоснованной необходимости; upgrade проходит impact/regression, а не silent latest.

Формат exports описывает [Node packages](https://nodejs.org/api/packages.html); применимость к выбранному browser distribution подтверждается отдельно.

## CSS и assets

Версия Tailwind и class discovery фиксируются до production output. Не строить class names так, что chosen generator не видит необходимые варианты; проверить generated states/responsive/theme classes и public component sources.

Reset/layers/load order и theme source входят в package contract. Локально доставляются icons/fonts/vendor system assets; запрет accidental CDN означает проверку реальных origins, не только main import URL.

Относительные paths проверяются при nested base URL, не только `/`. Регистр filenames/imports совпадает: Windows dev не доказывает case-sensitive deployment. Не собирать asset URL shell/path-конкатенацией, зависящей от обратных slash рабочего компьютера.

## Release

JS/CSS/assets/types/examples относятся к одному release. Manifest или equivalent artifact identity позволяет обнаружить cache/version skew; не оставлять старый CSS при обновлённом JS без оценки совместимости.

Релиз воспроизводим из зафиксированных inputs; smoke fixture потребляет packed/public output. Dev import внутренних sources не заменяет такую проверку. Объём bundle/dependencies оценивается по фактическим нуждам, без выдуманного числового budget.

Rollback возвращает согласованный комплект и known consumer version. Update theme token/default/event оценивается как contract change; removal требует consumer inventory/migration note. Обновление snapshots не является согласованием release.

Публикация/подключение kit к app требуют отдельного scope; создание документации не даёт полномочия publish/deploy. Документировать release owner и известные support limits.

Проверка: clean isolated build после разрешения, nested URL/case-sensitive paths, offline/local assets, selected import graph, wrong-version CSS, packed consumer fixture и rollback.
