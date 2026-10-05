import { describe, expect, it } from "vitest";

import { localizePortalStatus } from "./subscription-entitlement-service.js";

const base = {
  accessState: "available" as const,
  tone: "positive" as const,
  sourceType: "organization" as const,
  sourceLabel: "Managed through your workspace plan",
  title: "Access is active",
  summary: "12 AI requests left in this cycle.",
  detail: "Custom message from policy",
  actionLabel: null,
  planName: "Team",
  expiresAt: null,
  cycleEndsAt: null,
  remainingCompletedTurns: 12,
  completedTurnLimit: 100,
  reasonCode: null
};

describe("localizePortalStatus", () => {
  it("keeps English by default", () => {
    expect(localizePortalStatus(base as never)).toEqual(base);
    expect(localizePortalStatus(base as never, "en")).toEqual(base);
  });

  it("translates fixed copy and counts for zh-CN, passing dynamic text through", () => {
    const zh = localizePortalStatus(base as never, "zh-CN");
    expect(zh.title).toBe("权限有效");
    expect(zh.sourceLabel).toBe("由组织套餐提供");
    expect(zh.summary).toBe("本周期剩余 12 次 AI 请求。");
    expect(zh.detail).toBe("Custom message from policy");
    expect(zh.actionLabel).toBeNull();
    expect(zh.planName).toBe("Team");
  });
});
