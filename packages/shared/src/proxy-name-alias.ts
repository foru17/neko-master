/** An explicit, backend-scoped rule for grouping changing proxy names. */
export interface ProxyNameAlias {
  match: 'exact' | 'prefix';
  value: string;
  alias: string;
}

export const RESERVED_PROXY_NAMES = ['DIRECT', 'REJECT', 'REJECT-DROP', 'PASS', 'COMPATIBLE'] as const;

export function sortProxyNameAliases(rules: readonly ProxyNameAlias[]): ProxyNameAlias[] {
  return [...rules].sort((a, b) =>
    Number(b.match === 'exact') - Number(a.match === 'exact') || b.value.length - a.value.length,
  );
}

export function normalizeProxyName(name: string, rules: readonly ProxyNameAlias[]): string {
  if (RESERVED_PROXY_NAMES.some(reserved => reserved === name)) return name;
  let prefix: ProxyNameAlias | undefined;
  for (const rule of rules) {
    if (rule.match === 'exact' && name === rule.value) return rule.alias;
    if (rule.match === 'prefix' && name.startsWith(rule.value) && (!prefix || rule.value.length > prefix.value.length)) {
      prefix = rule;
    }
  }
  return prefix?.alias ?? name;
}

/** Only the first (exit proxy) hop changes; policy/group names stay intact. */
export function normalizeProxyChain(chain: string, rules: readonly ProxyNameAlias[]): string {
  const boundary = chain.indexOf(' > ');
  const name = boundary < 0 ? chain : chain.slice(0, boundary);
  return normalizeProxyName(name, rules) + (boundary < 0 ? '' : chain.slice(boundary));
}

export function validateProxyNameAliases(value: unknown): ProxyNameAlias[] {
  if (!Array.isArray(value) || value.length > 50) {
    throw new Error('Expected an array of at most 50 proxy name rules');
  }
  const seen = new Set<string>();
  const rules = value.map((item: unknown): ProxyNameAlias => {
    if (!item || typeof item !== 'object') throw new Error('Invalid proxy name rule');
    const rule = item as Record<string, unknown>;
    if (rule.match !== 'exact' && rule.match !== 'prefix') throw new Error('Match must be exact or prefix');
    for (const key of ['value', 'alias'] as const) {
      const text = rule[key];
      if (typeof text !== 'string' || !text.trim() || (key === 'alias' && (text !== text.trim() || text.includes('>'))) || text.length > 256 || text.includes(' > ') || /[\x00-\x1f]/.test(text)) {
        throw new Error('Names must contain 1–256 characters without chain separators or control characters');
      }
    }
    const parsed: ProxyNameAlias = { match: rule.match, value: rule.value as string, alias: rule.alias as string };
    if (RESERVED_PROXY_NAMES.some(name => name === parsed.alias || (parsed.match === 'exact' ? name === parsed.value : name.startsWith(parsed.value)))) {
      throw new Error('Built-in proxy names cannot be aliased');
    }
    const key = JSON.stringify([parsed.match, parsed.value]);
    if (seen.has(key)) throw new Error('Duplicate proxy name match');
    seen.add(key);
    return parsed;
  });
  if (rules.some(rule => normalizeProxyName(rule.alias, rules) !== rule.alias)) {
    throw new Error('Aliases must be stable: an alias cannot be renamed by another rule');
  }
  return rules;
}
