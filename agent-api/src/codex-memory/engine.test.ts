import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCodexMemoryConfigOverrides } from "../codex-memory-config.js";
import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";
import type { ManagedCodexProviderSnapshot } from "../managed-codex-provider.js";
import { CodexMemoryEngine, callMemoryLlm, llmUsageFromResponse, resolveLlmConfig } from "./engine.js";

const providerSnapshot: ManagedCodexProviderSnapshot = {
  version: 1,
  kind: "openai_api",
  source: "integration",
  config: {
    providerKind: "openai_api",
    defaultModel: "gpt-5.4",
    defaultReasoningEffort: "high"
  },
  secrets: {
    apiKey: "test-key"
  },
  runtimeOptions: {}
};

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CodexMemoryEngine (retired extraction)", () => {
  it("never calls an LLM or writes memory files, even with the legacy Agent Studio engine selected", async () => {
    const sessionHomeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-root-"));
    const codexHome = path.join(sessionHomeRoot, "internal", "user-1", "agent-mode-1-abcdef");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const engine = new CodexMemoryEngine({
      getSettings: async () => ({ ...createDefaultSystemSettingsPayload().codexMemory, generationEngine: "agent_studio" as const }),
      resolveProviderSnapshot: async () => providerSnapshot,
      sessionHomeRoot,
      logger: console
    });

    engine.enqueueRun({ channel: "portal", prompt: "记住我喜欢中文。", answerText: "好的。", codexHome });
    engine.enqueueRun({ channel: "portal", prompt: "", answerText: "无输入。", codexHome });
    await (engine as unknown as { queue: Promise<void> }).queue;

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fs.stat(codexHome)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(fs.stat(path.join(sessionHomeRoot, "internal", "user-1", ".agent-studio-memory"))).rejects.toMatchObject({ code: "ENOENT" });
    const log = await fs.readFile(path.join(sessionHomeRoot, ".agent-studio", "memory-runs.jsonl"), "utf8");
    expect(log.trim().split("\n").map((line) => JSON.parse(line) as { status: string; reason: string })).toMatchObject([
      { status: "skipped_no_durable_memory", reason: "codex_native_generation" },
      { status: "skipped_missing_input", reason: "missing_prompt" }
    ]);
  });

  it("lets Codex native memory generate regardless of the stored engine value", () => {
    const settings = createDefaultSystemSettingsPayload().codexMemory;
    expect(settings.generationEngine).toBe("codex_native");
    for (const generationEngine of ["agent_studio", "codex_native"] as const) {
      expect(buildCodexMemoryConfigOverrides({ ...settings, generationEngine })).toMatchObject({
        memories: { use_memories: true, generate_memories: true }
      });
    }
    expect(buildCodexMemoryConfigOverrides({ ...settings, generateMemories: false })).toMatchObject({
      memories: { generate_memories: false }
    });
  });
});

describe("memory LLM client", () => {
  it("maps token usage, including OpenAI and DeepSeek cached input, capped at input", () => {
    expect(llmUsageFromResponse({
      usage: { prompt_tokens: 1200, completion_tokens: 300, prompt_tokens_details: { cached_tokens: 1024 } }
    })).toEqual({ inputTokens: 1200, cachedInputTokens: 1024, outputTokens: 300 });
    expect(llmUsageFromResponse({
      usage: { prompt_tokens: 900, completion_tokens: 50, prompt_cache_hit_tokens: 640, prompt_cache_miss_tokens: 260 }
    })).toEqual({ inputTokens: 900, cachedInputTokens: 640, outputTokens: 50 });
    expect(llmUsageFromResponse({
      usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 99 } }
    })).toEqual({ inputTokens: 10, cachedInputTokens: 10, outputTokens: 5 });
    expect(llmUsageFromResponse({})).toEqual({ inputTokens: 0, cachedInputTokens: 0, outputTokens: 0 });
  });

  it("calls a UI-configured OpenAI-compatible chat completions provider and returns text with usage", async () => {
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      llmProvider: "openai_compatible" as const,
      llmApiMode: "chat_completions" as const,
      llmBaseUrl: "https://api.deepseek.com/",
      llmModel: "deepseek-chat"
    };
    const config = resolveLlmConfig(settings, providerSnapshot, { apiKey: "deepseek-key" });
    expect(config).toMatchObject({ provider: "openai_compatible", model: "deepseek-chat", apiKey: "deepseek-key" });
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: "{\"ok\":true}" } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, prompt_cache_hit_tokens: 64 }
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await callMemoryLlm(config!, "translate", { json: true });

    expect(result).toEqual({ text: "{\"ok\":true}", usage: { inputTokens: 100, cachedInputTokens: 64, outputTokens: 20 } });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(init.body))).toMatchObject({ model: "deepseek-chat", response_format: { type: "json_object" } });
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer deepseek-key");
  });

  it("returns no config when a custom provider has no API key", () => {
    const settings = { ...createDefaultSystemSettingsPayload().codexMemory, llmProvider: "openai_compatible" as const, llmApiKeyEnv: "UNSET_TEST_KEY" };
    expect(resolveLlmConfig(settings, providerSnapshot, {})).toBeUndefined();
  });
});
