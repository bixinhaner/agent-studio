import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  CODEX_BACKGROUND_FEATURE_TYPE,
  CODEX_OTEL_HOME_HEADER,
  CODEX_OTEL_SIGNATURE_HEADER,
  CodexBackgroundUsageCollector,
  buildCodexOtelLaunchArgs,
  parseCodexOtelTokenEvents,
  signCodexHome,
  verifyCodexHomeSignature
} from "./codex-background-usage.js";
import { UsageIngestionService } from "./usage-ingestion-service.js";
import { UsageRecorder } from "./usage-recorder.js";
import type { CostProfileRecord } from "../persistence/cost-profile-repository.js";

const attr = (key: string, value: string) => ({ key, value: { stringValue: value } });

/** Shape captured from codex 0.159.2 `otlp-http` / `protocol = "json"` against DeepSeek. */
function otlpExport(records: Array<Record<string, string>>) {
  return {
    resourceLogs: [{
      resource: { attributes: [attr("service.name", "codex_app_server")] },
      scopeLogs: [{
        logRecords: records.map((attrs) => ({ attributes: Object.entries(attrs).map(([key, value]) => attr(key, value)) }))
      }]
    }]
  };
}

const completed = (conversationId: string, tokens: { input: string; cached: string; output: string }, timestamp = "2026-10-21T05:31:53.267Z") => ({
  "event.name": "codex.sse_event",
  "event.kind": "response.completed",
  "event.timestamp": timestamp,
  "conversation.id": conversationId,
  originator: "codex_app_server",
  model: "deepseek-flash",
  input_token_count: tokens.input,
  output_token_count: tokens.output,
  cached_token_count: tokens.cached,
  cache_write_token_count: "0",
  reasoning_token_count: "7"
});

const flash: CostProfileRecord = {
  id: "cost_profile_deepseek_flash_global",
  model: "deepseek-flash",
  inputTokenPrice: "0.3",
  cachedInputTokenPrice: "0.006",
  cacheWriteTokenPrice: "0",
  outputTokenPrice: "1.2",
  internalCostMultiplier: "1",
  timeOfDayPricing: {
    timezone: "Asia/Shanghai",
    offPeakMultiplier: 0.5,
    peakWindows: [
      { weekdays: [1, 2, 3, 4, 5], start: "09:00", end: "12:00" },
      { weekdays: [1, 2, 3, 4, 5], start: "14:00", end: "18:00" }
    ]
  },
  isActive: true,
  createdAt: "2026-10-21T00:00:00.000Z",
  updatedAt: "2026-10-21T00:00:00.000Z"
};

const homes: string[] = [];
async function userHome(): Promise<string> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "codex-bg-usage-"));
  homes.push(home);
  await fs.mkdir(path.join(home, ".agent-studio"), { recursive: true });
  await fs.writeFile(path.join(home, ".agent-studio", "manifest.json"), JSON.stringify({
    version: 1, scope: "user_agent", organizationKey: "acme", userId: "user-1", modeId: "default"
  }));
  return home;
}

afterEach(async () => {
  await Promise.all(homes.splice(0).map((home) => fs.rm(home, { recursive: true, force: true })));
});

function recordingService(stored: any[], rolledUp: any[]) {
  const ingestion = new UsageIngestionService({
    costProfiles: { async getActiveByModel() { return flash; } },
    usageEvents: {
      async list() { return []; },
      async create(input) {
        if (stored.some((event) => event.id === input.id)) throw Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        const event = { ...input, createdAt: new Date(input.createdAt ?? Date.now()).toISOString() } as any;
        stored.push(event);
        return event;
      }
    },
    async afterRecord(event) { rolledUp.push(event); }
  });
  return new UsageRecorder({ usageIngestion: ingestion });
}

describe("parseCodexOtelTokenEvents", () => {
  it("keeps only response.completed records that carry token counts, bounding cached input to input", () => {
    const events = parseCodexOtelTokenEvents(otlpExport([
      { "event.name": "codex.conversation_starts", "conversation.id": "c1", model: "deepseek-flash" },
      { "event.name": "codex.sse_event", "event.kind": "response.output_item.done", "conversation.id": "c1", model: "deepseek-flash" },
      // Codex sends a timing-only response.completed alongside the one with usage.
      { "event.name": "codex.sse_event", "event.kind": "response.completed", "conversation.id": "c1", model: "deepseek-flash", duration_ms: "7" },
      completed("c1", { input: "8553", cached: "7808", output: "2" }),
      completed("c2", { input: "100", cached: "250", output: "3" })
    ]));
    expect(events).toEqual([
      expect.objectContaining({ conversationId: "c1", model: "deepseek-flash", inputTokens: 8553, cachedInputTokens: 7808, cacheWriteTokens: 0, outputTokens: 2, reasoningTokens: 7 }),
      expect.objectContaining({ conversationId: "c2", inputTokens: 100, cachedInputTokens: 100, cacheWriteTokens: 0, outputTokens: 3 })
    ]);
    expect(parseCodexOtelTokenEvents({ nope: true })).toEqual([]);
  });
});

describe("codex OTEL launch args", () => {
  it("passes a signed CODEX_HOME header that only this process can verify", () => {
    const args = buildCodexOtelLaunchArgs({ endpoint: "http://127.0.0.1:8791/internal/codex-otel/v1/logs", secret: "s3cret", codexHome: "/srv/homes/a \"b\"" });
    expect(args.filter((arg) => arg === "-c")).toHaveLength(3);
    const exporter = args.at(-1)!;
    expect(exporter).toContain('endpoint = "http://127.0.0.1:8791/internal/codex-otel/v1/logs"');
    expect(exporter).toContain(`"${CODEX_OTEL_HOME_HEADER}" = "/srv/homes/a \\"b\\""`);
    expect(exporter).toContain(`"${CODEX_OTEL_SIGNATURE_HEADER}" = "${signCodexHome("s3cret", "/srv/homes/a \"b\"")}"`);
    expect(verifyCodexHomeSignature("s3cret", "/srv/homes/a \"b\"", signCodexHome("s3cret", "/srv/homes/a \"b\""))).toBe(true);
    expect(verifyCodexHomeSignature("other", "/srv/homes/a \"b\"", signCodexHome("s3cret", "/srv/homes/a \"b\""))).toBe(false);
    expect(verifyCodexHomeSignature("s3cret", "/srv/homes/other", signCodexHome("s3cret", "/srv/homes/a \"b\""))).toBe(false);
  });
});

describe("CodexBackgroundUsageCollector", () => {
  it("records rollout-less conversations as background usage, priced by the cost profile at the event time", async () => {
    const home = await userHome();
    const stored: any[] = [];
    const rolledUp: any[] = [];
    const recorder = recordingService(stored, rolledUp);
    const collector = new CodexBackgroundUsageCollector({
      recordDirectUsage: (input) => recorder.recordDirectUsage(input),
      resolveOwner: async (manifest) => ({ scope: manifest!.scope!, organizationId: "org-acme", userId: manifest!.userId }),
      isKnownThread: async () => false
    });

    // 2026-10-21 13:31 Beijing (Wednesday) is off-peak: 100K uncached * 0.3 + 900K cached * 0.006 + 100K output * 1.2 = 0.1554, halved.
    const event = parseCodexOtelTokenEvents(otlpExport([completed("01a15cf6-e4f2-7a11-b42d-3453b6636e5b",
      { input: "1000000", cached: "900000", output: "100000" })]))[0];
    await expect(collector.classify(home, event)).resolves.toBe("recorded");
    await expect(collector.classify(home, event)).resolves.toBe("duplicate");

    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      id: expect.stringMatching(/^codex-bg-/),
      organizationId: "org-acme",
      userId: "user-1",
      model: "deepseek-flash",
      featureType: CODEX_BACKGROUND_FEATURE_TYPE,
      inputTokens: 1_000_000,
      cachedInputTokens: 900_000,
      cacheWriteTokens: 0,
      outputTokens: 100_000,
      estimatedCost: "0.077700",
      resultStatus: "success",
      metadata: {
        source: "codex_otel",
        codexConversationId: "01a15cf6-e4f2-7a11-b42d-3453b6636e5b",
        codexHomeScope: "user_agent",
        backgroundKind: "memory_agent",
        reasoningTokens: 7,
        _costProfile: expect.objectContaining({ pricingPeriod: "off_peak", timeOfDayMultiplier: 0.5 })
      }
    });
    expect(rolledUp.map((item) => item.id)).toEqual([stored[0].id]);
  });

  it("charges peak price for background work inside the peak window", async () => {
    const home = await userHome();
    const stored: any[] = [];
    const recorder = recordingService(stored, []);
    const collector = new CodexBackgroundUsageCollector({
      recordDirectUsage: (input) => recorder.recordDirectUsage(input),
      resolveOwner: async () => ({ scope: "user_agent", organizationId: "org-acme", userId: "user-1" })
    });
    const [event] = parseCodexOtelTokenEvents(otlpExport([completed("01a15cf6-0000-7000-8000-000000000001",
      { input: "1000000", cached: "900000", output: "100000" }, "2026-10-21T02:00:00.000Z")]));
    await collector.classify(home, event);
    expect(stored[0].estimatedCost).toBe("0.155400");
  });

  it("records calls tagged with a user thread that its rollout never recorded (memory stage-1 extraction)", async () => {
    const home = await userHome();
    const threadId = "01a15d0a-6425-7f42-853f-bbb7cb348570";
    const day = new Date(parseInt(threadId.replaceAll("-", "").slice(0, 12), 16)).toISOString().slice(0, 10).replaceAll("-", "/");
    const rollout = path.join(home, "sessions", day, `rollout-2026-10-21T05-58-44-${threadId}.jsonl`);
    await fs.mkdir(path.dirname(rollout), { recursive: true });
    const line = (row: unknown) => `${JSON.stringify(row)}\n`;
    await fs.writeFile(rollout, line({ type: "session_meta", payload: { id: threadId } }) +
      line({ type: "token_usage_record", payload: { turn_id: "t1", response_id: "r1", usage: { input_tokens: 8563, cached_input_tokens: 8320, output_tokens: 80 } } }));
    const recorded: any[] = [];
    const collector = new CodexBackgroundUsageCollector({
      recordDirectUsage: async (input) => { recorded.push(input); },
      resolveOwner: async () => ({ scope: "user_agent", organizationId: "org-acme", userId: "user-1" }),
      isKnownThread: async () => true
    });
    const [userCall, stage1, laterUserCall] = parseCodexOtelTokenEvents(otlpExport([
      completed(threadId, { input: "8563", cached: "8320", output: "80" }),
      completed(threadId, { input: "7018", cached: "6272", output: "1336" }),
      completed(threadId, { input: "8859", cached: "8704", output: "2" })
    ]));
    await expect(collector.classify(home, userCall)).resolves.toBe("skipped_rollout");
    await expect(collector.classify(home, stage1)).resolves.toBe("recorded");
    // The rollout keeps growing; calls appended later (token_count form, plus a half-written line) are picked up incrementally.
    await fs.appendFile(rollout, line({ type: "event_msg", payload: { type: "token_count", info: {
      last_token_usage: { input_tokens: 8859, cached_input_tokens: 8704, output_tokens: 2 } } } }) + '{"type":"event_msg","payl');
    await expect(collector.classify(home, laterUserCall)).resolves.toBe("skipped_rollout");
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ inputTokens: 7018, cachedInputTokens: 6272, outputTokens: 1336,
      metadata: { backgroundKind: "outside_rollout", codexConversationId: threadId } });
  });

  it("skips calls recorded in the rollout and known threads whose rollout is elsewhere", async () => {
    const home = await userHome();
    const threadId = "01a15cf6-c3be-79c0-a4f2-720c46d032f5";
    const day = new Date(parseInt(threadId.replaceAll("-", "").slice(0, 12), 16)).toISOString().slice(0, 10).replaceAll("-", "/");
    await fs.mkdir(path.join(home, "sessions", day), { recursive: true });
    await fs.writeFile(path.join(home, "sessions", day, `rollout-2026-10-21T05-37-18-${threadId}.jsonl`),
      `${JSON.stringify({ type: "token_usage_record", payload: { usage: { input_tokens: 10, cached_input_tokens: 0, output_tokens: 1 } } })}\n`);
    const recorded: unknown[] = [];
    const collector = new CodexBackgroundUsageCollector({
      recordDirectUsage: async (input) => { recorded.push(input); },
      resolveOwner: async () => ({ scope: "user_agent" }),
      isKnownThread: async (id) => id === "01a15cf6-1111-7000-8000-000000000002"
    });
    const events = parseCodexOtelTokenEvents(otlpExport([
      completed(threadId, { input: "10", cached: "0", output: "1" }),
      completed("01a15cf6-1111-7000-8000-000000000002", { input: "10", cached: "0", output: "1" })
    ]));
    await expect(collector.classify(home, events[0])).resolves.toBe("skipped_rollout");
    await expect(collector.classify(home, events[1])).resolves.toBe("skipped_thread");
    expect(recorded).toEqual([]);
  });

  it("waits before classifying so a new thread's rollout can appear first", async () => {
    const home = await userHome();
    const classified: string[] = [];
    const collector = new CodexBackgroundUsageCollector({
      recordDirectUsage: async (input) => { classified.push(String(input.metadata && (input.metadata as any).codexConversationId)); },
      resolveOwner: async () => ({ scope: "user_agent" }),
      rolloutDelayMs: 20
    });
    expect(collector.accept(home, otlpExport([completed("01a15cf6-2222-7000-8000-000000000003", { input: "5", cached: "0", output: "1" })]))).toBe(1);
    expect(classified).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    expect(classified).toEqual(["01a15cf6-2222-7000-8000-000000000003"]);
    collector.stop();
  });
});
