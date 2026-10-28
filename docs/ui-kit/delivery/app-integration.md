# Production-контракт dashboard

[Раздел](index.md) · [Запуск kit](running.md) · [API](../components/catalog.md).

Согласовано frontend-владельцем `uikit-senoir-expert` и kit owner в `ui-kit-full-migration-20261026 / migration-contract-01`. Факты static registration сообщил frontend-владелец по [server.ts](../../../ghostvault/src/proxy/server.ts): root `ghostvault/public`, prefix `/`, `wildcard:false`, `index:false`; `/dashboard` отдельно отдаёт `index.html`. Kit owner backend не меняет и не заявляет независимую runtime-проверку этих фактов.

## Mapping

| URL / input | Контракт |
|---|---|
| `/dashboard` | Единственный entry на прежнем `127.0.0.1:8767`; backend route сохраняется |
| `/assets/` | App JS/CSS с hashes и все lazy chunks |
| `/icons/` | Локальные kit SVG, весь `ui-kit/dist/icons/`, сейчас девять файлов |
| Vendor notices | Из `dist/licenses/` в app public вместе с build; upstream notices сохраняются |
| Vite | `base:'/'`, consumer public exports, без src aliases |
| Dependency | `@ghostvault/ui-kit: file:../ui-kit` относительно `ghostvault/package.json` |
| Dedupe | `lit`, `lit-html`, `@lit/reactive-element`; согласованная Lit 3.3.3 |

```ts
import '@ghostvault/ui-kit/styles.css';
import { registerKit } from '@ghostvault/ui-kit';

await registerKit({ iconBase: new URL('/icons/', location.origin).href });
```

App mount после registration; failure показывает явную ошибку, не активные неработающие controls. CSS один раз, dependencies/lazy imports локально в production build. `dist/index.js` не browser bundle для прямого script src. Icon base не выводится из relative URL `/dashboard` без slash.

## Порядок и ownership

Kit install/build → app install/build → проверка доставки → runtime restart у владельца процесса. Lockfiles воспроизводимы; consumer копии file dependency обновляет её после kit changes. Не подменять поставленный public artifact app src alias ради обхода stale package.

Frontend-владелец меняет app source/build/public/package/lock; kit owner — `ui-kit/` и `docs/ui-kit/`. Coordinator управляет runtime restart/коммитом. По подтверждению frontend-владельца `wildcard:false` требует restart после появления новых build files; запрос уже направлен runtime-владельцу. Не запускать второй listener 8767 и не менять static/proxy/API для обхода старого процесса.

JS/CSS/chunks/icons/notices одного build доставляются вместе. HTTP smoke после restart проверяет `/dashboard`, referenced assets/chunks и local icons; app evidence сообщает её владелец. Kit smoke 5178 проверяет только standalone artifact, не маршрут 8767.

Почему этот путь: существующий Fastify обслуживает public root → сохраняем backend/API/entry, добавляя воспроизводимый frontend build. Public package/local assets исключают CDN и node_modules server. Base `/dashboard/` противоречил бы фактическому prefix `/`; src alias скрывал бы проблему public delivery.

## Навигация и содержимое

Internal page buttons: `gv-action.current`, действие `gv-activate`; URL `/dashboard`. Secret subsections допустимы как именованная группа toggle buttons с controlled `.pressed`: это не ARIA tablist и не href/link contract. Для настоящих tabs/roving keyboard согласовать ready tab primitive, не добавить роли без поведения.

Domain CSS — [host boundary](../styling/host-boundary.md). Field/select/dialog/hint/details/theme не переоформляются app descendants selectors. Полная migration/UX/keyboard/browser/AT/CSP готовность не следует из этого соглашения или kit build.
