import { describe, expect, it, vi } from "vitest";

import { TrainingTranslationService } from "./training-translation-service.js";

function createService() {
  const cache = new Map<string, { sourceHash: string; translatedJson: unknown }>();
  const db = {
    portalTrainingTranslation: {
      findMany: vi.fn(async ({ where }: { where: { OR: Array<{ sourceType: string; sourceId: string }> } }) =>
        where.OR.flatMap((item) => {
          const value = cache.get(`${item.sourceType}:${item.sourceId}`);
          return value ? [{ ...item, ...value }] : [];
        })),
      upsert: vi.fn(async ({ create }: { create: {
        sourceType: string;
        sourceId: string;
        sourceHash: string;
        translatedJson: unknown;
      } }) => {
        cache.set(`${create.sourceType}:${create.sourceId}`, {
          sourceHash: create.sourceHash,
          translatedJson: create.translatedJson
        });
        return create;
      })
    }
  };
  const runner = vi.fn(async ({ texts }: { texts: string[] }) =>
    texts.map((text) => text === "检查切换抓包" ? "Analyze the handover packet capture" : `EN:${text}`)
  );
  return {
    db,
    runner,
    service: new TrainingTranslationService(db as never, runner)
  };
}

describe("TrainingTranslationService", () => {
  it("reuses cached translations and invalidates them when source text changes", async () => {
    const { service, runner } = createService();
    const base = {
      organizationId: "org-1",
      requestedByUserId: "user-1",
      sourceType: "thread_title"
    };

    const first = await service.localizeStrings({
      ...base,
      entries: [{ sourceId: "thread-1", value: "检查切换抓包" }]
    });
    const cached = await service.localizeStrings({
      ...base,
      entries: [{ sourceId: "thread-1", value: "检查切换抓包" }]
    });
    const changed = await service.localizeStrings({
      ...base,
      entries: [{ sourceId: "thread-1", value: "检查新站点KPI" }]
    });

    expect(first.get("thread-1")).toBe("Analyze the handover packet capture");
    expect(cached.get("thread-1")).toBe("Analyze the handover packet capture");
    expect(changed.get("thread-1")).toBe("EN:检查新站点KPI");
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("serves a stale translated message immediately until prewarm refreshes it", async () => {
    const { service, runner } = createService();
    const base = {
      organizationId: "org-1",
      requestedByUserId: "user-1"
    };
    const original = { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "旧回答" }] };
    const changed = { id: "assistant-1", role: "assistant", content: [{ type: "text", text: "新回答" }] };

    await service.localizeMessages({
      ...base,
      entries: [{ sourceId: "message-1", value: original }]
    });
    const stale = await service.localizeMessages({
      ...base,
      entries: [{ sourceId: "message-1", value: changed }],
      allowStale: true
    });

    expect(stale.get("message-1")).toEqual({
      ...original,
      content: [{ type: "text", text: "EN:旧回答" }]
    });
    expect(runner).toHaveBeenCalledTimes(1);

    const refreshed = await service.localizeMessages({
      ...base,
      entries: [{ sourceId: "message-1", value: changed }]
    });
    expect(refreshed.get("message-1")).toEqual({
      ...changed,
      content: [{ type: "text", text: "EN:新回答" }]
    });
    expect(runner).toHaveBeenCalledTimes(2);
  });

  it("translates visible prose and file display names without changing tool payloads", async () => {
    const { service } = createService();
    const source = {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "text", text: "已完成分析。" },
        {
          type: "data",
          name: "codex_commentary",
          data: {
            text: "正在核对两张表。",
            lines: ["正在核对两张表。"],
            entries: [{ text: "汇总口径已确认。", lines: ["汇总口径已确认。"] }],
            last_event_at: 1785433350538
          }
        },
        { type: "file", name: "切换抓包_现场.pcap", url: "/download/切换抓包_现场.pcap" },
        { type: "data", name: "codex_file_change", data: { changes: [{ path: "销售分析_v04.xlsx" }] } },
        { type: "tool-call", argsText: "rg -n 中文参数", result: { text: "原始日志" } }
      ]
    };

    const result = await service.localizeMessages({
      organizationId: "org-1",
      requestedByUserId: "user-1",
      entries: [{ sourceId: "message-1", value: source }]
    });

    expect(result.get("message-1")).toEqual({
      ...source,
      content: [
        { type: "text", text: "EN:已完成分析。" },
        {
          type: "data",
          name: "codex_commentary",
          data: {
            text: "EN:正在核对两张表。",
            lines: ["EN:正在核对两张表。"],
            entries: [{ text: "EN:汇总口径已确认。", lines: ["EN:汇总口径已确认。"] }],
            last_event_at: 1785433350538
          }
        },
        { type: "file", name: "EN:切换抓包_现场.pcap", url: "/download/切换抓包_现场.pcap" },
        { type: "data", name: "codex_file_change", data: { changes: [{ path: "销售分析_v04.xlsx", display_path: "EN:销售分析_v04.xlsx" }] } },
        { type: "tool-call", argsText: "rg -n 中文参数", result: { text: "原始日志" } }
      ]
    });
  });

  it("splits an incomplete batch and retries smaller translation groups", async () => {
    const { db } = createService();
    const runner = vi.fn(async ({ texts }: { texts: string[] }) => {
      if (texts.length > 1) throw new Error("培训案例英文翻译返回数量不匹配");
      return [`EN:${texts[0]}`];
    });
    const service = new TrainingTranslationService(db as never, runner);
    const result = await service.localizeStrings({
      organizationId: "org-1",
      requestedByUserId: "user-1",
      sourceType: "thread_title",
      entries: [
        { sourceId: "thread-1", value: "第一个案例" },
        { sourceId: "thread-2", value: "第二个案例" }
      ]
    });
    expect(result.get("thread-1")).toBe("EN:第一个案例");
    expect(result.get("thread-2")).toBe("EN:第二个案例");
    expect(runner).toHaveBeenCalledTimes(3);
  });
});
