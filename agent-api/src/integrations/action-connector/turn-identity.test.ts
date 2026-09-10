import { describe, expect, it } from "vitest";
import { actionConnectorTurnMessageKey } from "./turn-identity.js";
import { actionConnectorChatRequestSchema } from "./runtime.js";

describe("action connector turn identity", () => {
  it("preserves ordinary chat ids and gives recovery attempts distinct message pairs", () => {
    const r = actionConnectorChatRequestSchema.parse({ message: "Continue" });
    expect(actionConnectorTurnMessageKey(r, "run")).toBe("run");
    r.context.assistantRunAttempt = 1;
    expect(actionConnectorTurnMessageKey(r, "run")).toBe("run-attempt-1");
    r.context.assistantRunAttempt = 2;
    expect(actionConnectorTurnMessageKey(r, "run")).toBe("run-attempt-2");
    for (const value of [0, -1, 1.5, "2", undefined]) {
      r.context.assistantRunAttempt = value;
      expect(actionConnectorTurnMessageKey(r, "run")).toBe("run");
    }
  });
});
