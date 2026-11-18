import { describe, expect, it } from "vitest";
import { applyCodexMemoryToProviderSnapshot, CHATGPT_MEMORY_MODEL, codexMemoryGenerationActive } from "./codex-memory-config.js";
import { createLocalAuthProviderSnapshot, createManagedCodexProviderSnapshot } from "./managed-codex-provider.js";
import { createDefaultSystemSettingsPayload } from "./system-settings/types.js";

const memorySettings = createDefaultSystemSettingsPayload().codexMemory;

function deepseekSnapshot() {
  return createManagedCodexProviderSnapshot({
    config: { providerKind: "openai_api", baseUrl: "https://api.deepseek.com/v1", defaultModel: "deepseek-flash" },
    secrets: { apiKey: "test-key" }
  });
}

describe("applyCodexMemoryToProviderSnapshot", () => {
  it("keeps reading memories but stops generating them for API providers by default", () => {
    const snapshot = applyCodexMemoryToProviderSnapshot(deepseekSnapshot(), memorySettings);
    expect(snapshot.runtimeOptions.config).toMatchObject({
      features: { memories: true },
      memories: { use_memories: true, generate_memories: false }
    });
    const memories = (snapshot.runtimeOptions.config as { memories: Record<string, unknown> }).memories;
    expect(memories.extract_model).toBeUndefined();
    expect(memories.consolidation_model).toBeUndefined();
    expect(codexMemoryGenerationActive("openai_api", memorySettings)).toBe(false);
  });

  it("overrides a generation flag persisted on an existing API provider thread", () => {
    const existing = deepseekSnapshot();
    existing.runtimeOptions = { ...existing.runtimeOptions, config: { memories: { generate_memories: true } } };
    const snapshot = applyCodexMemoryToProviderSnapshot(existing, memorySettings);
    expect(snapshot.runtimeOptions.config).toMatchObject({ memories: { generate_memories: false } });
  });

  it("pins memory extraction and consolidation to the API provider's default model when opted in", () => {
    const snapshot = applyCodexMemoryToProviderSnapshot(deepseekSnapshot(), { ...memorySettings, generateMemoriesWithApiProvider: true });
    expect(codexMemoryGenerationActive("openai_api", { ...memorySettings, generateMemoriesWithApiProvider: true })).toBe(true);
    expect(snapshot.runtimeOptions.config).toMatchObject({
      features: { memories: true },
      memories: { generate_memories: true, extract_model: "deepseek-flash", consolidation_model: "deepseek-flash" }
    });
  });

  it("pins both memory phases to gpt-6-luna for ChatGPT sign-in", () => {
    const snapshot = applyCodexMemoryToProviderSnapshot(createLocalAuthProviderSnapshot(), { ...memorySettings, enabled: true });
    const memories = (snapshot.runtimeOptions.config as { memories: Record<string, unknown> }).memories;
    expect(CHATGPT_MEMORY_MODEL).toBe("gpt-6-luna");
    expect(memories.generate_memories).toBe(true);
    expect(codexMemoryGenerationActive("chatgpt", memorySettings)).toBe(true);
    expect(memories.extract_model).toBe("gpt-6-luna");
    expect(memories.consolidation_model).toBe("gpt-6-luna");
  });

  it("replaces memory models persisted on an existing ChatGPT thread snapshot", () => {
    const existing = createLocalAuthProviderSnapshot();
    existing.runtimeOptions = {
      ...existing.runtimeOptions,
      config: { memories: { extract_model: "gpt-5.6-luna", consolidation_model: "gpt-5.6-terra" } }
    };
    const snapshot = applyCodexMemoryToProviderSnapshot(existing, { ...memorySettings, enabled: true });
    expect(snapshot.runtimeOptions.config).toMatchObject({
      memories: { extract_model: "gpt-6-luna", consolidation_model: "gpt-6-luna" }
    });
  });

  it("does not pin memory models for ChatGPT sign-in when generation is off", () => {
    const snapshot = applyCodexMemoryToProviderSnapshot(createLocalAuthProviderSnapshot(), {
      ...memorySettings,
      enabled: true,
      generateMemories: false
    });
    const memories = (snapshot.runtimeOptions.config as { memories: Record<string, unknown> }).memories;
    expect(memories.generate_memories).toBe(false);
    expect(memories.extract_model).toBeUndefined();
    expect(memories.consolidation_model).toBeUndefined();
  });

  it("does not set memory models when memories are disabled", () => {
    const snapshot = applyCodexMemoryToProviderSnapshot(deepseekSnapshot(), { ...memorySettings, enabled: false });
    expect(snapshot.runtimeOptions.config).toMatchObject({ memories: { generate_memories: false } });
    const memories = (snapshot.runtimeOptions.config as { memories: Record<string, unknown> }).memories;
    expect(memories.extract_model).toBeUndefined();
  });
});
