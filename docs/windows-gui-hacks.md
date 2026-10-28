# 04. Системные механизмы Windows GUI (Sandbox Breakout)

Механизм прорыва песочницы фоновых CLI-процессов через Windows Task Scheduler (`schtasks`) и спецификация нативного WPF-модального окна.

## Проблема изоляции GUI в фоновых CLI-процессах

Современные AI CLI-агенты (Claude Code, Antigravity, OpenCode) запускают дочерние процессы через `child_process.spawn()` со следующими флагами:
- `windowsHide: true`
- Флаг создания процесса `CREATE_NO_WINDOW (0x08000000)`

### Механизм блокировки
Все порожденные подпроцессы (`powershell.exe`, бинарные исполняемые файлы) наследуют запрет на создание окон. Операционная система Windows изолирует их от интерактивной оконной станции (`winsta0\default`). 

Вызовы графических библиотек (`ShowDialog()` в WPF или WinForms) приводят к бесконечной блокировке: процесс зависает в памяти, ожидая пользовательского ввода в невидимой сессии.

## Решение: Прорыв песочницы через Task Scheduler (`schtasks`)

Планировщик задач Windows (`Task Scheduler`) функционирует как системная служба, изолированная от дерева процессов AI-клиента.

### Технические преимущества метода

| Характеристика | Реализация через `schtasks` | Прямой запуск через `child_process` |
|---|---|---|
| Привилегии ОС | Права администратора не требуются: непривилегированный пользователь создает задачи в своем контексте (`/RU %USERNAME%`) | Ограничены родительским токеном процесса CLI |
| Иерархия процессов | Процесс порождается системным `taskeng.exe` / `svchost.exe`, разрывая цепочку наследования `CREATE_NO_WINDOW` | Процесс наследует флаг отсутствия окна от родителя |
| Доступ к экрану | Окно создается в активной оконной станции (`Session 1`, `winsta0\default`) с привязкой клавиатурного фокуса | Привязка к скрытой десктопной станции без вывода на монитор |

### Командный цикл выполнения

```powershell
# 1. Регистрация одноразовой задачи
schtasks /Create /SC ONCE /TN "GhostVaultPopup" /TR "powershell.exe -STA -NoProfile -ExecutionPolicy Bypass -File C:\path\to\modal.ps1" /ST 23:59 /F

# 2. Немедленный принудительный запуск
schtasks /Run /TN "GhostVaultPopup"

# 3. Удаление задачи из реестра планировщика
schtasks /Delete /TN "GhostVaultPopup" /F
```

## Спецификация нативного окна подтверждения (WPF Modal)

Окно реализуется на XAML / WPF через PowerShell в режиме Single-Threaded Apartment (`-STA`):

- **Цветовая палитра:** Тёмный цинк (Background: `#18181B`, Border: `#3F3F46`, Accent: `#2563EB`, Text: `#F4F4F5`, Monospace: `#60A5FA`).
- **Инварианты поведения:**
  - `Topmost="True"` — удержание поверх всех окон IDE и терминала.
  - `WindowStartupLocation="CenterScreen"` — позиционирование по центру активного монитора.
  - Автоматический фокус в поле ввода с выделением сгенерированного имени `$${<NAME>}`.
  - Клавиатурное управление:
    - `Enter` — сохранение выбранного псевдонима в файл результата и закрытие.
    - `Esc` — отмена операции без внесения секрета в базу.

## Предотвращение повреждения кодировки (UTF-8 Mojibake)

Для исключения повреждения кириллических символов в интерфейсе Windows PowerShell 5.1:

1. **Конфигурация потоков консоли:**
   ```powershell
   [Console]::OutputEncoding = [System.Text.Encoding]::UTF8
   [Console]::InputEncoding = [System.Text.Encoding]::UTF8
   ```

2. **Явная инициализация XML-ридера через MemoryStream с UTF-8:**
   ```powershell
   $stream = [System.IO.MemoryStream]::new([System.Text.Encoding]::UTF8.GetBytes($xaml))
   $reader = [System.Xml.XmlReader]::Create($stream)
   $window = [System.Windows.Markup.XamlReader]::Load($reader)
   ```
