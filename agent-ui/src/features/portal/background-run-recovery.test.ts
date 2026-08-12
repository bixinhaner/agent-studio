import { describe, expect, it } from "vitest";

import { completedAssistantContentForParent, isPortalTransportDisconnect } from "./background-run-recovery";

describe("portal background run recovery", () => {
  it("recognizes browser transport interruptions but not business failures", () => {
    expect(isPortalTransportDisconnect(new TypeError("Failed to fetch"))).toBe(true);
    expect(isPortalTransportDisconnect(new Error("socket closed"))).toBe(true);
    expect(isPortalTransportDisconnect(new Error("Permission denied"))).toBe(false);
  });

  it("returns only the completed assistant for the submitted user message", () => {
    const content = completedAssistantContentForParent({
      messages: [
        { parent_id: "user-1", message: { role: "assistant", status: { type: "incomplete" }, content: [] } },
        { parent_id: "user-2", message: { role: "assistant", status: { type: "complete" }, content: [{ type: "text", text: "other" }] } },
        { parent_id: "user-1", message: { role: "assistant", status: { type: "complete" }, content: [{ type: "text", text: "answer" }] } }
      ]
    }, "user-1");
    expect(content).toEqual([{ type: "text", text: "answer" }]);
  });

  it("does not recover a completed answer from a different run of the same user message", () => {
    const payload = {
      messages: [
        {
          parent_id: "user-1",
          message: { role: "assistant", status: { type: "complete" }, content: [{ type: "text", text: "old" }] },
          run_config: { runId: "run-old" }
        },
        {
          parent_id: "user-1",
          message: { role: "assistant", status: { type: "complete" }, content: [{ type: "text", text: "current" }] },
          run_config: { runId: "run-current" }
        }
      ]
    };

    expect(completedAssistantContentForParent(payload, "user-1", "run-current")).toEqual([
      { type: "text", text: "current" }
    ]);
    expect(completedAssistantContentForParent(payload, "user-1", "run-missing")).toBeNull();
  });
});
