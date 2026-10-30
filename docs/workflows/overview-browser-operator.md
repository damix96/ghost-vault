# Headless-браузер: техническая инструкция

SESSION — предоставленный путь к собственной уже запущенной сессии. Браузер сохраняет состояние между вызовами. Это справочник управления, не маршрут исследования.

```powershell
& 'D:\tools\anaconda\python.exe' 'E:\projects\aegis-gate\scripts\browser_operator.py' --session 'SESSION' --action screenshot
```

Ответ JSON: `status`, `screenshot`, `cursor`, `url`; при ошибке — `error`. Открой файл из `screenshot` через инструмент просмотра изображений: Codex — `view_image`, AGY — `read_file` в режиме картинки.

Меняй аргументы после `--session 'SESSION'`:

| Действие | Аргументы |
|---|---|
| Скриншот | `--action screenshot` |
| Клик по видимому тексту | `--action click --target 'ТОЧНЫЙ ТЕКСТ'` |
| Клик по координатам | `--action click --x 420 --y 260` |
| Наведение | `--action hover --target 'ТОЧНЫЙ ТЕКСТ'` |
| Ввод в текущий фокус | `--action type --value 'ТЕКСТ'` |
| Ввод по placeholder | `--action type --target 'PLACEHOLDER' --clear --value 'ТЕКСТ'` |
| Клавиша | `--action key --key TAB` — также ENTER, ESCAPE, ARROW_DOWN, BACKSPACE |
| Удержать / отпустить Ctrl | `--action keydown --key CONTROL` / `--action keyup --key CONTROL` |
| Прокрутка области | `--action scroll --x 900 --y 600 --dy 500`; отрицательное dy — вверх |
| Размер окна | `--action resize --width 390 --height 844` |
| История / перезагрузка | `--action back`, `--action forward`, `--action reload` |
| Снимок после анимации | `--action screenshot --wait 1.5` |
| Закрыть свою сессию | `--action close` |

Поиск target использует точный видимый текст или placeholder, включая Shadow DOM. При неоднозначном совпадении используй координаты свежего скриншота; после прокрутки и изменения размера старые координаты могут указывать на другой элемент. Ввод без target/x/y идёт в текущий фокус. Удерживаемые модификаторы отпускай через keyup.

Каждое действие сохраняет скриншот в назначенную сессии папку и запись в actions.jsonl. PNG обычно не показывает курсор; его CSS-тип возвращается отдельно в cursor. Окна на рабочем столе не открываются. Ошибка команды выводится в error и сама по себе не означает ошибку приложения.
