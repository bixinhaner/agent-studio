import { describe, expect, it } from "vitest";

import { createPersonalUsageService, outputFileType, periodRange, usageChannel, zonedMidnight } from "./personal-usage-service.js";

type FakeEvent = {
  userId: string;
  createdAt: Date;
  threadId: string | null;
  model: string;
  featureType: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  resultStatus: string;
  metadata: unknown;
};

function event(partial: Partial<FakeEvent> & { createdAt: Date }): FakeEvent {
  return {
    userId: "u1",
    threadId: "t1",
    model: "gpt-6.1-sol",
    featureType: "chat",
    inputTokens: 1000,
    cachedInputTokens: 400,
    outputTokens: 100,
    resultStatus: "success",
    metadata: { source: "chat_stream" },
    ...partial
  };
}

function fakeDb(events: FakeEvent[], files: Array<{ name: string; mimeType: string | null; createdAt: Date }> = [], runs: Array<{ threadId: string; startedAt: Date }> = []) {
  const inRange = (value: Date, where: { gte: Date; lt: Date }) => value >= where.gte && value < where.lt;
  const db = {
    workspaceNode: {
      findMany: async (args: { where: { createdAt: { gte: Date; lt: Date } } }) => files.filter((file) => inRange(file.createdAt, args.where.createdAt))
    },
    scheduledTaskRun: {
      findMany: async () => runs
    }
  } as never;
  const ledger = {
    listEventsByExactCreatedAtRange: async (args: { userId?: string; from: Date | string; to: Date | string }) =>
      events
        .filter((item) => item.userId === args.userId && inRange(item.createdAt, { gte: new Date(args.from), lt: new Date(args.to) }))
        .map((item) => ({ ...item, id: "e", threadId: item.threadId ?? undefined, estimatedCost: "0", internalCost: "0", createdAt: item.createdAt.toISOString() }))
  };
  return { db, ledger };
}

describe("personal usage periods", () => {
  it("resolves local midnight across time zones", () => {
    expect(zonedMidnight(2026, 10, 1, "Asia/Shanghai").toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(zonedMidnight(2026, 10, 1, "Asia/Jakarta").toISOString()).toBe("2026-09-30T17:00:00.000Z");
    expect(zonedMidnight(2026, 3, 8, "America/New_York").toISOString()).toBe("2026-03-08T05:00:00.000Z");
  });

  it("builds this month and last month in the user's time zone", () => {
    const now = new Date("2026-10-05T03:00:00.000Z");
    const month = periodRange("month", now, "Asia/Shanghai");
    expect(month.from.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(month.days).toEqual(["2026-10-01", "2026-10-02", "2026-10-03", "2026-10-04", "2026-10-05"]);
    const last = periodRange("last_month", now, "Asia/Shanghai");
    expect(last.days).toHaveLength(30);
    expect(last.to.toISOString()).toBe("2026-09-30T16:00:00.000Z");
    expect(periodRange("7d", now, "Asia/Shanghai").days).toHaveLength(7);
  });
});

describe("usageChannel / outputFileType", () => {
  it("classifies channels", () => {
    expect(usageChannel("chat", { source: "chat_stream" })).toBe("portal");
    expect(usageChannel("chat", { source: "dingtalk_bot" })).toBe("dingtalk");
    expect(usageChannel("external_openai_api", {})).toBe("api");
    expect(usageChannel("chat", { source: "chat_stream" }, true)).toBe("scheduled");
    expect(usageChannel("security_review", { source: "conversation_security_review" })).toBe("other");
  });

  it("matches the outputs gallery types", () => {
    expect(outputFileType("report.docx")).toBe("document");
    expect(outputFileType("data.xlsx")).toBe("spreadsheet");
    expect(outputFileType("deck.pptx")).toBe("presentation");
    expect(outputFileType("chart", "image/png")).toBe("image");
    expect(outputFileType("archive.zip")).toBe("other");
  });
});

describe("createPersonalUsageService", () => {
  it("sums tokens, buckets by local day and compares with the previous span", async () => {
    const now = new Date("2026-10-05T03:00:00.000Z");
    const service = createPersonalUsageService({
      now: () => now,
      ...fakeDb(
        [
          // 2026-10-01 00:30 Shanghai (still Sep 30 in UTC)
          event({ createdAt: new Date("2026-09-30T16:30:00.000Z") }),
          event({ createdAt: new Date("2026-10-02T02:00:00.000Z"), threadId: "t2", metadata: { source: "dingtalk_bot" }, resultStatus: "failed" }),
          event({ createdAt: new Date("2026-10-03T02:00:00.000Z"), threadId: "sched", model: "gpt-5.5" }),
          event({ createdAt: new Date("2026-10-03T02:00:00.000Z"), userId: "someone-else" }),
          // previous span (Sep 1 - Sep 5 so far)
          event({ createdAt: new Date("2026-09-02T02:00:00.000Z"), inputTokens: 50, outputTokens: 50 })
        ],
        [
          { name: "a.pptx", mimeType: null, createdAt: new Date("2026-10-02T00:00:00.000Z") },
          { name: "b.xlsx", mimeType: null, createdAt: new Date("2026-10-02T00:00:00.000Z") },
          { name: "c.pptx", mimeType: null, createdAt: new Date("2026-10-02T00:00:00.000Z") }
        ],
        [{ threadId: "sched", startedAt: new Date("2026-10-03T01:59:00.000Z") }]
      )
    });

    const summary = await service.summarize({ userId: "u1", period: "month", timezone: "Asia/Shanghai" });
    expect(summary.totals).toMatchObject({
      input_tokens: 3000,
      cached_input_tokens: 1200,
      output_tokens: 300,
      total_tokens: 3300,
      turns: 3,
      failed_turns: 1,
      tasks: 3,
      output_files: 3
    });
    expect(summary.daily.find((day) => day.date === "2026-10-01")?.total_tokens).toBe(1100);
    expect(summary.daily.find((day) => day.date === "2026-09-30")).toBeUndefined();
    expect(summary.by_channel.map((item) => item.key).sort()).toEqual(["dingtalk", "portal", "scheduled"]);
    expect(summary.by_model[0]).toEqual({ model: "gpt-6.1-sol", total_tokens: 2200, turns: 2 });
    expect(summary.outputs_by_type).toEqual([
      { type: "presentation", count: 2 },
      { type: "spreadsheet", count: 1 }
    ]);
    expect(summary.previous).toEqual({ total_tokens: 100, turns: 1 });
  });

  it("falls back to this month and Asia/Shanghai for invalid input", async () => {
    const service = createPersonalUsageService({ now: () => new Date("2026-10-05T03:00:00.000Z"), ...fakeDb([]) });
    const summary = await service.summarize({ userId: "u1", period: "forever", timezone: "Mars/Base" });
    expect(summary.period).toBe("month");
    expect(summary.timezone).toBe("Asia/Shanghai");
    expect(summary.totals.total_tokens).toBe(0);
    await expect(service.summarize({ userId: " " })).rejects.toThrow();
  });
});
