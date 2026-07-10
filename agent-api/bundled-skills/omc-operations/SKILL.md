---
name: omc-operations
description: Query, diagnose, configure, and operate OMC network management systems through the Action Connector CLI. Use for any OMC request involving devices, alarms, topology, performance, MML, configuration, software, files, tasks, users, logs, integrations, or system administration. Includes a complete versioned /api/v1 handbook with local category indexes and one detailed document per operation.
---

# OMC Operations

Use the local API handbook to select an operation, then use the Action Connector CLI to execute it as the current OMC user. OMC remains authoritative for identity, permissions, policy, and business data.

## Follow the shortest safe path

1. Reuse an operation and parameters that already succeeded in this conversation when they still answer the request.
2. For a common intent, read [common-operations.md](references/common-operations.md) and call its operation directly.
3. For any other intent, verify the handbook version, search one local category index, and read only the selected operation document.
4. Call the smallest set of business APIs needed. Run independent reads concurrently; keep dependent reads sequential.
5. Stop when returned evidence is sufficient. Do not rediscover or repeat unchanged reads unless freshness matters.

Never call a remote API catalog or describe endpoint during normal discovery. The complete API inventory and contracts are local Skill references.

## Verify the handbook once per version

The request context contains `externalIdentity.metadata.apiHandbook` with:

- `schemaVersion`
- `catalogVersion`
- `totalRoutes`

Read [manifest.json](references/manifest.json) before the first unfamiliar operation in a conversation. Its `schemaVersion`, `catalogVersion`, and `totalOperations` must match the connected OMC metadata. Reuse that result for later turns while the version remains unchanged.

If any value differs, do not guess a path and do not use an older remote-discovery workflow. Explain that the Agent API handbook does not match the connected OMC version and that an administrator must synchronize the `omc-operations` Skill before this operation can be performed safely.

## Load API knowledge progressively

The Skill is organized in three local layers:

- `references/api-index.jsonl`: one compact searchable line for every operation across all domains.
- `references/api-categories/<category>.json`: compact intent index for every operation in one domain.
- `references/api-docs/<operationId>.json`: the selected operation's method, path, parameters, request body, response contract, risk, side effects, idempotency, and source evidence.

Set the materialized Skill path once when shell access needs an absolute path:

```bash
SKILL_ROOT="${CODEX_HOME:-$HOME/.codex}/skills/omc-operations"
```

Use one or two domain nouns from the user's intent to search the compact global index locally. Each matching line includes the operation ID, category, method, path, semantics, risk, and detailed document path:

```bash
rg -i 'device|online|status' "$SKILL_ROOT/references/api-index.jsonl"
```

When the global result is ambiguous, use its `category` value to read the corresponding `references/api-categories/<category>.json` and compare only that domain's candidates. Never search all detailed documents.

Choose the narrowest matching operation and read exactly its `document` path:

```bash
sed -n '1,240p' "$SKILL_ROOT/references/api-docs/get.devices.stats.json"
```

Use the operation document as follows:

- `summary`, `description`, and `intents`: confirm that the operation answers the user's actual goal.
- `pathParams`: replace every `:name` segment with a real identifier from the user or an earlier API result.
- `queryParams`: send only relevant filters and pagination; respect type, enum, default, minimum, and maximum metadata.
- `requestBody` and `formParams`: construct the documented shape exactly.
- `responses` and `referencedSchemas`: interpret returned fields when schemas are available.
- `emptyResult`: distinguish a valid empty result from missing or failed data.
- `risk`, `confirmationRequired`, `sideEffects`, and `idempotent`: apply write safety before execution.

If several candidates remain after reading one category index, compare their summaries there. Open at most the documents needed to resolve the ambiguity; do not scan the full handbook.

## Use the connector CLI

The runtime injects the absolute CLI path into the request prompt. Use that path when present; otherwise set:

```bash
CLI=.agent-studio/action-connector-cli.mjs
```

Inspect external identity only when user or instance identity affects the answer:

```bash
node "$CLI" identity
```

Execute the documented operation directly:

```bash
node "$CLI" request GET /api/v1/devices/stats '{"operationId":"get.devices.stats","reason":"Read device status totals"}'
```

Include `query` and `body` only when the operation document requires them:

```bash
node "$CLI" request GET /api/v1/devices '{"operationId":"get.devices","query":{"page":1,"page_size":20,"status":"online"},"reason":"List visible online devices"}'
```

For independent reads, start them together and label their outputs. Never parallelize calls when a later path or parameter depends on an earlier result.

## Plan multi-step work

- Prefer a purpose-built summary operation over downloading a list and counting locally.
- Use list operations when the user needs records, names, identifiers, filters, or evidence.
- For a dependent workflow, use the first result to select identifiers or parameters for the next documented operation.
- Keep payloads small with filters and pagination. Do not request broad lists speculatively.
- Reuse valid results already present in the conversation. Repeat a read only when the requested value is time-sensitive or the user asks to refresh it.
- Web search may be available, but never use Web results as a substitute for OMC business state or API execution. Use Web only when the user explicitly needs external public information.

## Respect identity and policy

- Every request executes as the current external OMC user and is checked against that user's permissions plus the configured Agent policy.
- Never construct an OMC host, authorization header, token, database query, or alternate transport.
- Request only the exact `/api/v1` method and path documented by this version-matched handbook.
- Default to reads when the user's goal is informational.
- Before any operation with `confirmationRequired: true`, state the exact target, change, and expected impact, then obtain explicit user confirmation.
- Execute a write only when both the connector policy and OMC permissions allow its method and risk level.
- Never automatically retry a non-idempotent write.
- Do not work around a denied method, blocked path, permission error, or handbook version mismatch.

## Answer from evidence

- Put the conclusion first and use the user's language.
- Summarize relevant values and affected objects; do not paste raw JSON or narrate routine handbook lookup.
- Follow operation-specific empty-result guidance. If no special guidance exists, report the observed limitation instead of guessing.
- If a read fails because one clearly invalid parameter was supplied, correct it once from the operation document. Otherwise explain what prevented completion.
- Never fabricate API output, hidden resources, or successful writes.
- Mention confirmation requirements only when the requested action would change the system.
