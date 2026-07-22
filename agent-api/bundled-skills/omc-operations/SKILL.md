---
name: omc-operations
description: Query, diagnose, configure, and operate any connected OMC through its version-matched API handbook and the Action Connector CLI. Use for OMC devices, alarms, topology, performance, MML, configuration, software, files, tasks, users, logs, integrations, or system administration.
---

# OMC Operations

Use the connected OMC's handbook and execute operations through the Action Connector CLI as the current OMC user. OMC is authoritative for contracts, identity, permissions, policy, and data.

## Prepare discovery

The request context contains `externalIdentity.metadata.apiHandbook`; the runtime prompt provides the CLI path. Set once:

```bash
SKILL_ROOT="<absolute directory containing this SKILL.md>"
CLI=.agent-studio/action-connector-cli.mjs
```

When `apiHandbook.packageAvailable` is `true`, prepare the matching handbook before the first unfamiliar operation:

```bash
node "$SKILL_ROOT/scripts/ensure-handbook.mjs" --cli "$CLI"
```

Keep its `handbookRoot`, `indexPath`, `commonOperationsPath`, `manifestPath`, `handbookDigest`, and `catalogVersion` in the conversation. Reuse them while the digest matches; rerun only after it changes. Do not inspect the directory tree, download manually, use an older handbook, or guess paths.

When `packageAvailable` is `false`, use compatibility discovery:

```bash
node "$SKILL_ROOT/scripts/search-catalog.mjs" --cli "$CLI" --query "domain action"
node "$CLI" describe operationId
```

The helper broadens strict empty matches. Use its final candidates, describe promising operations, and do not mix compatibility discovery with a valid downloaded handbook.

## Explore within a budget

The handbook provides `api-index.jsonl`, category indexes, operation documents, and common operations. Use this order:

1. Reuse a previously successful operation when its contract and parameters still match.
2. Use common operations only for exact domain matches. Never substitute between operations, file transfer, upgrades, MML, or other task systems.
3. Search with the user's domain, action, page context, and visible terms. Try synonyms, route terms, parameter names, or enum values when unclear.
4. Continue only while discovery yields new relevant evidence. Stop when the contract is identified, results repeat, or the next query lacks evidence. Read each selected document once; use its contract and risk metadata.
5. Follow identifiers from list or summary results into documented detail operations when needed. Keep dependent calls sequential; run independent reads together.
6. Stop when the evidence answers the user's goal. Do not scan every detailed document.

Example discovery:

```bash
rg -i 'transfer|log collection|failureReason|RUNTIME_LOG_COLLECT' "$INDEX_PATH"
cat "$HANDBOOK_ROOT/api-docs/get.ufte.devices.json"
```

An empty search attempt is not evidence that a capability is unavailable. An empty API result means only that the called operation has no visible data under those filters. Report an unavailable capability only after the search budget, relevant categories, and viable candidate contracts are exhausted. If documentation is too generic to decide, state that the correct operation could not be identified; do not claim it does not exist.

## Execute through the connector

Inspect identity only when user or instance identity matters:

```bash
node "$CLI" identity
```

Execute the confirmed contract directly:

```bash
node "$CLI" request GET /api/v1/devices '{"operationId":"get.devices","query":{"page":1,"page_size":20,"status":"online"},"reason":"List visible online devices"}'
```

Send only documented parameters. Prefer purpose-built summaries over broad downloads, and fetch records only when the user needs examples, identifiers, affected objects, or a dependent lookup.

## Respect identity and policy

- Every request runs as the external OMC user and is checked against that user's permissions and Agent policy.
- Never construct a host, authorization header, token, database query, alternate transport, or undocumented path.
- Default to reads for informational goals.
- Before a confirmed write, state the exact target, change, impact, and reversibility; execute only after explicit confirmation and policy approval.
- Never retry a non-idempotent write automatically or work around a denial.

## Answer from evidence

- Lead with the operational conclusion in the user's language, then affected scope, impact, and useful next action.
- Hide API paths, HTTP methods, operation IDs, CLI commands, handbook details, and raw payloads unless technical diagnostics are requested.
- Distinguish no data, limited visibility, unavailable documentation, denied access, and execution failure.
- Do not overstate system health from incomplete evidence or fabricate output, hidden resources, or successful changes.
- For a blocked operation, explain the user-visible reason and next action. After a change, report what completed and what should be verified.
