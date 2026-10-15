import { describe, expect, it } from "vitest";
import { acceptedWatch, parseModelJSON, planningResponseSchema, resultSchema, validatePlan } from "./contracts.js";
import { buildActionConnectorRuntimePrompt } from "../prompt.js";
import { actionConnectorConfigSchema } from "../../center/action-connector-adapter.js";

import { definition, planningInput } from "./fixtures.js";
const ready = () => planningResponseSchema.parse({ reply: "Ready to test", readiness: "ready", questions: [], missingCapabilities: [], definition: structuredClone(definition) });

describe("assistant plan contract", () => {
  it("allows explaining a historical draft while keeping prepare strictly validated", () => {
    const input = { ...planningInput, conversation: { state: "draft" } };
    const reply = ready();
    reply.action = "reply";
    reply.definition!.trigger = { kind: "manual", time: "10:00", timezone: "Asia/Shanghai", conditions: [] };
    expect(() => validatePlan(input, reply)).not.toThrow();
    reply.action = "prepare";
    expect(() => validatePlan(input, reply)).toThrow("ASSISTANT_INVALID_SCHEDULE");
  });
  it("requires an explicit action for conversation and keeps investigation immutable", () => {
    const input = { ...planningInput, definition, conversation: { state: "draft" } };
    const r = ready();
    expect(() => validatePlan(input, r)).toThrow("INVALID_MODEL_OUTPUT");
    r.action = "investigate";
    expect(() => validatePlan(input, r)).not.toThrow();
    r.definition!.goal = "Different ongoing goal";
    expect(() => validatePlan(input, r)).toThrow("INVALID_MODEL_OUTPUT");
  });
  it("rejects contradictory manual schedules and incomplete preparation", () => {
    const r = ready(); r.definition!.trigger.time = "10:00";
    expect(() => validatePlan(planningInput, r)).toThrow("INVALID_SCHEDULE");
    r.definition = null; r.action = "prepare"; r.readiness = "needs_input";
    expect(() => validatePlan(planningInput, r)).toThrow("NOT_READY");
  });
  it("supports goals outside any built-in scenario", () => expect(() => validatePlan(planningInput, ready())).not.toThrow());
  it("does not accept invented operations", () => { const r = ready(); r.definition!.operations = ["post.devices.reboot"]; expect(() => validatePlan(planningInput, r)).toThrow("UNKNOWN_CAPABILITY"); });
  it("does not claim ready with unanswered questions", () => { const r = ready(); r.questions = ["Which device?"]; expect(() => validatePlan(planningInput, r)).toThrow("NOT_READY"); });
  it("preserves unsupported requests as explicit blocked plans", () => { const r = ready(); r.readiness = "unsupported"; r.definition = null; r.missingCapabilities = ["Historical performance data is not connected"]; expect(() => validatePlan(planningInput, r)).not.toThrow(); });
  it("rejects a device scope for an unscopable API", () => { const r = ready(); r.definition!.scope = { kind: "device", deviceId: "00000000-0000-4000-8000-000000000001" }; expect(() => validatePlan(planningInput, r)).toThrow("SCOPE_NOT_RESOLVED"); });
  it("rejects invented event fields", () => { const r = ready(); r.definition!.trigger = { kind: "event", eventType: "device.event", conditions: [{ field: "invented", op: "eq", value: 1 }] }; expect(() => validatePlan(planningInput, r)).toThrow("UNKNOWN_EVENT"); });
  it("validates IANA schedule timezone", () => { const r = ready(); r.definition!.trigger = { kind: "schedule", time: "09:00", weekdays: [1], timezone: "not/a-zone", conditions: [] }; expect(() => validatePlan(planningInput, r)).toThrow(); });
  it.each(["some prose {}", "{}\n{}", "```js\nalert(1)\n```", "[1,2]"])("rejects non-JSON output: %s", (text) => expect(() => parseModelJSON(text)).toThrow());
  it("keeps raw newlines and tabs written inside strings", () => {
    const text = '{"title":"内存占用超过80%","summary":"第一行\n第二行\t87.2%","facts":["a \\"quoted\\"\r\nnext"]}';
    expect(parseModelJSON(text)).toEqual({ title: "内存占用超过80%", summary: "第一行\n第二行\t87.2%", facts: ['a "quoted"\r\nnext'] });
  });
  it("leaves already escaped text and whitespace between fields unchanged", () => {
    expect(parseModelJSON('{\n\t"path": "C:\\\\tmp\\n",\n\t"n": 1\n}')).toEqual({ path: "C:\\tmp\n", n: 1 });
  });
  it("accepts one JSON fence without eval or repair", () => expect(parseModelJSON("```json\n{\"name\":\"real\"}\n```")).toEqual({ name: "real" }));
  it("builder bypasses the interactive tool-use prompt", () => {
    expect(buildActionConnectorRuntimePrompt({ config: actionConnectorConfigSchema.parse({ displayName: "Test", runtimePrompt: "Run tools: {{message}}" }), request: { message: "Plan, do not execute", locale: "en", timezone: "UTC", mode: "preview", context: { assistantBuilder: true } }, runId: "r", conversationId: "c", cliPath: "/unused" })).toBe("Plan, do not execute");
  });
});

describe("assistant check rule", () => {
  const called = new Set(["get.observability.metrics"]);
  const watch = {
    operationId: "get.observability.metrics",
    path: "/api/v1/observability/metrics",
    query: { query: "100 * container_memory_working_set_bytes / container_spec_memory_limit_bytes > 80" },
    items: "data.result.data.result",
    key: "metric.name",
    conditions: [{ field: "value.1", op: "gt", value: 80 }],
    matchedKeys: ["omcgo-watchdog-1"],
  };
  it("keeps a rule that agrees with the outcome and reads a called operation", () => {
    expect(acceptedWatch(watch, "finding", called)).toEqual(watch);
    expect(acceptedWatch({ ...watch, matchedKeys: [] }, "no_change", called)).toBeDefined();
  });
  it.each([
    ["an operation this run did not call", { ...watch, operationId: "get.devices" }, "finding"],
    ["a finding without a matched item", { ...watch, matchedKeys: [] }, "finding"],
    ["no change while items match", watch, "no_change"],
    ["insufficient data", watch, "insufficient_data"],
    ["duplicate identities", { ...watch, matchedKeys: ["a", "a"] }, "finding"],
    ["an unknown operator", { ...watch, conditions: [{ field: "value.1", op: "regex", value: "8" }] }, "finding"],
    ["an expression instead of a path", { ...watch, key: "metric['name']" }, "finding"],
    ["a path outside the API", { ...watch, path: "/internal/x" }, "finding"],
    ["no conditions", { ...watch, conditions: [] }, "finding"],
  ] as const)("drops a rule with %s", (_name, rule, outcome) => expect(acceptedWatch(rule, outcome, called)).toBeUndefined());
  it("never fails the report because of an unusable rule", () => {
    const result = resultSchema.parse({ outcome: "finding", title: "t", summary: "s", facts: [], hypotheses: [], nextSteps: [], watch: { nonsense: true } });
    expect(acceptedWatch(result.watch, result.outcome, called)).toBeUndefined();
  });
});
