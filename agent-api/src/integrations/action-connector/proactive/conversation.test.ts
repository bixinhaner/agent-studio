import { describe, expect, it } from "vitest";

import { proactiveConversationId } from "./conversation.js";
import { BUILTIN_SCENARIOS } from "./scenario-catalog.js";
import { XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";

function event(overrides: Partial<ConnectorEventEnvelope> = {}): ConnectorEventEnvelope {
  return {
    contractVersion: "1.0",
    eventId: "event-1",
    eventType: "omc.alarm.severe-raised.v1",
    source: "xomc",
    occurredAt: "2026-09-22T00:00:00.000Z",
    traceId: "trace-1",
    integrationPack: XOMC_PACKAGE,
    handbookDigest: "sha256:handbook",
    conversationScope: { partition: "device:device-1" },
    resources: [
      { type: "alarm", id: "alarm-1", role: "alarm" },
      { type: "device", id: "device-1", role: "device" }
    ],
    data: { severity: "critical" },
    ...overrides
  };
}

describe("proactive conversation identity", () => {
  const scenario = BUILTIN_SCENARIOS.find((item) => item.key === "severe-alarm-explanation")!;
  const input = {
    connectorId: "connector-1",
    externalUserId: "xomc-proactive-service",
    scenario,
    locale: "zh-CN"
  };

  it("reuses one conversation for new runs in the same resource and authorization scope", () => {
    const first = proactiveConversationId({ ...input, event: event() });
    const second = proactiveConversationId({
      ...input,
      event: event({ eventId: "event-2", traceId: "trace-2", occurredAt: "2026-09-22T01:00:00.000Z", data: { severity: "major" } })
    });
    expect(first).toBe(second);
    expect(first).toMatch(/^proactive-severe-alarm-explanation-[a-f0-9]{64}$/);
  });

  it("rotates context when the resource, policy, package or locale changes", () => {
    const first = proactiveConversationId({ ...input, event: event() });
    expect(proactiveConversationId({ ...input, event: event({ conversationScope: { partition: "device:device-2" } }) })).not.toBe(first);
    expect(proactiveConversationId({ ...input, event: event({ conversationScope: { partition: "device:device-1", authorizationDigest: "sha256:policy-2" } }) })).not.toBe(first);
    expect(proactiveConversationId({ ...input, event: event({ handbookDigest: "sha256:handbook-2" }) })).not.toBe(first);
    expect(proactiveConversationId({ ...input, locale: "en-US", event: event() })).not.toBe(first);
  });

  it("uses a stable device fallback for old events without conversationScope", () => {
    const first = proactiveConversationId({ ...input, event: event({ conversationScope: undefined }) });
    const second = proactiveConversationId({ ...input, event: event({ conversationScope: undefined, eventId: "event-2" }) });
    expect(first).toBe(second);
  });
});
