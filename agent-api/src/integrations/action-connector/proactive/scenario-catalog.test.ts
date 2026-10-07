import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { XOMC_PACKAGE, type ConnectorEventEnvelope } from "./contracts.js";
import {
  BUILTIN_SCENARIOS,
  currentScenarios,
  includedInRollout,
  loadScenarioCatalog,
  matchesScenario,
  parseScenarioCatalog,
  reloadScenarioCatalog,
  renderDedupeKey,
  scenarioCatalogPaths
} from "./scenario-catalog.js";

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

  it("loads the catalog from the checkout's runtime content", () => {
    const catalog = loadScenarioCatalog();
    expect(catalog.path).toBe(scenarioCatalogPaths()[0]);
    expect(catalog.path).toContain(path.join("templates", "runtime-content", "proactive-scenarios.json"));
    expect(catalog.digest).toMatch(/^[0-9a-f]{64}$/);
  });

  it("rejects invalid edits, including write operations, as a whole", () => {
    const raw = JSON.parse(fs.readFileSync(scenarioCatalogPaths()[0], "utf8")) as { scenarios: Array<{ agent: { allowedOperations: string[] } }> };
    expect(parseScenarioCatalog(raw)).toHaveLength(raw.scenarios.length);
    raw.scenarios[0]!.agent.allowedOperations.push("post.devices.reboot");
    expect(() => parseScenarioCatalog(raw)).toThrow(/get\.\* operations/);
    expect(() => parseScenarioCatalog({ schemaVersion: 2, scenarios: [] })).toThrow(/schemaVersion/);
  });

  it("hot reloads a changed catalog file and keeps the current one on a bad edit", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "scenario-catalog-"));
    const file = path.join(dir, "proactive-scenarios.json");
    const raw = JSON.parse(fs.readFileSync(scenarioCatalogPaths()[0], "utf8")) as {
      scenarios: Array<{ key: string; agent: { finding: { objective: string } } }>;
    };
    try {
      raw.scenarios[0]!.agent.finding.objective = "新的分析目标。";
      fs.writeFileSync(file, JSON.stringify(raw));
      const next = reloadScenarioCatalog([file]);
      expect(next?.specs[0]?.agent.prompt).toContain("新的分析目标。");
      expect(currentScenarios()[0]?.agent.prompt).toContain("新的分析目标。");
      expect(reloadScenarioCatalog([file])).toBeUndefined();

      fs.writeFileSync(file, "{ not json");
      expect(() => reloadScenarioCatalog([file])).toThrow();
      expect(currentScenarios()[0]?.agent.prompt).toContain("新的分析目标。");
    } finally {
      reloadScenarioCatalog(scenarioCatalogPaths());
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(currentScenarios()).toEqual(BUILTIN_SCENARIOS);
  });
});
