# GhostVault UI-kit 0.1.0

Private ESM-пакет: Lit, Web Awesome Core, Tailwind, локальные Lucide. 13 компонентов; текущую миграцию GhostVault ведёт отдельный frontend-владелец. Node `>=22.12`; проверено на Node `26.8.2` / npm `11.19.1`.

Команды для исходного checkout, из корня проекта:

```powershell
cd ui-kit
npm ci
npm run build
npm run check
npm run check:docs
npm test
npm run smoke
npm run preview
```

Пример: `http://127.0.0.1:5178/`. `Ctrl+C` останавливает сервер. `npm run dev` — source/HMR; отдельная сборка для старта dev не требуется. Оба сервера привязаны к loopback и требуют свободный порт 5178, не перенастраивают gateway.

`dist/` — JS/types/styles/icons/licenses; `playground-dist/` — статический standalone-пример, собранный через публичный пакет. Dependencies/lock/config находятся только здесь. Generated output не редактировать.

Ссылки на полное руководство ниже относятся к checkout; private pack содержит distribution и этот README, не исходники/документацию всего проекта.

```ts
import '@ghostvault/ui-kit/styles.css';
import { registerKit } from '@ghostvault/ui-kit';

await registerKit({ iconBase: new URL('./icons/', document.baseURI).href });
```

Consumer bundler разрешает ESM dependencies; скопировать `dist/icons/` в выбранный same-origin URL. Пример уже содержит эти assets. JS сам не подключает CSS и не регистрирует tags до `registerKit()`. Прямое открытие через `file://` не поддерживается.

- [Вход и правила](../docs/ui-kit/index.md).
- [Компоненты и API](../docs/ui-kit/components/catalog.md).
- [Модели редактора/copy/hint](../docs/ui-kit/components/models.md).
- [Multiline/select, pending dialog, compact/state actions](../docs/ui-kit/components/migration-controls.md).
- [Запуск и public distribution](../docs/ui-kit/delivery/running.md).
- [Согласованное подключение к dashboard](../docs/ui-kit/delivery/app-integration.md).
- [Архитекторские решения](../docs/ui-kit/delivery/decisions.md).
- [Проверки и реальные ограничения](../docs/ui-kit/delivery/testing.md).

Модели/adapters проверяются в Node/happy-dom. Kit owner выполнил ограниченный Chromium probe prose/sr-only; frontend-владелец сообщил отдельный app smoke. [Scope и непроверенные native/AT/IME/CSP сценарии](../docs/ui-kit/delivery/testing.md). Полный app smoke kit owner не повторял; перенос приложения ведёт frontend-владелец. Публикация не разрешена.
