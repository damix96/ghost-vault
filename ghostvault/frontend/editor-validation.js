import { Ui } from './ui-components.js';

export class EditorValidation {
  static secret = (editingKey, secrets) => {
    const key = Ui.read('modalKeyInput');
    const existing = !editingKey && secrets.some(secret => secret.key === key);
    return [
      ['modalKeyInput', !key ? 'Введите имя, например DB_HOST.' : existing ? 'Такое имя уже существует. Откройте «Изменить» у этой записи или выберите другое имя.' : ''],
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
