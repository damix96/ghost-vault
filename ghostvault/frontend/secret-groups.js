export class SecretGroups {
  static prefix = key => {
    const split = key.lastIndexOf('_');
    return split > 0 && split < key.length - 1 ? key.slice(0, split) : null;
  };

  static compare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
  static matches = (secret, query) => [secret.key, secret.isSecret ? undefined : secret.realValue, secret.alias, secret.description].some(value => String(value || '').toLowerCase().includes(query));

  static collect = (secrets, query = '') => {
    const buckets = new Map();
    const singles = [];
    const q = query.toLowerCase().trim();
    for (const secret of secrets) {
      const prefix = SecretGroups.prefix(secret.key);
      if (prefix === null) { singles.push(secret); continue; }
      if (!buckets.has(prefix)) buckets.set(prefix, []);
      buckets.get(prefix).push(secret);
    }
    const groups = [];
    for (const [prefix, entries] of buckets) {
      if (entries.length < 2) { singles.push(...entries); continue; }
      groups.push({ prefix, total: entries.length, entries: entries.filter(secret => SecretGroups.matches(secret, q)).sort((a, b) => SecretGroups.compare(a.key, b.key)) });
    }
    groups.sort((a, b) => SecretGroups.compare(a.prefix, b.prefix));
    return { groups, singles: singles.filter(secret => SecretGroups.matches(secret, q)).sort((a, b) => SecretGroups.compare(a.key, b.key)) };
  };
}
