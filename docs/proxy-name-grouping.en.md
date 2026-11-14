# Proxy name grouping

Some subscriptions append remaining traffic or expiry information to each proxy
name. The gateway reports those changing names as different proxies, so traffic
statistics become split across several entries.

Open **Settings → Preferences → Proxy name grouping**, select a backend, and add
an explicit matching rule:

| Field | Example |
| --- | --- |
| Match type | Name starts with |
| Original name or prefix | `US Node 01 - remaining:` |
| Stable display name | `US Node 01` |

Both `US Node 01 - remaining: 50GB` and `US Node 01 - remaining: 25GB` are then
counted under `US Node 01`. Keep the node number and subscription identifier in
the match; a broad prefix such as `US` will deliberately combine every matching
proxy. Use **Name equals** when you want to map a specific old name to an alias.
Several different matches can share the same alias.

## Behavior

- Rules apply only to the selected backend and are disabled by default (no rules).
- Exact matches take priority; otherwise the longest matching prefix wins.
- Matching is case-sensitive and literal. Regex and wildcard syntax are not used.
  Spaces in a matching prefix are significant, including a trailing space.
- Historical and live traffic are combined in proxy rankings, proxy domain/IP
  details, and domain/IP proxy traffic breakdowns. Time-range filters and result
  limits are applied to the combined data.
- Only the first proxy hop of a chain is renamed. Other hops, policy groups,
  gateway configuration and rule-flow topology keep their original names, so
  gateway policy matching and node selection continue to work.
- Raw stored traffic is never rewritten. Saving takes effect without restarting
  the collector or changing the agent protocol. Removing a rule restores separate
  statistics, including traffic recorded while the rule was active.
- Clearing traffic keeps the rules; deleting the backend removes its rules.

Up to 50 rules are allowed per backend. Match values and aliases must contain
1–256 characters, without control characters or a chain separator (` > `).
Aliases must not contain `>`, have surrounding spaces, or be renamed by another rule. Built-in
names such as `DIRECT` and `REJECT` cannot be matched or used as aliases.

The settings are stored in the existing SQLite `app_config` table, including
when ClickHouse provides the statistics. No schema migration is required.

## API

Read: `GET /api/db/proxy-name-aliases?backendId=1`

Save: `PUT /api/db/proxy-name-aliases`

```json
{
  "backendId": 1,
  "rules": [
    { "match": "prefix", "value": "US Node 01 - remaining:", "alias": "US Node 01" }
  ]
}
```

The response is `{ "rules": [...] }`. An empty array removes all grouping rules
for that backend. These endpoints use the existing authentication; writes are
forbidden in showcase mode.
