# OMC API Domain Index

Use this index to choose a likely live catalog category. Category names and route counts come from the connected OMC instance and can change by version, modules, permissions, and Agent policy.

| User intent | Likely categories | Search tokens |
|---|---|---|
| Device inventory, online state, details, parameters | `devices`, `device-groups`, `sites` | `stats`, `status`, `serial`, `parameters`, `groups` |
| Dashboard and network overview | `dashboard` | `summary`, `device status`, `trend` |
| Active, historical, or statistical alarms | `alarms`, `alarm-filters`, `alarm-libraries`, `notifications` | `active`, `history`, `statistics`, `severity` |
| Topology, nodes, links, cells, base stations | `topology`, `gnb`, `cell` | `nodes`, `links`, `status`, `detail` |
| Performance counters, KPIs, MR, reports | `pm`, `mr`, `reports` | `metrics`, `kpi`, `trend`, `report` |
| Configuration, parameters, templates | `config`, `sysConfig`, `templates` | `parameters`, `templates`, `compare`, `apply` |
| MML commands and records | `mml` | `commands`, `records`, `execute` |
| Firmware, software, upgrade work | `firmware`, `software`, `upgrade-tasks` | `versions`, `packages`, `tasks`, `upgrade` |
| Files, transfer, backup, restore | `files`, `backup` | `list`, `transfer`, `download`, `backup` |
| Operations, provisioning, scheduled work | `ops`, `tasks`, `provisioning` | `tasks`, `status`, `executions`, `provision` |
| Users, roles, permissions, audit, logs | `users`, `roles`, `permissions`, `audit-logs`, `logs` | `list`, `roles`, `audit`, `events` |
| License, runtime, and system administration | `system-license`, `system` | `info`, `status`, `health`, `license` |
| Northbound integrations | `northbound` | `destinations`, `status`, `configuration` |

If none of these categories exists, call `/api/v1/agent/catalog/categories` and choose from the returned live index. Then search only that category:

```bash
node "$CLI" request GET /api/v1/agent/catalog '{"operationId":"agent.catalog.search","query":{"category":"alarms","q":"active","limit":8},"reason":"Find the active-alarm API"}'
```

Search uses token-AND matching and normalizes `/`, `.`, `_`, `-`, and `:`. Prefer resource/path words such as `devices stats`; avoid long natural-language sentences.

Use one or two resource words on the first search. Do not include result semantics such as `list`, `enabled`, `status`, or `current` unless that word is visibly part of the API path. If the scoped search returns no items, retry the same category once with an empty `q` instead of repeatedly changing keywords.

The live catalog contains every route currently visible under the OMC Agent policy. Read methods are visible when reads are enabled; write methods appear only when the corresponding policy allows them.
