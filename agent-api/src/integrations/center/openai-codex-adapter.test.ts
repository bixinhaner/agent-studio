import { describe, expect, it, vi } from "vitest";

import { OpenAICodexIntegrationAdapter } from "./openai-codex-adapter.js";

describe("OpenAICodexIntegrationAdapter", () => {
  it("validates provider connectivity through the runtime", async () => {
    const validateProvider = vi.fn(async () => undefined);
    const adapter = new OpenAICodexIntegrationAdapter(() => ({
      validateProvider
    }));

    const result = await adapter.validate({
      apiKey: "sk-test",
      baseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-5.4-mini",
      defaultReasoningEffort: "medium"
    });

    expect(validateProvider).toHaveBeenCalledWith({
      model: "gpt-5.4-mini",
      reasoningEffort: "medium"
    });
    expect(result).toMatchObject({
      status: "success",
      summary: "OpenAI/Codex provider validation succeeded"
    });
  });

  it("returns a failed validation outcome when provider validation throws", async () => {
    const adapter = new OpenAICodexIntegrationAdapter(() => ({
      async validateProvider() {
        throw new Error("provider unavailable");
      }
    }));

    const result = await adapter.validate({
      apiKey: "sk-test",
      defaultModel: "gpt-5.4-mini"
    });

    expect(result).toMatchObject({
      status: "failed",
      summary: "OpenAI/Codex provider validation failed",
      detail: {
        message: "provider unavailable"
      }
    });
  });
});
