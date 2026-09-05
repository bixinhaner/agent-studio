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
});
