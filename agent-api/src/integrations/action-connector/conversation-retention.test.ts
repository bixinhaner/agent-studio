import { describe, expect, it } from "vitest";
import { isLegacyProactiveConversation, legacyProactiveConversationId } from "./conversation-retention.js";

const base = {
  message: "report",
  mode: "execute" as const,
  locale: "zh-CN",
  timezone: "Asia/Shanghai",
  context: {
    proactive: true,
    scenarioKey: "severe-alarm-explanation",
    externalIdentity: { externalUserId: "xomc-proactive-service" }
  }
};

describe("action connector conversation retention", () => {
  it("marks only built-in xOMC reports for archival", () => {
    expect(isLegacyProactiveConversation(base)).toBe(true);
    expect(isLegacyProactiveConversation({
      ...base,
      context: { ...base.context, scenarioKey: "assistant:abc" }
    })).toBe(false);
    expect(isLegacyProactiveConversation({
      ...base,
      context: { ...base.context, externalIdentity: { externalUserId: "owner-1" } }
    })).toBe(false);
    expect(isLegacyProactiveConversation({ ...base, context: { ...base.context, proactive: false } })).toBe(false);
  });

  it("keeps retries of one durable run on one conversation", () => {
    expect(legacyProactiveConversationId("run-1")).toBe("proactive-run-1");
    expect(legacyProactiveConversationId("run-1")).toBe(legacyProactiveConversationId("run-1"));
  });
});
