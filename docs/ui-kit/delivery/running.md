# Запуск и доставка 0.1.0

[Раздел](index.md) · [API](../components/catalog.md) · [Решения](decisions.md).

Все команды из `ui-kit/`. Node `>=22.12`; реально проверено Node `26.8.2`/npm `11.19.1`. Установка требует npm registry; готовый playground работает с локальными assets без CDN/gateway.

```powershell
npm ci
npm run build
npm run check
npm run check:docs
npm test
npm run smoke
npm run preview
```

`http://127.0.0.1:5178/`, завершение `Ctrl+C`. Strict port не выбирает неожиданно другой порт. `npm run dev` генерирует icons и запускает source/HMR; production build собирает public artifact, types, assets и затем playground через его package exports. Это два разных пути, оба не меняют основной frontend.

`examples/tsconfig.json` задаёт ближайший project для Vite example transforms и наследует `useDefineForClassFields:false`. Это сохраняет Lit accessors/reactivity; typecheck/HTTP 200 сами по себе не выявляли прежнее shadowing class fields. Library/app config этим не меняется.

## Артефакты

| Путь | Назначение |
|---|---|
| `dist/index.js`, `.d.ts` | Main ESM API; Lit/Web Awesome остаются dependencies consumer bundler |
| `dist/models/*.js`, `.d.ts` | Headless entries, без DOM/vendor imports |
| `dist/styles.css` | Один compiled CSS: ready theme + Tailwind utilities + kit tokens/recipes |
| `dist/icons/*.svg` | Девять Lucide assets, согласованные с resolver |
| `dist/licenses/` | MIT/ISC notices upstream; generated vendor notices сохраняются |
| `playground-dist/` | Статический сайт с bundled dependencies, относительными script/CSS paths и `icons/` |

`npm pack --dry-run --json` проверяет package inventory без publish. Private `@ghostvault/ui-kit@0.1.0`, `UNLICENSED` для собственного кода; это не меняет лицензии vendor. Pack включает dist и README, не node_modules/source/demo. Для demo передавать весь `playground-dist/`.

## Встраивание отдельным consumer

Consumer устанавливает package/dependencies в своём scope, импортирует `@ghostvault/ui-kit/styles.css` один раз, затем `registerKit({iconBase})`. Bare ESM требует bundler/import map; dist/index.js — не самостоятельный browser bundle. Пользователь отдельно разрешил app migration её frontend-владельцу; это не разрешение менять proxy/API.

GhostVault production: Vite base `/`, assets `/assets/`, icons `/icons/`, прежний entry `/dashboard`; [app contract и restart ownership](app-integration.md). Standalone playground остаётся отдельным сценарием с относительным base.

Скопировать `dist/icons/` в same-origin directory; указать полный directory URL. Дефолт рядом с compiled module годится только при такой реальной раскладке. `base='./'` playground допускает nested deployment; URL и assets должны принадлежать одному release. Не открывать HTML через file protocol.

Main JS import не регистрирует элементы и не запускает vendor polling/network. `registerKit` лениво импортирует нужные Web Awesome controls, включая textarea/select/option; после mount icons загружаются локально. Имена `gv-*`/`wa-*` используют общую registry; две независимые версии не поддерживаются. Повтор той же module instance допустим.

## Поддержка и CSP

Нужны ES modules/ES2022, Custom Elements/Shadow DOM, ElementInternals/form association, native Dialog/Popover, современные CSS из Tailwind 4/Web Awesome. Проверенной browser/AT matrix пока нет; версии ниже vendor requirements не обещаются. Это experimental delivery, не UX/a11y certification.

Kit не меняет CSP/headers host. Lit/Web Awesome создают runtime style sheets, positioning engine пишет измеренные coordinates/size; жёсткий CSP/Trusted Types требуют отдельной проверки до интеграции. Source design attrs/`.style` на странице не разрешаются автоматически из-за этого engine boundary.

Зафиксированные lock/versions и notices обновляет kit owner; release/publish/rollback/app connection отдельно согласуются. Не исправлять несовместимость правкой root package, gateway или настроек OpenCode.
