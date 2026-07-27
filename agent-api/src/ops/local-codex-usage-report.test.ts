import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import type { RuntimeUsageSnapshot } from "../live-runtime-session.js";
import {
  estimatedCost,
  streamJsonlRecords,
  streamJsonlRecordsFromReadable,
  usageForLocalModelCall
} from "./local-codex-usage-report.js";

const tempDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

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

describe("local Codex usage report session streaming", () => {
  it("yields records before the input stream finishes", async () => {
    const input = new PassThrough();
    const records = streamJsonlRecordsFromReadable(input);
    const iterator = records[Symbol.asyncIterator]();
    input.write(`${JSON.stringify({ type: "session_meta", payload: { id: "thread-1" } })}\n`);

    const first = await Promise.race([
      iterator.next(),
      new Promise<never>((_resolve, reject) => setTimeout(() => reject(new Error("stream did not yield")), 250))
    ]);

    expect(first.done).toBe(false);
    expect(first.value?.type).toBe("session_meta");
    input.end();
    expect((await iterator.next()).done).toBe(true);
  });

  it("streams JSONL records and skips malformed or blank lines", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "local-codex-usage-"));
    tempDirectories.push(directory);
    const filePath = path.join(directory, "rollout.jsonl");
    await fs.writeFile(filePath, [
      JSON.stringify({ type: "session_meta", payload: { id: "thread-1" } }),
      "",
      "{malformed",
      JSON.stringify({ type: "event_msg", payload: { type: "token_count" } }),
      ""
    ].join("\n"), "utf8");

    const records: Array<Record<string, unknown>> = [];
    for await (const record of streamJsonlRecords(filePath)) records.push(record);

    expect(records).toHaveLength(2);
    expect(records.map((record) => record.type)).toEqual(["session_meta", "event_msg"]);
  });

  it("reports the file path instead of silently skipping stream failures", async () => {
    const missingPath = path.join(os.tmpdir(), "missing-codex-rollout.jsonl");

    const consume = async () => {
      for await (const _record of streamJsonlRecords(missingPath)) {
        // Consume the generator so the underlying stream error is observed.
      }
    };

    await expect(consume()).rejects.toThrow(`Failed to stream session file ${missingPath}`);
  });
});
