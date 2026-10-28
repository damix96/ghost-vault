import ipRegex from 'ip-regex';
import { VaultDatabase } from './sqlite-db.js';

export class AnyIpRule {
  static id = 'pat_any_ip';
  static pattern = '(?<![\\w:.%])(?:' + ipRegex.v6().source + ')(?![\\w:.%])|(?<![\\w.])(?:' + ipRegex.v4().source + ')(?![\\w.])';

  static install = (db: VaultDatabase): void => {
    if (db.getSetting('rule_any_ip_installed', '') === '1') return;
    if (!db.getPatterns().some(rule => rule.id === AnyIpRule.id)) db.upsertPattern({ id: AnyIpRule.id, name: 'any-ip', pattern: AnyIpRule.pattern, type: 'ip', enabled: 1, created_at: new Date().toISOString() });
    db.setSetting('rule_any_ip_installed', '1');
  };
}
