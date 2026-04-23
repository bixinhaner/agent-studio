import { describe, expect, it } from "vitest";
import { normalizeReasoningEffortForModel } from "./model-config.js";

describe("model-config", () => {
  it("preserves frontier reasoning efforts for gpt-5.5", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "none")).toBe("none");
    expect(normalizeReasoningEffortForModel("gpt-5.5", "xhigh")).toBe("xhigh");
  });

  it("maps legacy minimal reasoning to none for gpt-5.5", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "minimal")).toBe("none");
  });
});
