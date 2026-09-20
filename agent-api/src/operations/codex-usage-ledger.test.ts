import { describe, expect, it } from "vitest";
import { parseRolloutUsage, sumInvocations, usageHash, usageTurnKey } from "./codex-usage-ledger.js";
import { correctionFor, matchTurn } from "../ops/reconcile-codex-usage.js";

const usage = (i: number, o = 2) => ({ input_tokens: i, cached_input_tokens: Math.floor(i / 2), output_tokens: o, cache_write_tokens: 0 });
const row = (type: string, payload: any, second = 0) => JSON.stringify({ type, payload, timestamp: `2026-09-20T10:00:${String(second).padStart(2, "0")}.000Z` });
async function* lines(rows: string[]) { yield* rows; }
const start = [row("session_meta", { id: "thread" }), row("event_msg", { type: "task_started", turn_id: "turn" }), row("turn_context", { turn_id: "turn", model: "gpt-5.6-sol" })];
const end = row("event_msg", { type: "task_complete", turn_id: "turn" }, 30);
const count = (total: number, last: number, second = 1) => row("event_msg", { type: "token_count", info: { total_token_usage: usage(total), last_token_usage: usage(last) } }, second);
const call = (id: string, i: number) => row("token_usage_record", { thread_id: "thread", turn_id: "turn", response_id: id, model: "gpt-5.6-sol", usage: usage(i) }, 20);

describe("Codex invocation ledger", () => {
  it("counts independent responses across counter resets and deduplicates replay without mixing token_count", async () => {
    const parsed = await parseRolloutUsage(lines([...start, count(1000, 100), call("r1", 100), count(20, 20), call("r2", 20), call("r1", 100), end]));
    const turn = parsed.get("turn")!;
    expect(turn.blocked).toBeUndefined();
    expect(turn.source).toBe("response_id");
    expect(sumInvocations(turn.invocations)).toEqual({ inputTokens: 120, cachedInputTokens: 60, cacheWriteTokens: 0, outputTokens: 4 });
  });
  it("reconstructs legacy last-call usage instead of treating a reset value as a fresh full total", async () => {
    const turn = (await parseRolloutUsage(lines([...start, count(913348, 44491), count(118141, 25012), count(118141, 25012), end]))).get("turn")!;
    expect(turn.invocations).toHaveLength(2);
    expect(sumInvocations(turn.invocations).inputTokens).toBe(69503);
  });
  it("blocks conflicting same-response receipts and unfinished turns", async () => {
    const bad = (await parseRolloutUsage(lines([...start, call("same", 100), call("same", 200), end]))).get("turn")!;
    expect(bad.blocked).toBe("conflicting_response_usage");
    const unfinished = (await parseRolloutUsage(lines([...start, call("same", 100)]))).get("turn")!;
    expect(unfinished.blocked).toBe("incomplete_turn");
  });
  it("blocks ambiguous interleaved legacy turns and recognizes aborted usage", async () => {
    const turn = (await parseRolloutUsage(lines([...start, row("event_msg", { type: "task_started", turn_id: "other" }), count(100, 100), row("event_msg", { type: "turn_aborted", turn_id: "other" })]))).get("other")!;
    expect(turn.blocked).toBe("overlapping_legacy_turns");
    const aborted = (await parseRolloutUsage(lines([...start, call("r1", 40), row("event_msg", { type: "turn_aborted", turn_id: "turn" })]))).get("turn")!;
    expect(aborted.blocked).toBeUndefined();
  });
  it("keeps missing cache-write telemetry unknown and uses stable object hashes", async () => {
    expect(sumInvocations([{ inputTokens: 10, cachedInputTokens: 0, outputTokens: 1 }]).cacheWriteTokens).toBeUndefined();
    expect(usageHash({ a: 1, b: 2 })).toBe(usageHash({ b: 2, a: 1 }));
    expect(usageTurnKey("thread", "one")).not.toBe(usageTurnKey("thread", "two"));
  });
  it("matches historical rows only by unique snapshot plus completion time and retains historical prices", async () => {
    const turn = (await parseRolloutUsage(lines([...start, count(100, 100), call("r1", 100), end]))).get("turn")!;
    const event = { model: "gpt-5.6-sol", createdAt: "2026-09-20T10:00:31Z", metadata: {
      _codexRuntimeUsage: { inputTokens: 100, cachedInputTokens: 50, outputTokens: 2 },
      _costProfile: { matched: true, profileId: "old-price", model: "gpt-5.6-sol", inputTokenPrice: "5", cachedInputTokenPrice: "0.5", cacheWriteTokenPrice: "6.25", outputTokenPrice: "30", internalCostMultiplier: "0.1" }
    } };
    expect(matchTurn(event, [turn])?.id).toBe("turn");
    expect(matchTurn(event, [turn, { ...turn, id: "another" }])).toBeUndefined();
    const correction = correctionFor(event, turn).data!;
    expect(correction.estimatedCost).toBe("0.000335");
    expect(correction.metadata._costProfile.inputTokenPrice).toBe("5");
    expect(correction.metadata._costProfile.outputTokenPrice).toBe("30");
  });
});
