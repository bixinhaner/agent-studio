import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS, normalizeReasoningEffortForModel } from "./model-config";

describe("model-config", () => {
  it("includes gpt-5.5 in the selectable model list", () => {
    expect(MODEL_OPTIONS.some((option) => option.value === "gpt-5.5")).toBe(true);
  });

  it("treats gpt-5.5 like a frontier model for reasoning effort normalization", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "none")).toBe("none");
    expect(normalizeReasoningEffortForModel("gpt-5.5", "minimal")).toBe("none");
  });
});
