import { describe, expect, it, vi } from "vitest";

import { DingTalkPushService } from "./dingtalk-push-service.js";
import { buildDigestMarkdown, buildFindingsMarkdown, severitiesAtLeast } from "./subscription-service.js";

const finding = (overrides: Record<string, unknown> = {}) =>
  ({
    id: "f1",
    title: "基站 A 断链",
    summary: "过去 30 分钟内 3 次断链",
    severity: "high",
    scenarioKey: "severe-alarm-explanation",
    createdAt: new Date("2026-10-01T00:00:00Z"),
    ...overrides
  }) as never;

describe("subscription messages", () => {
  it("filters severities at or above the minimum", () => {
    expect(severitiesAtLeast("high")).toEqual(["high", "HIGH", "critical", "CRITICAL"]);
  });

  it("renders single and batched findings in both locales", () => {
    expect(buildFindingsMarkdown([finding()], false).markdown).toContain("严重告警解释");
    expect(buildFindingsMarkdown([finding()], true).markdown).toContain("Severe alarm explanation");
    const batch = buildFindingsMarkdown([finding(), finding({ id: "f2", title: "B" })], false);
    expect(batch.title).toBe("OMC 主动发现：新增 2 条");
  });

  it("summarizes a digest by scenario", () => {
    const digest = buildDigestMarkdown([finding(), finding({ id: "f2", severity: "critical" })], false, "2026/10/01");
    expect(digest.markdown).toContain("合计：** 2 条");
    expect(digest.markdown).toContain("紧急 1 / 高 1");
  });
});

describe("DingTalkPushService", () => {
  it("delivers each source to a user at most once", async () => {
    const deliveries = new Set<string>();
    const db = {
      user: { findUnique: vi.fn(async () => ({ dingtalkUserId: "staff1", status: "active", preferencesJson: null })) },
      notificationDelivery: {
        create: vi.fn(async ({ data }: { data: { userId: string; sourceType: string; sourceId: string } }) => {
          const key = `${data.userId}:${data.sourceType}:${data.sourceId}`;
          if (deliveries.has(key)) throw Object.assign(new Error("unique"), { code: "P2002" });
          deliveries.add(key);
          return { id: key };
        }),
        updateMany: vi.fn(async () => ({ count: 1 }))
      }
    };
    const sender = { hasProactiveSender: () => true, sendOneToOneMessage: vi.fn(async () => ({})) };
    const push = new DingTalkPushService(db as never, sender);
    const build = vi.fn((ids: string[]) => ({ title: "t", markdown: ids.join(",") }));
    const items = [
      { sourceType: "proactive_finding", sourceId: "f1" },
      { sourceType: "proactive_finding", sourceId: "f2" }
    ];
    expect(await push.pushClaimed({ userId: "u1", items, build })).toBe("sent");
    expect(await push.pushClaimed({ userId: "u1", items, build })).toBe("duplicate");
    expect(
      await push.pushClaimed({ userId: "u1", items: [...items, { sourceType: "proactive_finding", sourceId: "f3" }], build })
    ).toBe("sent");
    expect(build.mock.calls.map((call) => call[0])).toEqual([["f1", "f2"], ["f3"]]);
    expect(sender.sendOneToOneMessage).toHaveBeenCalledTimes(2);
  });
});
