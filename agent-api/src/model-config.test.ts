import { describe, expect, it } from "vitest";
import {
  fallbackModelCatalog,
  normalizeReasoningEffortForModel,
  validateModelCapabilitySelection
} from "./model-config.js";

describe("model-config", () => {
  it("preserves frontier reasoning efforts for gpt-5.5", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "none")).toBe("none");
    expect(normalizeReasoningEffortForModel("gpt-5.5", "xhigh")).toBe("xhigh");
  });

  it("maps legacy minimal reasoning to none for gpt-5.5", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.5", "minimal")).toBe("none");
  });

  it("uses model-specific GPT-5.6 defaults and efforts", () => {
    expect(normalizeReasoningEffortForModel("gpt-5.6-sol")).toBe("low");
    expect(normalizeReasoningEffortForModel("gpt-5.6-terra")).toBe("medium");
    expect(normalizeReasoningEffortForModel("gpt-5.6-luna")).toBe("medium");
    expect(normalizeReasoningEffortForModel("gpt-5.6-sol", "ultra")).toBe("ultra");
    expect(normalizeReasoningEffortForModel("gpt-5.6-luna", "ultra")).toBe("medium");
    expect(normalizeReasoningEffortForModel("gpt-5.6-luna", "max")).toBe("max");
  });

  it("exposes GPT-5.6 fallback capabilities before the runtime upgrade", () => {
    expect(fallbackModelCatalog().models.map((model) => model.id)).toEqual(
      expect.arrayContaining([
        "gpt-5.6-sol",
        "gpt-5.6-terra",
        "gpt-5.6-luna",
        "gpt-5.3-codex",
        "gpt-5.1-codex"
      ])
    );
  });

  it("validates model-specific reasoning without coupling validation to a channel", () => {
    const catalog = fallbackModelCatalog();
    expect(validateModelCapabilitySelection({
      catalog,
      defaultModel: "gpt-5.6-terra",
      allowedModels: ["gpt-5.6-terra"],
      defaultReasoningEffort: "max"
    })).toBeUndefined();
    expect(validateModelCapabilitySelection({
      catalog,
      defaultModel: "gpt-5.6-luna",
      allowedModels: ["gpt-5.6-luna"],
      defaultReasoningEffort: "ultra"
    })).toContain("不支持推理强度 ultra");
    expect(validateModelCapabilitySelection({
      catalog,
      defaultModel: "gpt-5.6-sol",
      allowedModels: ["gpt-5.6-terra"],
      defaultReasoningEffort: "low"
    })).toContain("默认模型必须包含在允许模型中");
  });
});
