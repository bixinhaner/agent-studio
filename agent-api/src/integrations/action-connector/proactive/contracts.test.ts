import { describe, expect, it } from "vitest";

import { connectorEventSchema, findingSchema, TASK_FAILURE_SCENARIO, XOMC_PACKAGE } from "./contracts.js";
import { BACKGROUND_HANDBOOK_OPERATIONS } from "./durable-tool-bridge.js";

describe("proactive action connector contracts", () => {
  it("accepts the pinned xOMC task failure event", () => {
    const event = connectorEventSchema.parse({
      contractVersion: "1.0", eventId: "event-1", eventType: "omc.task.failed.v1",
      source: "xomc", occurredAt: "2026-08-27T12:00:00.000Z", traceId: "trace-1",
      integrationPack: XOMC_PACKAGE, handbookDigest: "sha256:handbook",
      resources: [{ type: "task", id: "task-1", role: "task" }], data: { taskType: "set_parameter_values" }
    });
    expect(event.integrationPack.digest).toBe(XOMC_PACKAGE.digest);
  });

  it("rejects facts without evidence and actions outside the UI whitelist", () => {
    const base = {
      schemaVersion: "1.0", scenarioKey: "task-failure-analysis", scenarioVersion: 1,
      title: "Task failed", summary: "The device was offline.", severity: "high", confidence: 0.8,
      facts: [{ id: "fact-1", text: "Offline", evidenceRefs: [] }], hypotheses: [],
      resourceRefs: [{ type: "task", id: "task-1", role: "task" }], details: {},
      suggestedActions: [{ type: "execute-remediation", label: "Fix" }], presentation: {}
    };
    const result = findingSchema.safeParse(base);
    expect(result.success).toBe(false);
  });

  it("pins evidence collection and the complete finding contract in the task failure prompt", () => {
    expect(TASK_FAILURE_SCENARIO.prompt).toContain("get.devices.tasks.by_task_id");
    const template = TASK_FAILURE_SCENARIO.prompt.slice(TASK_FAILURE_SCENARIO.prompt.indexOf("{"));
    expect(findingSchema.parse(JSON.parse(template))).toMatchObject({
      schemaVersion: "1.0", scenarioKey: "task-failure-analysis", scenarioVersion: 1
    });
  });

  it("limits background handbook bootstrap to the two immutable GET operations", () => {
    expect([...BACKGROUND_HANDBOOK_OPERATIONS]).toEqual([
      "get.agent.handbook.manifest",
      "get.agent.handbook.chunks.by_index"
    ]);
  });
});
