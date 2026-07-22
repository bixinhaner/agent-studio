import { describe, expect, it } from "vitest";

import type { RuntimeUsageSnapshot } from "../live-runtime-session.js";
import { estimatedCost, usageForLocalModelCall } from "./local-codex-usage-report.js";

function snapshot(input: {
  totalInput: number;
  totalCached: number;
  totalOutput: number;
  lastInput: number;
  lastCached: number;
  lastOutput: number;
}): RuntimeUsageSnapshot {
  return {
    kind: "cumulative_snapshot",
    codexThreadId: "thread-1",
    inputTokens: input.totalInput,
    cachedInputTokens: input.totalCached,
    outputTokens: input.totalOutput,
    modelInvocations: [{
      inputTokens: input.lastInput,
      cachedInputTokens: input.lastCached,
      outputTokens: input.lastOutput
    }]
  };
}

describe("local Codex usage report pricing", () => {
  it("uses the production upper-bound cache-write policy when telemetry is missing", () => {
    const upperBound = estimatedCost({
      model: "gpt-5.6-sol",
      tier: "standard",
      inputTokens: 100_000,
      cachedInputTokens: 0,
      outputTokens: 0
    });
    const observedZero = estimatedCost({
      model: "gpt-5.6-sol",
      tier: "standard",
      inputTokens: 100_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0
    });

    expect(upperBound).toMatchObject({
      cost: 0.625,
      costCompleteness: "upper_bound_missing_cache_write_tokens"
    });
    expect(observedZero).toMatchObject({ cost: 0.5, costCompleteness: "complete" });
  });

  it("prices long context from each model invocation instead of the cumulative session total", () => {
    const state = {
      previousCumulativeByKey: new Map<string, RuntimeUsageSnapshot>(),
      seenCumulativeUsage: new Set<string>()
    };
    usageForLocalModelCall(snapshot({
      totalInput: 200_000,
      totalCached: 150_000,
      totalOutput: 1_000,
      lastInput: 200_000,
      lastCached: 150_000,
      lastOutput: 1_000
    }), state, "thread-1");
    const second = usageForLocalModelCall(snapshot({
      totalInput: 450_000,
      totalCached: 350_000,
      totalOutput: 2_000,
      lastInput: 250_000,
      lastCached: 200_000,
      lastOutput: 1_000
    }), state, "thread-1");

    expect(second?.inputTokens).toBe(250_000);
    expect(estimatedCost({
      model: "gpt-5.6-sol",
      tier: "standard",
      inputTokens: second?.inputTokens ?? 0,
      cachedInputTokens: second?.cachedInputTokens ?? 0,
      cacheWriteTokens: second?.cacheWriteTokens,
      outputTokens: second?.outputTokens ?? 0
    }).longContext).toBe(false);
    expect(estimatedCost({
      model: "gpt-5.6-sol",
      tier: "standard",
      inputTokens: 272_000,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0
    }).longContext).toBe(false);
    expect(estimatedCost({
      model: "gpt-5.6-sol",
      tier: "standard",
      inputTokens: 272_001,
      cachedInputTokens: 0,
      cacheWriteTokens: 0,
      outputTokens: 0
    }).longContext).toBe(true);
  });

  it("drops duplicate cumulative token notifications", () => {
    const state = {
      previousCumulativeByKey: new Map<string, RuntimeUsageSnapshot>(),
      seenCumulativeUsage: new Set<string>()
    };
    const usage = snapshot({
      totalInput: 100_000,
      totalCached: 80_000,
      totalOutput: 500,
      lastInput: 100_000,
      lastCached: 80_000,
      lastOutput: 500
    });

    expect(usageForLocalModelCall(usage, state, "thread-1")).toBeDefined();
    expect(usageForLocalModelCall(usage, state, "thread-1")).toBeUndefined();
  });
});
