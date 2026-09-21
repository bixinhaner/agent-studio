# Connector Assistant lifecycle v1

## Scope and ownership

This is an incremental extension of the existing Action Connector runtime, not a second Harness or workflow engine. The paired xOMC implementation is https://github.com/bixinhaner/xomc/pull/1 .

xOMC owns assistant identity, owner/role, capability publication, editable draft, immutable published version, trigger scheduling, execution authorization and private result visibility. Studio owns generic planning, immutable execution snapshots, the bounded background queue and model/tool execution. There is no independently editable copy of the business definition in Studio. A run carries its complete version snapshot; subsequent edits never change an already accepted run.

New assistants do not depend on the four built-in xOMC scenario names. Those scenarios remain on their existing compatibility path. They are not migrated by this PR; limitations of the old Finding projection and background identity are not presented as fixed by the new private-assistant path.

## Request flow

```
xOMC draft + current capability catalog
  -> AssistantPlanner -> validated planning response -> xOMC draft CAS
xOMC trial or published trigger
  -> immutable assistant-runs request -> PostgreSQL Run queue
  -> existing ActionConnectorRuntimeService / Codex runner / UsageRecorder
  -> durable GET tool invocation -> xOMC local ticket + current ACL checks
  -> structured result -> xOMC private run ledger / Attention
```

Planning cannot call business tools. It receives only the supplied catalog and conversation and returns `ready`, `needs_input`, or `unsupported`. It must not invent operation IDs, resource IDs, historical coverage or unsupported triggers. At most three material questions are returned. Creating a plan is not permission to execute it.

## Service-token API

All routes use the existing connector-scoped service-token middleware; credentials are never sent to the browser. Prefix: `/api/action-connectors/:connectorId`.

| Method and suffix | Purpose |
| --- | --- |
| `POST /assistant-builder/plan` | Bounded planning call; input includes current definition, conversation, catalog, events, locale and external user ID |
| `POST /assistant-runs` | Idempotently accept a complete immutable run snapshot |
| `GET /assistant-runs/:runId` | Return status, structured output, error and bounded tool progress |
| `POST /proactive/runs/:runId/cancel` | Existing cancellation route; terminal states do not become active again |
| `POST /tool-invocations/lease` | Existing durable GET tool transport |
| `POST /tool-invocations/:invocationId/result` | Existing fenced tool-result transport |

Canonical schemas are in `agent-api/src/integrations/action-connector/assistants/contracts.ts`. `runId` and `assistantId` are UUIDs. A repeated run ID with a different connector or payload is rejected; an exact replay returns the same run, including its terminal status. `definitionDigest` is an opaque version binding supplied by xOMC, not a substitute for local authorization.

The generic result has `outcome: finding | no_change | insufficient_data`, title, summary, facts with evidence references, hypotheses and next steps. A positive/no-change outcome requires a successful business-data call. Every fact reference must name a successful operation from this execution attempt. This checks provenance, not factual entailment or model correctness.

## Reliability and security

Runs are continuously claimed from PostgreSQL with compare-and-swap, four in-process execution slots, a 30-second lease renewed every 10 seconds, and at most three execution attempts after expired leases. This replaces the old startup-only drain. A per-connector pending-count guard limits accidental queue growth; it is not a billing quota or a strict distributed rate limiter.

Tool invocations bind `runAttempt`; workers cannot claim or complete old-attempt work. Cancellation signals the local runtime, expires pending tools and protects terminal writes with the worker/attempt/state guard. Other processes discover cancellation during lease renewal or tool polling. External processes that ignore abort may finish computation, but cannot publish a successful result over a cancelled run. Shutdown leaves recovery to lease expiry rather than labelling every interrupted run failed.

Defaults: 120-second execution deadline, 18 tool calls, 32 KiB final output. Legacy scenario and assistant registrations remain GET-only; discovery assistants use the frozen operation/method grant. A local xOMC execution ticket, not model-supplied paths or scopes, is the final authority. No direct credentials, arbitrary SQL, or workflow code are added. Discovery assistants may execute task-authorized HTTP methods when xOMC policy and user permissions also allow them.

The existing Codex runner continues to select providers, prepare runtime context and record usage through `UsageRecorder`; neither planner nor assistant engine implements parallel token accounting.

## Continuous assistant conversations

Upgraded source systems send `contextScopeDigest`, an opaque SHA-256 binding of the owner, role and data visibility. Studio uses the assistant ID plus this binding, the selected resource scope and effective API authorization to derive a stable conversation. The existing Action Connector binding also isolates connector and external owner. Subsequent runs, ordinary goal revisions and recovery attempts reuse the same business thread, Codex thread and workspace. They do not import earlier per-run conversations.

An authorization or resource-scope change selects a separate context; historical observations from another permission scope must not be replayed into the new one. Pre-upgrade requests without the authoritative digest retain their previous per-attempt isolation. No new database table or migration is required. Deploy Studio before the upgraded xOMC source.

The shared runner holds a PostgreSQL conversation lock from before bridge-file preparation through final message and usage recording. Nested thread-restoration locks reuse its connection. Recovery attempts have distinct message IDs in the same conversation; existing run-attempt fencing, cancellation and uncertain-write recovery guards still apply.

Every turn supplies the current complete definition and current-run authorization. Earlier context can guide follow-up, but current-state facts still require fresh business calls from this run. Static API contracts and the digest-verified handbook workspace cache can be reused. Provider prompt-cache hits are measured through the existing `UsageRecorder` cached-input fields, not assumed or guaranteed by a stable thread ID. Runtime compaction, model/provider changes and cache retention can affect reuse.

## Persistence and deployment

Prisma migration: `20260906000100_assistant_run_leases`. It adds run lease ownership/expiry, invocation attempt binding and indexes. Apply through the existing deployment process (`prisma migrate deploy`); do not use `db push` on production. Existing rows default to attempt zero and are reconciled by the worker.

Deploy Studio and its migration before the paired xOMC version. No automatic production deployment or branch merge is part of these PRs. For rollback, pause new xOMC assistants, allow/cancel in-flight work, stop new submissions and deploy the previous application version. The additive database columns may remain.

## Verification

```
bash scripts/ci/assistant-lifecycle.sh
```

The script installs locked dependencies, generates Prisma, builds TypeScript and runs Action Connector tests. Set `ASSISTANT_TEST_DATABASE_URL` only to a disposable database to run integration tests. CI uses PostgreSQL 17 and Node 22. Integration tests cover immutable replay/conflicts, real persistent tool leasing, cancellation/late completion, stale attempts and a backlog larger than 50 runs.

Database/tool tests use a controlled model runner. They do not demonstrate live Codex inference quality, production provider credentials, cross-process network configuration or business-data quality. Before production rollout, jointly test a real plan, a real GET-backed trial, a scheduled run while the browser is closed, permission revocation and cancellation using the intended xOMC/Studio deployment. Keep the PR in Draft until the release owner has reviewed those operational checks.

## API discovery protocol 1.1

New definitions may set `apiAccess: "discover"` and optional `allowedMethods` (GET by default). The planner preserves legacy definitions unless the user requests expanded access. Its compact capability index is not a substitute for execution-time catalog/describe and full Handbook inspection. Starting `operations` are hints, not a complete execution allowlist.

xOMC supplies `toolGrants` (operation ID + method) and `toolPolicy` in the immutable execution snapshot. Studio fails closed if an exploration run lacks this 1.1 grant, intersects it with task methods, and passes method/body through the existing durable bridge. xOMC remains authoritative for live permissions, blocked paths and scope. No connector/module-specific policy is implemented in Studio. Catalog reads are excluded from business evidence and counted against the normal tool budget.

Expired writes are never re-leased. Recovery of a run that has earlier write invocations stops with `ASSISTANT_WRITE_RECOVERY_REVIEW_REQUIRED`, retaining evidence for review. This prevents blind replay; it cannot undo a write that committed before cancellation or timeout. The runtime instructs the model to verify uncertain outcomes rather than retry them.

Deploy Studio before xOMC. No additional migration is required for these JSON snapshot fields. Existing protocol 1.0 assistants and built-in scenarios preserve fixed GET grants. Background binary attachment transfer remains unsupported; the interactive attachment path is unchanged.
