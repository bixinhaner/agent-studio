import { describe, expect, it, vi } from "vitest";
import { AssistantPlanner } from "./planner.js";
import { definition, planningInput } from "./fixtures.js";

const db = {
  integrationInstance: { findUnique: async () => ({ id: "c", type: "action_connector", status: "active", name: "Test" }) },
  integrationInstanceConfig: { findUnique: async () => ({ config: { displayName: "Test" } }) },
};
describe("AssistantPlanner through the existing runtime", () => {
  it("forwards actual identity/locale, validates output, and denies business execution", async () => {
    const runner = vi.fn(async (input) => {
      expect(input.request.context.externalIdentity.externalUserId).toBe("user-1");
      expect(input.request.mode).toBe("preview");
      await expect(input.bridge.request({})).rejects.toThrow("PLANNING_IS_NOT_EXECUTION");
      input.emit({ type: "delta", text: JSON.stringify({ reply: "Try this", readiness: "ready", questions: [], missingCapabilities: [], definition }) });
    });
    const result = await new AssistantPlanner(db as never, runner).plan("c", planningInput);
    expect(result.definition?.goal).toBe(definition.goal); expect(runner).toHaveBeenCalledTimes(1);
  });
  it("never turns a runtime error into a fabricated successful plan", async () => {
    const planner = new AssistantPlanner(db as never, async (input) => input.emit({ type: "error", error: { code: "MODEL_UNAVAILABLE", message: "offline" } }));
    await expect(planner.plan("c", planningInput)).rejects.toThrow("MODEL_UNAVAILABLE");
  });
  it("bounds output and aborts instead of accumulating arbitrary text", async () => {
    const planner = new AssistantPlanner(db as never, async (input) => {
      input.emit({ type: "delta", text: "x".repeat(70_000) }); expect(input.signal?.aborted).toBe(true);
    });
    await expect(planner.plan("c", planningInput)).rejects.toThrow("TOO_LARGE");
  });
  it("corrects an omitted conversation action without inferring activation", async () => {
    const signals: AbortSignal[] = [];
    const ids: string[] = [];
    const runner = vi.fn(async (input) => {
      signals.push(input.signal);
      ids.push(input.request.clientRunId);
      await expect(input.bridge.request({})).rejects.toThrow("PLANNING_IS_NOT_EXECUTION");
      if (ids.length === 2) expect(input.request.message).toContain("Nothing has been saved or executed");
      input.emit({ type: "delta", text: JSON.stringify({
        ...(ids.length === 2 ? { action: "prepare" } : {}),
        reply: "I will check this arrangement", readiness: "ready", questions: [], missingCapabilities: [], definition,
      }) });
    });
    const result = await new AssistantPlanner(db as never, runner).plan("c", { ...planningInput, conversation: { state: "draft" } });
    expect(result.action).toBe("prepare");
    expect(runner).toHaveBeenCalledTimes(2);
    expect(signals[0]).toBe(signals[1]);
    expect(ids[0]).not.toBe(ids[1]);
  });
  it("stops after one failed correction and never retries runtime failure", async () => {
    const malformed = vi.fn(async (input) => input.emit({ type: "delta", text: "not JSON" }));
    await expect(new AssistantPlanner(db as never, malformed).plan("c", planningInput)).rejects.toThrow("INVALID_MODEL_OUTPUT");
    expect(malformed).toHaveBeenCalledTimes(2);
    const unavailable = vi.fn(async (input) => input.emit({ type: "error", error: { code: "MODEL_UNAVAILABLE", message: "offline" } }));
    await expect(new AssistantPlanner(db as never, unavailable).plan("c", planningInput)).rejects.toThrow("MODEL_UNAVAILABLE");
    expect(unavailable).toHaveBeenCalledTimes(1);
  });
  it("does not accept an otherwise valid response after cancellation", async () => {
    const controller = new AbortController();
    const runner = vi.fn(async (input) => {
      controller.abort();
      input.emit({ type: "delta", text: JSON.stringify({ reply: "Try this", readiness: "ready", questions: [], missingCapabilities: [], definition }) });
    });
    await expect(new AssistantPlanner(db as never, runner).plan("c", planningInput, controller.signal)).rejects.toThrow();
    expect(runner).toHaveBeenCalledTimes(1);
  });
});
