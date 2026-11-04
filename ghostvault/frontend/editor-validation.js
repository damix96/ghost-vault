import { Ui } from './ui-components.js';

export class EditorValidation {
  static keyError = key => !key ? 'Введите имя, например INTERNAL_HOST.' : /^[A-Z0-9_]+$/.test(key) ? '' : 'Используйте только заглавные латинские буквы A–Z, цифры 0–9 и _. Без пробелов; например INTERNAL_HOST.';
  static keyPreview = key => EditorValidation.keyError(key) ? 'Подстановка появится после ввода допустимого имени' : '$${<' + key + '>}';
  static secret = (editingKey, secrets) => {
    const key = Ui.read('modalKeyInput');
    const existing = !editingKey && secrets.some(secret => secret.key === key);
    return [
      ['modalKeyInput', EditorValidation.keyError(key) || (existing ? 'Такое имя уже существует. Откройте «Изменить» у этой записи или выберите другое имя.' : '')],
      ['modalValInput', Ui.read('modalValInput').length ? '' : 'Введите точное значение, которое нужно скрывать, например db.internal.example.'],
    ];
  };

  static regexError = value => {
    if (!value.length) return 'Введите выражение, например DEMO_[A-Z0-9]{8}.';
    let error = '';
    try {
      new RegExp(value, 'gi');
    } catch { error = 'Выражение не разбирается как JavaScript regex. Проверьте скобки и экранирование; пример: DEMO_[A-Z0-9]{8}.'; }
    return error;
  };

  static pattern = () => [
    ['patternNameInput', Ui.read('patternNameInput').length ? '' : 'Назовите правило, например «Токены моей системы».'],
    ['patternRegexInput', EditorValidation.regexError(Ui.read('patternRegexInput'))],
  ];
}
