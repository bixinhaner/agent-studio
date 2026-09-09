import { describe, expect, it } from "vitest";
import { MODEL_OPTIONS, modelOptionsFromCatalog, contextLimitForModel, normalizeReasoningEffortForModel } from "./model-config";

describe("model-config", () => {
  it("keeps Astra capacity when the runtime catalog omits contextWindow", () => {
    const models = modelOptionsFromCatalog({source: "app_server", fetchedAt: "2026-09-08T00:00:00Z", models: [{
      id: "gpt-6-astra", label: "GPT-6 Astra", hidden: false, isDefault: true,
      defaultReasoningEffort: "low", supportedReasoningEfforts: ["low", "medium", "high", "xhigh", "max", "ultra"],
      inputModalities: ["text", "image"], serviceTiers: []
    }]});
    expect(contextLimitForModel("gpt-6-astra", models)).toBe(1_050_000);
    expect(normalizeReasoningEffortForModel("gpt-6-astra", "none")).toBe("low");
    expect(normalizeReasoningEffortForModel("gpt-6-astra", "ultra")).toBe("ultra");
  });

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
