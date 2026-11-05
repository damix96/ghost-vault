export class SecretCleanup {
  static message = 'Очистка прежних открытых копий в рабочей базе ещё не завершена. GhostVault повторит её при следующем успешном изменении хранилища.';

  static notice = (app, result) => {
    if (result?.notice?.code !== 'SECRET_STORAGE_CLEANUP_PENDING') return false;
    app.cleanupPending = true;
    SecretCleanup.render(app);
    return true;
  };

  static observe = (app, data) => {
    if (typeof data?.retention?.cleanupPending === 'boolean') app.cleanupPending = data.retention.cleanupPending;
    SecretCleanup.render(app);
  };

  static render = app => {
    const status = document.getElementById('secretCleanupNotice');
    if (!status) return;
    status.message = app.cleanupPending ? SecretCleanup.message : '';
    status.hidden = !app.cleanupPending;
  };
}
