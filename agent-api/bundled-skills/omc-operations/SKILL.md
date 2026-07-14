---
name: omc-operations
description: Query, diagnose, configure, and operate any connected OMC through its version-matched API handbook and the Action Connector CLI. Use for OMC devices, alarms, topology, performance, MML, configuration, software, files, tasks, users, logs, integrations, or system administration.
---

# OMC Operations

Use the handbook published by the connected OMC, then execute the selected operation through the Action Connector CLI as the current OMC user. OMC remains authoritative for API contracts, identity, permissions, policy, and business data.

## Prepare the matching handbook

The request context includes `externalIdentity.metadata.apiHandbook`. It identifies the exact handbook with `handbookDigest` and provides the package endpoints. The runtime prompt also provides the absolute Action Connector CLI path.

Set these paths once when shell commands need them:

```bash
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/omc-operations"
CLI=.agent-studio/action-connector-cli.mjs
```

Before the first unfamiliar OMC operation in a conversation, run:

```bash
node "$SKILL_ROOT/scripts/ensure-handbook.mjs" --cli "$CLI"
```

The command prints compact JSON containing `handbookRoot`, `handbookDigest`, and `status`. Keep those values in the conversation. If later request context has the same `handbookDigest`, reuse that `handbookRoot` without running the loader again. If the digest changes, run the loader again. A fresh conversation may run it once; the content-addressed workspace cache then returns immediately without downloading the package.

Do not use an older handbook, guess an API path, call catalog/describe, or download the package manually. If package metadata is unavailable, invalid, or cannot be verified, explain that this OMC must be upgraded to publish its versioned Agent API handbook.

## Find one operation progressively

The returned `handbookRoot` contains:

- `api-index.jsonl`: one compact searchable line for every operation.
- `api-categories/<category>.json`: the candidates in one domain.
- `api-docs/<operationId>.json`: the complete contract for one operation.
- `manifest.json`: the verified handbook version and inventory.

Follow the shortest safe path:

1. Reuse an operation and parameters that already succeeded in this conversation when they still answer the request.
2. Search the compact global index with one or two domain nouns from the user's intent.
3. If results are ambiguous, read one category index.
4. Read only the selected operation document.
5. Call the smallest set of business APIs needed and stop when evidence is sufficient.

Example discovery:

```bash
rg -i 'device|online|status' "$HANDBOOK_ROOT/api-index.jsonl"
sed -n '1,240p' "$HANDBOOK_ROOT/api-docs/get.devices.stats.json"
```

Use the operation document as follows:

- `summary`, `description`, and `intents`: confirm it answers the user's goal.
- `pathParams`: replace every `:name` with a real identifier.
- `queryParams`: send only relevant filters and pagination.
- `requestBody` and `formParams`: construct the documented shape exactly.
- `responses`, `referencedSchemas`, and `emptyResult`: interpret evidence correctly.
- `risk`, `confirmationRequired`, `sideEffects`, and `idempotent`: apply write safety.

Never scan all detailed documents. Compare summaries in one category and open only enough operation documents to resolve ambiguity.

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

## Respect identity and policy

- Every request runs as the current external OMC user and is checked against that user's permissions and the configured Agent policy.
- Never construct an OMC host, authorization header, token, database query, or alternate transport.
- Request only the exact `/api/v1` method and path in the verified handbook.
- Default to reads when the user's goal is informational.
- Before `confirmationRequired: true`, state the exact target, change, and expected impact, then obtain explicit confirmation.
- Execute writes only when both Connector policy and OMC permissions allow the method and risk.
- Never automatically retry a non-idempotent write or work around a denial.

## Answer from evidence

- Put the conclusion first and use the user's language.
- Summarize relevant values and affected objects; do not paste raw JSON or narrate routine handbook loading.
- Distinguish a valid empty result from unavailable data using the operation contract.
- Correct one clearly invalid parameter from the document; otherwise explain what prevented completion.
- Never fabricate API output, hidden resources, or successful writes.
