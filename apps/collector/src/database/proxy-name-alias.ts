import type Database from 'better-sqlite3';
import { normalizeProxyChain, sortProxyNameAliases, validateProxyNameAliases, type ProxyNameAlias } from '@neko-master/shared';

const caches = new WeakMap<Database.Database, Map<number, ProxyNameAlias[]>>();
const columns = new WeakMap<Database.Database, Map<string, string[]>>();
export const proxyNameAliasKey = (backendId: number): string => `proxy_name_aliases:${backendId}`;

function loadProxyNameAliases(db: Database.Database, backendId: number): ProxyNameAlias[] {
  let cache = caches.get(db);
  if (!cache) {
    cache = new Map();
    caches.set(db, cache);
  }
  const cached = cache.get(backendId);
  if (cached) return cached;
  const row = db.prepare('SELECT value FROM app_config WHERE key = ?').get(proxyNameAliasKey(backendId)) as { value: string } | undefined;
  const rules = row ? validateProxyNameAliases(JSON.parse(row.value)) : [];
  cache.set(backendId, rules);
  return rules;
}

export function getProxyNameAliases(db: Database.Database, backendId: number): ProxyNameAlias[] {
  return loadProxyNameAliases(db, backendId).map(rule => ({ ...rule }));
}

export function saveProxyNameAliases(db: Database.Database, backendId: number, value: unknown): ProxyNameAlias[] {
  const rules = validateProxyNameAliases(value);
  db.prepare('INSERT INTO app_config (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(proxyNameAliasKey(backendId), JSON.stringify(rules));
  caches.get(db)?.delete(backendId);
  return rules;
}

export function deleteProxyNameAliases(db: Database.Database, backendId: number): void {
  db.prepare('DELETE FROM app_config WHERE key = ?').run(proxyNameAliasKey(backendId));
  caches.get(db)?.delete(backendId);
}

/** Identical literal matching in both SQL engines; no user-provided SQL or regex. */
export function proxyChainExpression(column: string, rules: readonly ProxyNameAlias[], engine: 'sqlite' | 'clickhouse'): string {
  if (!rules.length) return column;
  const quote = (value: string): string => {
    const escaped = engine === 'clickhouse' ? value.replace(/\\/g, '\\\\') : value;
    return `'${escaped.replace(/'/g, "''")}'`;
  };
  const hop = engine === 'sqlite'
    ? `(CASE WHEN instr(${column}, ' > ') > 0 THEN substr(${column}, 1, instr(${column}, ' > ') - 1) ELSE ${column} END)`
    : `arrayElement(splitByString(' > ', ${column}), 1)`;
  const cases = sortProxyNameAliases(rules).map(rule => {
    const condition = rule.match === 'exact' ? `${hop} = ${quote(rule.value)}` : engine === 'sqlite'
      ? `substr(${hop}, 1, length(${quote(rule.value)})) = ${quote(rule.value)}`
      : `startsWith(${hop}, ${quote(rule.value)})`;
    const replacement = engine === 'sqlite'
      ? `${quote(rule.alias)} || substr(${column}, length(${hop}) + 1)`
      : `concat(${quote(rule.alias)}, substring(${column}, length(${hop}) + 1))`;
    return `WHEN ${condition} THEN ${replacement}`;
  });
  return `(CASE ${cases.join(' ')} ELSE ${column} END)`;
}

/** Read-only projection: normalization happens before filters, grouping and LIMIT. */
export function aliasedStatsTable(db: Database.Database, table: string, backendId: number): string {
  const rules = loadProxyNameAliases(db, backendId);
  if (!rules.length) return table;
  if (!/^[a-z_]+$/.test(table)) throw new Error('Invalid statistics table');
  let cache = columns.get(db);
  if (!cache) {
    cache = new Map();
    columns.set(db, cache);
  }
  let names = cache.get(table);
  if (!names) {
    names = (db.pragma(`table_info(${table})`) as Array<{ name: string }>).map(row => row.name);
    cache.set(table, names);
  }
  const projection = names.map(name => name === 'chain' || name === 'final_proxy'
    ? `${proxyChainExpression(name, rules, 'sqlite')} AS ${name}` : name);
  return `(SELECT ${projection.join(', ')} FROM ${table} WHERE backend_id = ${backendId})`;
}

export function aliasChain(db: Database.Database, backendId: number, chain: string): string {
  return normalizeProxyChain(chain, loadProxyNameAliases(db, backendId));
}
