import { describe, expect, it } from "vitest";
import { parseModelJSON, planningResponseSchema, validatePlan } from "./contracts.js";
import { buildActionConnectorRuntimePrompt } from "../prompt.js";
import { actionConnectorConfigSchema } from "../../center/action-connector-adapter.js";

import { definition, planningInput } from "./fixtures.js";
const ready = () => planningResponseSchema.parse({ reply: "Ready to test", readiness: "ready", questions: [], missingCapabilities: [], definition: structuredClone(definition) });

describe("assistant plan contract", () => {
  it("supports goals outside any built-in scenario", () => expect(() => validatePlan(planningInput, ready())).not.toThrow());
  it("does not accept invented operations", () => { const r = ready(); r.definition!.operations = ["post.devices.reboot"]; expect(() => validatePlan(planningInput, r)).toThrow("UNKNOWN_CAPABILITY"); });
  it("does not claim ready with unanswered questions", () => { const r = ready(); r.questions = ["Which device?"]; expect(() => validatePlan(planningInput, r)).toThrow("NOT_READY"); });
  it("preserves unsupported requests as explicit blocked plans", () => { const r = ready(); r.readiness = "unsupported"; r.definition = null; r.missingCapabilities = ["Historical performance data is not connected"]; expect(() => validatePlan(planningInput, r)).not.toThrow(); });
  it("rejects a device scope for an unscopable API", () => { const r = ready(); r.definition!.scope = { kind: "device", deviceId: "00000000-0000-4000-8000-000000000001" }; expect(() => validatePlan(planningInput, r)).toThrow("SCOPE_NOT_RESOLVED"); });
  it("rejects invented event fields", () => { const r = ready(); r.definition!.trigger = { kind: "event", eventType: "device.event", conditions: [{ field: "invented", op: "eq", value: 1 }] }; expect(() => validatePlan(planningInput, r)).toThrow("UNKNOWN_EVENT"); });
  it("validates IANA schedule timezone", () => { const r = ready(); r.definition!.trigger = { kind: "schedule", time: "09:00", weekdays: [1], timezone: "not/a-zone", conditions: [] }; expect(() => validatePlan(planningInput, r)).toThrow(); });
  it.each(["some prose {}", "{}\n{}", "```js\nalert(1)\n```", "[1,2]"])("rejects non-JSON output: %s", (text) => expect(() => parseModelJSON(text)).toThrow());
  it("accepts one JSON fence without eval or repair", () => expect(parseModelJSON("```json\n{\"name\":\"real\"}\n```")).toEqual({ name: "real" }));
  it("builder bypasses the interactive tool-use prompt", () => {
    expect(buildActionConnectorRuntimePrompt({ config: actionConnectorConfigSchema.parse({ displayName: "Test", runtimePrompt: "Run tools: {{message}}" }), request: { message: "Plan, do not execute", locale: "en", timezone: "UTC", mode: "preview", context: { assistantBuilder: true } }, runId: "r", conversationId: "c", cliPath: "/unused" })).toBe("Plan, do not execute");
  });
});
