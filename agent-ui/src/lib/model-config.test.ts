import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS, contextLimitForModel, normalizeReasoningEffortForModel } from "./model-config";

describe("model-config", () => {
  it("includes gpt-5.5 in the selectable model list", () => {
    expect(MODEL_OPTIONS.some((option) => option.value === "gpt-5.5")).toBe(true);
  });

  it("treats gpt-5.5 like a frontier model for reasoning effort normalization", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "none")).toBe("none");
    expect(normalizeReasoningEffortForModel("gpt-5.5", "minimal")).toBe("none");
  });

  it("includes GPT-5.6 variants with model-specific reasoning choices", () => {
    expect(MODEL_OPTIONS.map((option) => option.value)).toEqual(
      expect.arrayContaining(["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"])
    );
    expect(normalizeReasoningEffortForModel("gpt-5.6-sol", "ultra")).toBe("ultra");
    expect(normalizeReasoningEffortForModel("gpt-5.6-luna", "ultra")).toBe("medium");
  });

  it("uses current context windows for frontier models", () => {
    expect(contextLimitForModel("gpt-5.6-sol")).toBe(1_050_000);
    expect(contextLimitForModel("gpt-5.5")).toBe(1_050_000);
    expect(contextLimitForModel("gpt-5.4-mini")).toBe(400_000);
  });
});
