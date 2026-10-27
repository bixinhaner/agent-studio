---
name: boss-operations
description: Investigate telecom BOSS customer, subscriber, balance, recharge, charge, and order questions through the connected BOSS's version-matched API handbook and the Action Connector CLI. Use for customer-service and operations checks on a connected BOSS (Business and Operations Support System).
---

# BOSS Operations

Use the connected BOSS's API handbook and execute operations through the Action Connector CLI as the current BOSS user. BOSS is authoritative for contracts, identity, permissions, policy, and data.

## Progress updates

Users see your progress messages. Write them in the user's language as plain business steps, such as "Checking your recent recharges" or "Looking at the order's progress". Never mention the handbook, loader, digest, catalog, contracts, operation IDs, tool or CLI names, paths, file names, operation counts, or how you prepare or verify them. Do not narrate the setup below.

## Prepare the handbook (required)

The request context contains `externalIdentity.metadata.apiHandbook`; the runtime prompt provides the CLI path. Set once:

```bash
SKILL_ROOT="<absolute directory containing this SKILL.md>"
CLI=.agent-studio/action-connector-cli.mjs
```

Prepare the matching handbook before the first business operation:

```bash
node "$SKILL_ROOT/scripts/ensure-handbook.mjs" --cli "$CLI"
```

The loader reads the allowed handbook paths from the connector's API profile (`node "$CLI" profile`) and verifies the published digest. Keep its `handbookRoot`, `indexPath`, `commonOperationsPath`, `manifestPath`, `handbookDigest`, and `catalogVersion` in the conversation. Reuse them while the digest matches; rerun only after it changes. Do not inspect the directory tree, download manually, use an older handbook, or guess paths.

The handbook is mandatory. If the loader fails, stop and report that the BOSS API handbook is unavailable; do not fall back to guessing operations. Live catalog commands (`node "$CLI" categories`, `node "$CLI" search "terms"`, `node "$CLI" describe operationId`) only supplement a loaded handbook.

## Explore within a budget

The handbook provides `api-index.jsonl`, category indexes, operation documents, and common operations. Use this order:

1. Reuse a previously successful operation when its contract and parameters still match.
2. Use common operations only for exact matches of the question.
3. Search the index with the user's terms: customer, subscriber, MSISDN, balance, recharge, payment, charge, order, bundle, status.
4. Read the selected document's exact path, parameters, coverage, empty-result meaning, and `relatedOperations`. Send only documented parameters; never add a filter because its name sounds plausible.
5. Follow identifiers from earlier results (customer, subscriber, MSISDN, order) into dependent operations. Use returned IDs rather than display names.
6. Page through results when the response says more pages exist and the question needs the full history. A truncated or partial page never proves that something did not happen.
7. Stop when the evidence answers the question. Do not scan every document.

Example discovery:

```bash
rg -i 'recharge|payment' "$INDEX_PATH"
cat "$HANDBOOK_ROOT/api-docs/payment.list_recharges.json"
```

An empty API result means only that the called operation has no visible data under those exact filters and time range. A section reported as unavailable (for example a balance the charging system could not return) is unknown, never zero. Verify identifiers, time range, and identity scope before concluding.

## Execute through the connector

Inspect identity only when user or tenant identity matters:

```bash
node "$CLI" identity
```

Execute the confirmed contract directly, with its exact path and operation ID from the handbook:

```bash
node "$CLI" request GET "<documented path>" '{"operationId":"<documented operationId>","query":{"limit":20},"reason":"Check recent recharges"}'
```

If the connector rejects a contract mismatch, use its expected operation and allowed-parameter details to correct the request instead of repeating it.

## Respect identity and policy

- Every request runs as the external BOSS user and is checked against that user's permissions and Agent policy.
- BOSS data includes subscriber personal and financial information: request only what the question needs and do not repeat identifiers beyond what the answer requires.
- Never construct a host, authorization header, token, database query, alternate transport, or undocumented path.
- Investigations are read-only. Never attempt recharges, charges, refunds, order changes, or other writes, and never work around a denial.

## Answer from evidence

- Lead with the conclusion in the user's language, then the supporting amounts, times, and states, and a useful next action.
- Quote amounts with their currency and times with their time zone as returned by BOSS.
- Hide API paths, operation IDs, CLI commands, handbook details, and raw payloads unless technical diagnostics are requested.
- Distinguish no data, limited visibility, unavailable data, denied access, and execution failure.
- Do not fabricate records, balances, or causes. When evidence is incomplete, say what could not be determined and what a human should check.
