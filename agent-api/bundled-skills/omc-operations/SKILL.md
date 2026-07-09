---
name: omc-operations
description: Query and operate OMC network management systems through the Action Connector CLI, using the complete live /api/v1 catalog for devices, alarms, topology, performance, MML, configuration, software, files, tasks, users, logs, and system administration. Use whenever a user asks to inspect, diagnose, summarize, configure, or execute an OMC operation.
---

# OMC Operations

Use the OMC instance's live API catalog as the authority. Static references in this skill are navigation and fast paths, not a frozen API inventory.

## Choose the shortest valid path

1. Reuse an operation that already succeeded in this conversation when it still answers the request.
2. For a common intent, use the hot route table below and call the API directly. Read [common-operations.md](references/common-operations.md) only when parameters or empty-result semantics matter.
3. For an unfamiliar intent, read [domain-index.md](references/domain-index.md), choose one likely category, and search that category.
4. Describe an operation only when required parameters, request body, path variables, or write behavior remain unclear.
5. Call the smallest set of APIs needed to answer. Run independent reads together rather than waiting for each one sequentially.
6. Stop discovery as soon as the returned data is sufficient.

Do not rediscover a known operation merely because a new user turn started. Rediscover only when a request fails because the route is unavailable, the catalog version changed, or the requested semantics differ.

## Use hot routes directly

| Intent | Method and path | operationId |
|---|---|---|
| Online/offline/device totals | `GET /api/v1/devices/stats` | `get.devices.stats` |
| Broad network overview | `GET /api/v1/dashboard/summary` | `get.dashboard.summary` |
| Device records or identifiers | `GET /api/v1/devices` | `get.devices` |
| Current active alarm records | `GET /api/v1/alarms/active` | `get.alarms.active` |
| Alarm totals or severity distribution | `GET /api/v1/alarms/statistics` | `get.alarms.statistics` |
| Operations task list | `GET /api/v1/ops/tasks` | `get.ops.tasks` |
| Runtime system information | `GET /api/v1/system/info` | `get.system.info` |

For these intents, do not call catalog or describe first. Use `page=1&page_size=20` for record lists unless the user requests another range.

## Use the connector CLI

The runtime creates the CLI at `.agent-studio/action-connector-cli.mjs` and injects its absolute path into the request prompt. Use that injected path when available; otherwise set:

```bash
CLI=.agent-studio/action-connector-cli.mjs
```

Inspect the external identity only when user or instance identity matters:

```bash
node "$CLI" identity
```

List the live categories when the domain is uncertain:

```bash
node "$CLI" request GET /api/v1/agent/catalog/categories '{"operationId":"agent.catalog.categories","reason":"Choose the relevant OMC API category"}'
```

Search one category with concise path or resource tokens and a small result limit:

```bash
node "$CLI" request GET /api/v1/agent/catalog '{"operationId":"agent.catalog.search","query":{"category":"devices","q":"status","limit":8},"reason":"Locate the smallest API for this request"}'
```

Describe only the selected candidate when needed:

```bash
node "$CLI" describe get.devices.by-id
```

Call a confirmed API:

```bash
node "$CLI" request GET /api/v1/devices/stats '{"operationId":"get.devices.stats","reason":"Read device status totals"}'
```

The catalog is paginated. Follow `nextOffset` only when `hasMore` is true and the current page has not provided a suitable operation. Keep `limit` at 8 or below for normal discovery.

## Plan tool calls

- Prefer one purpose-built summary endpoint over a list endpoint plus local counting.
- Use list endpoints only when the user needs records, names, identifiers, filtering, or evidence.
- Query independent resources in one shell invocation so the connector can execute them concurrently.
- Keep result payloads small with filters and pagination. Do not request broad catalogs or long record lists speculatively.
- Treat results from the current conversation as usable context; do not repeat unchanged reads unless freshness matters.

## Respect identity and policy

- The OMC executes every call as the current external user and enforces that user's permissions plus the configured Agent policy.
- Never construct an OMC host, authorization header, token, database query, or alternate transport.
- Request only `/api/v1` paths exposed by the live catalog or documented as connector control endpoints in this skill.
- Default to reads.
- Before a write, state the target and impact, obtain explicit user confirmation, and proceed only when the connector policy permits the method and risk level.
- Never automatically retry a non-idempotent write.
- Do not work around a denied method, blocked path, or permission error.

## Answer from evidence

- Put the user-facing conclusion first, in the user's language.
- Summarize relevant values and affected objects; do not paste raw JSON or narrate routine API discovery.
- Distinguish zero records from missing data. Use endpoint-specific empty-result guidance in [common-operations.md](references/common-operations.md); otherwise state the limitation rather than guessing.
- If an API fails, adjust a clearly invalid parameter once or explain what prevented completion. Do not fabricate a result.
- Mention confirmation requirements only when a requested operation would change the system.
