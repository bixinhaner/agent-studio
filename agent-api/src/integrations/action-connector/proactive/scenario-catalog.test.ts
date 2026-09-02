import { describe, expect, it } from "vitest";

import { XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";
import { BUILTIN_SCENARIOS, includedInRollout, matchesScenario, renderDedupeKey } from "./scenario-catalog.js";

function event(overrides: Partial<ConnectorEventEnvelope> = {}): ConnectorEventEnvelope {
  return {
    contractVersion: "1.0",
    eventId: "event-1",
    eventType: "omc.alarm.severe-raised.v1",
    source: "xomc",
    occurredAt: "2026-09-02T02:00:00.000Z",
    traceId: "trace-1",
    integrationPack: XOMC_PACKAGE,
    handbookDigest: "sha256:handbook",
    resources: [
      { type: "alarm", id: "alarm-1", role: "alarm" },
      { type: "device", id: "device-1", role: "device" }
    ],
    data: { severity: "critical" },
    ...overrides
  };
}

describe("proactive scenario catalog", () => {
  it("contains the four versioned xOMC scenarios with GET-only policies", () => {
    expect(BUILTIN_SCENARIOS.map((scenario) => scenario.key)).toEqual([
      "task-failure-analysis",
      "access-review-assistant",
      "severe-alarm-explanation",
      "daily-operations-summary"
    ]);
    for (const scenario of BUILTIN_SCENARIOS) {
      expect(scenario.agent.allowedOperations.length).toBeGreaterThan(0);
      expect(scenario.agent.prompt).toContain("只读");
      expect(scenario.agent.prompt).toContain(`\"scenarioKey\":\"${scenario.key}\"`);
    }
  });

  it("matches severe alarms but filters lower severity", () => {
    const scenario = BUILTIN_SCENARIOS.find((item) => item.key === "severe-alarm-explanation")!;
    expect(matchesScenario(scenario, event())).toBe(true);
    expect(matchesScenario(scenario, event({ data: { severity: "minor" } }))).toBe(false);
  });

  it("renders resource-bound dedupe keys", () => {
    const scenario = BUILTIN_SCENARIOS.find((item) => item.key === "severe-alarm-explanation")!;
    expect(renderDedupeKey(scenario, event())).toBe("alarm-1");
  });

  it("uses a stable rollout decision", () => {
    const scenario = BUILTIN_SCENARIOS[0];
    expect(includedInRollout("connector-1", scenario, 25, "resource-1"))
      .toBe(includedInRollout("connector-1", scenario, 25, "resource-1"));
    expect(includedInRollout("connector-1", scenario, 0, "resource-1")).toBe(false);
    expect(includedInRollout("connector-1", scenario, 100, "resource-1")).toBe(true);
  });
});
