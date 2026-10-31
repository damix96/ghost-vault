import { VaultDatabase, RouteRow } from '../vault/sqlite-db.js';
import { DefaultRoutes } from '../vault/default-routes.js';

export class RouteAvailability {
  constructor(private db: VaultDatabase, private hasHistory: (prefix: string) => boolean = () => false) {}

  public isUnusedPreset = (route: RouteRow): boolean => {
    const original = DefaultRoutes.definitions.find(item => item[0] === route.id);
    if (route.is_custom || !original || route.name !== original[1]) return false;
    if (![original[3], original[3] + '/v1'].includes(route.upstream_url)) return false;
    let visible: string[] = [];
    try { visible = JSON.parse(this.db.getSetting('dashboard_workspace', '{}')).visible || []; } catch { return false; }
    return !visible.includes(route.id) && !this.hasHistory(route.prefix);
  };
}
