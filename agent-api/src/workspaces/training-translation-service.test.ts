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

  it("translates visible prose and file display names without changing tool payloads", async () => {
    const { service } = createService();
    const source = {
      id: "assistant-1",
      role: "assistant",
      content: [
        { type: "text", text: "已完成分析。" },
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
        { type: "file", name: "EN:切换抓包_现场.pcap", url: "/download/切换抓包_现场.pcap" },
        { type: "data", name: "codex_file_change", data: { changes: [{ path: "销售分析_v04.xlsx", display_path: "EN:销售分析_v04.xlsx" }] } },
        { type: "tool-call", argsText: "rg -n 中文参数", result: { text: "原始日志" } }
      ]
    });
  });
});
