export class FormFeedback {
  static bind = (form, summary) => form.addEventListener('gv-input', event => {
    if (event.target.localName === 'gv-field') event.target.error = '';
    if (summary) {
      summary.message = '';
      summary.hidden = true;
    }
  });

  static check = (entries, summary) => {
    entries.forEach(([id, error]) => {
      const field = document.getElementById(id);
      field.error = error;
      field.setCustomValidity?.(error);
    });
    const invalid = entries.filter(([, error]) => error);
    if (summary) {
      summary.message = invalid.length ? 'Проверьте отмеченные поля.' : '';
      summary.hidden = !invalid.length;
    }
    if (invalid.length) {
      const field = document.getElementById(invalid[0][0]);
      field.focus();
      if (field.localName === 'input') field.reportValidity();
    }
    return !invalid.length;
  };

  static httpError = value => {
    if (!value.trim()) return 'Укажите URL сервиса или выберите пресет.';
    if (!URL.canParse(value)) return 'Например: https://api.anthropic.com или http://localhost:11434.';
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return 'Разрешены только адреса с http:// или https://.';
    return url.username || url.password || url.search || url.hash ? 'Уберите логин, пароль и часть адреса после ? или #.' : '';
  };
}
