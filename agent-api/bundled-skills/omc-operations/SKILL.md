---
name: omc-operations
description: Query, diagnose, configure, and operate any connected OMC through its version-matched API handbook and the Action Connector CLI. Use for OMC devices, alarms, topology, performance, MML, configuration, software, files, tasks, users, logs, integrations, or system administration.
---

# OMC Operations

Use the handbook published by the connected OMC, then execute the selected operation through the Action Connector CLI as the current OMC user. OMC remains authoritative for API contracts, identity, permissions, policy, and business data.

## Prepare the matching handbook

The request context includes `externalIdentity.metadata.apiHandbook`. It identifies the exact handbook with `handbookDigest` and provides the package endpoints. The runtime prompt also provides the absolute Action Connector CLI path.

Use the absolute directory from which this `SKILL.md` was loaded as `SKILL_ROOT`. Do not derive it from `CODEX_HOME`, inspect the filesystem to find it, or retry the loader through an alternate path after a successful exit. Set these paths once when shell commands need them:

```bash
SKILL_ROOT="<absolute directory containing this SKILL.md>"
CLI=.agent-studio/action-connector-cli.mjs
```

Before the first unfamiliar OMC operation in a conversation, run:

```bash
node "$SKILL_ROOT/scripts/ensure-handbook.mjs" --cli "$CLI"
```

The command prints compact JSON containing `handbookRoot`, `indexPath`, `commonOperationsPath`, `manifestPath`, `handbookDigest`, `catalogVersion`, `totalOperations`, and `status`. Use those exact paths. Do not run `find`, `ls`, or another filesystem discovery command to locate handbook files. Keep the values in the conversation. If later request context has the same `handbookDigest`, reuse them without running the loader again. If the digest changes, run the loader again. A fresh conversation may run it once; the content-addressed workspace cache then returns immediately without downloading the package.

Do not use an older handbook, guess an API path, call catalog/describe, or download the package manually. If package metadata is unavailable, invalid, or cannot be verified, explain that this OMC must be upgraded to publish its versioned Agent API handbook.

## Choose the shortest operation path

The returned `handbookRoot` contains:

- `api-index.jsonl`: one compact searchable line for every operation.
- `api-categories/<category>.json`: the candidates in one domain.
- `api-docs/<operationId>.json`: the complete contract for one operation.
- `manifest.json`: the verified handbook version and inventory.

Follow the shortest safe path:

1. Reuse an operation and parameters that already succeeded in this conversation when they still answer the request.
2. For a common operational goal, read `commonOperationsPath` once and use its documented fast path directly. Do not search the global index or open the detailed operation document when the fast path fully specifies the read operation.
3. For every other goal, search `indexPath` once with one focused expression containing the user's domain nouns and action. Do not repeat the same search with broader synonyms unless it returns no viable candidate.
4. If the result is genuinely ambiguous, read one category index. Otherwise skip it.
5. Read the selected operation document once. Read the whole document in one command; do not split it across multiple `sed` calls.
6. Call the smallest set of business operations needed and stop when the evidence answers the user's goal.

Common fast path:

```bash
sed -n '1,320p' "$COMMON_OPERATIONS_PATH"
```

Unknown-operation discovery:

```bash
rg -i 'device.*(online|status)|(online|status).*device' "$INDEX_PATH"
cat "$HANDBOOK_ROOT/api-docs/get.devices.stats.json"
```

Use the operation document as follows:

- `summary`, `description`, and `intents`: confirm it answers the user's goal.
- `pathParams`: replace every `:name` with a real identifier.
- `queryParams`: send only relevant filters and pagination.
- `requestBody` and `formParams`: construct the documented shape exactly.
- `responses`, `referencedSchemas`, and `emptyResult`: interpret evidence correctly.
- `risk`, `confirmationRequired`, `sideEffects`, and `idempotent`: apply write safety.

Never scan all detailed documents. Never inspect the handbook directory tree. Compare summaries in one category and open only enough operation documents to resolve ambiguity.

## Execute through the connector

Inspect external identity only when user or instance identity affects the answer:

```bash
node "$CLI" identity
```

Execute the documented operation directly:

```bash
node "$CLI" request GET /api/v1/devices/stats '{"operationId":"get.devices.stats","reason":"Read device status totals"}'
```

Include `query` and `body` only when documented:

```bash
node "$CLI" request GET /api/v1/devices '{"operationId":"get.devices","query":{"page":1,"page_size":20,"status":"online"},"reason":"List visible online devices"}'
```

For independent reads, start them together and label their outputs. Keep dependent calls sequential. Prefer a purpose-built summary operation over downloading a broad list and counting locally.

Do not call a list operation merely to reconfirm a zero count returned by a purpose-built summary. Fetch records only when the user requests examples, identifiers, affected objects, or the summary indicates records exist and details are needed.

## Respect identity and policy

- Every request runs as the current external OMC user and is checked against that user's permissions and the configured Agent policy.
- Never construct an OMC host, authorization header, token, database query, or alternate transport.
- Request only the exact `/api/v1` method and path in the verified handbook.
- Default to reads when the user's goal is informational.
- Before `confirmationRequired: true`, state the exact target, change, and expected impact, then obtain explicit confirmation.
- Execute writes only when both Connector policy and OMC permissions allow the method and risk.
- Never automatically retry a non-idempotent write or work around a denial.

## Answer from evidence

- Write for an operations user, not a developer. Put the operational conclusion first and use the user's language.
- Summarize the current state, affected scope, operational impact, and useful next action. Include only evidence that helps the user decide or act.
- Use familiar business terms such as devices, sites, alarms, tasks, configuration, status, and time. Do not expose API paths, HTTP methods, operation IDs, CLI commands, scripts, handbook versions, cache paths, raw payloads, model behavior, or internal execution steps unless the user explicitly asks for technical diagnostics.
- Do not say that an API was called or a handbook was searched. Say what was checked and what the system reported.
- Prefer a short paragraph or compact bullets. Use a table only when comparing several objects or metrics.
- Distinguish a valid empty result from unavailable data using the operation contract.
- For an empty result, say plainly what is absent and whether that means normal status, no managed objects, insufficient data, or limited visibility. Do not overstate system health when evidence is incomplete.
- For a blocked or failed operation, explain the user-visible reason and the next action. Keep technical diagnostics in the process trace, not the final answer.
- Before a change requiring confirmation, state only the target, intended change, expected impact, and whether it can be reversed. Ask one clear confirmation question.
- After a change, state whether it completed, what changed, and what the user should verify. Never claim success without evidence.
- Correct one clearly invalid parameter from the document; otherwise explain what prevented completion and how the user or administrator can resolve it.
- Never fabricate API output, hidden resources, or successful writes.
