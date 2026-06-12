import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { buildCodexMemoryConfigOverrides } from "../codex-memory-config.js";
import { createDefaultSystemSettingsPayload } from "../system-settings/types.js";
import type { ManagedCodexProviderSnapshot } from "../managed-codex-provider.js";
import { CodexMemoryEngine } from "./engine.js";

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
});

describe("CodexMemoryEngine", () => {
  it("writes Codex-compatible memory files from an Agent Studio LLM extraction", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-"));
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      disableOnExternalContext: false
    };
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      output_text: JSON.stringify({
        shouldRemember: true,
        confidence: 0.92,
        category: "preference",
        memory: "用户偏好使用中文、结论先行且说明对生产的影响。",
        summary: "用户偏好中文、结论先行，并关注生产影响。",
        slug: "communication-preference"
      })
    }), { status: 200, headers: { "content-type": "application/json" } })));

    const engine = new CodexMemoryEngine({
      getSettings: async () => settings,
      resolveProviderSnapshot: async () => providerSnapshot,
      logger: console
    });

    await (engine as unknown as { processRun(input: unknown): Promise<void> }).processRun({
      channel: "portal",
      prompt: "以后回答用中文，先说结论。",
      answerText: "我会按中文、结论先行来回答。",
      codexHome,
      sessionId: "session-1",
      threadId: "thread-1",
      model: "gpt-5.4",
      hasExternalContext: false
    });

    await expect(fs.readFile(path.join(codexHome, "memories", "MEMORY.md"), "utf8")).resolves.toContain(
      "用户偏好使用中文、结论先行且说明对生产的影响。"
    );
    await expect(fs.readFile(path.join(codexHome, "memories", "raw_memories.md"), "utf8")).resolves.toContain(
      "source: portal"
    );
    const rolloutFiles = await fs.readdir(path.join(codexHome, "memories", "rollout_summaries"));
    expect(rolloutFiles).toHaveLength(1);
  });

  it("records memory run outcomes for written and skipped tasks", async () => {
    const sessionHomeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-root-"));
    const codexHome = path.join(sessionHomeRoot, "internal", "user-1", "agent-mode-1");
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      disableOnExternalContext: false
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldRemember: true,
          confidence: 0.92,
          category: "preference",
          memory: "用户偏好测试记忆统计日志。",
          summary: "测试统计日志写入。",
          slug: "memory-log"
        })
      }), { status: 200, headers: { "content-type": "application/json" } }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        output_text: JSON.stringify({
          shouldRemember: false,
          confidence: 0.2,
          category: "transient",
          memory: "",
          summary: "",
          slug: "skip"
        })
      }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const engine = new CodexMemoryEngine({
      getSettings: async () => settings,
      resolveProviderSnapshot: async () => providerSnapshot,
      sessionHomeRoot,
      logger: console
    });

    engine.enqueueRun({
      channel: "portal",
      prompt: "记住统计日志。",
      answerText: "已记录。",
      codexHome,
      hasExternalContext: false
    });
    engine.enqueueRun({
      channel: "portal",
      prompt: "今天随便问一下天气。",
      answerText: "这是一次性问题。",
      codexHome,
      hasExternalContext: false
    });
    await (engine as unknown as { queue: Promise<void> }).queue;

    const log = await fs.readFile(path.join(sessionHomeRoot, ".agent-studio", "memory-runs.jsonl"), "utf8");
    const entries = log.trim().split("\n").map((line) => JSON.parse(line) as { status: string; reason: string; relativeHome?: string });
    expect(entries).toMatchObject([
      { status: "written", reason: "memory_written", relativeHome: "internal/user-1/agent-mode-1" },
      { status: "skipped_no_durable_memory", reason: "model_declined", relativeHome: "internal/user-1/agent-mode-1" }
    ]);
  });

  it("records missing input and failed memory run outcomes", async () => {
    const sessionHomeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-root-"));
    const codexHome = path.join(sessionHomeRoot, "internal", "user-1", "agent-mode-1");
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      llmProvider: "openai_compatible" as const,
      llmBaseUrl: "https://api.example.test",
      disableOnExternalContext: false
    };
    const engine = new CodexMemoryEngine({
      getSettings: async () => settings,
      resolveProviderSnapshot: async () => ({
        ...providerSnapshot,
        secrets: {}
      }),
      getLlmSecretState: async () => ({}),
      sessionHomeRoot,
      logger: console
    });

    engine.enqueueRun({
      channel: "portal",
      prompt: "",
      answerText: "无输入。",
      codexHome,
      hasExternalContext: false
    });
    engine.enqueueRun({
      channel: "portal",
      prompt: "记住一条偏好。",
      answerText: "好的。",
      codexHome,
      hasExternalContext: false
    });
    await (engine as unknown as { queue: Promise<void> }).queue;

    const log = await fs.readFile(path.join(sessionHomeRoot, ".agent-studio", "memory-runs.jsonl"), "utf8");
    const entries = log.trim().split("\n").map((line) => JSON.parse(line) as { status: string; reason: string; error?: string });
    expect(entries).toMatchObject([
      { status: "skipped_missing_input", reason: "missing_prompt" },
      { status: "failed", reason: "missing_llm_config" }
    ]);
  });

  it("skips Agent Studio generation when Codex native generation is selected", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-"));
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      generationEngine: "codex_native" as const,
      disableOnExternalContext: false
    };
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const engine = new CodexMemoryEngine({
      getSettings: async () => settings,
      resolveProviderSnapshot: async () => providerSnapshot,
      logger: console
    });

    await (engine as unknown as { processRun(input: unknown): Promise<void> }).processRun({
      channel: "portal",
      prompt: "记住我喜欢中文。",
      answerText: "好的。",
      codexHome,
      hasExternalContext: false
    });

    expect(fetchMock).not.toHaveBeenCalled();
    await expect(fs.stat(path.join(codexHome, "memories"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("supports UI-configured OpenAI-compatible chat completions providers", async () => {
    const codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "agent-studio-memory-"));
    const settings = {
      ...createDefaultSystemSettingsPayload().codexMemory,
      llmProvider: "openai_compatible" as const,
      llmApiMode: "chat_completions" as const,
      llmBaseUrl: "https://api.deepseek.com",
      llmModel: "deepseek-chat",
      disableOnExternalContext: false
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => new Response(JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              shouldRemember: true,
              confidence: 0.9,
              category: "workflow",
              memory: "用户偏好在记忆模块使用可配置 OpenAI-compatible LLM。",
              summary: "记忆模块使用可配置兼容模型。",
              slug: "memory-llm-provider"
            })
          }
        }
      ]
    }), { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const engine = new CodexMemoryEngine({
      getSettings: async () => settings,
      resolveProviderSnapshot: async () => providerSnapshot,
      getLlmSecretState: async () => ({ apiKey: "deepseek-key" }),
      logger: console
    });

    await (engine as unknown as { processRun(input: unknown): Promise<void> }).processRun({
      channel: "portal",
      prompt: "记忆模块用 DeepSeek。",
      answerText: "我会使用兼容接口。",
      codexHome,
      hasExternalContext: false
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.deepseek.com/chat/completions");
    expect(JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body))).toMatchObject({
      model: "deepseek-chat",
      response_format: { type: "json_object" }
    });
    await expect(fs.readFile(path.join(codexHome, "memories", "MEMORY.md"), "utf8")).resolves.toContain(
      "用户偏好在记忆模块使用可配置 OpenAI-compatible LLM。"
    );
  });

  it("keeps Codex native generation disabled when Agent Studio owns generation", () => {
    const settings = createDefaultSystemSettingsPayload().codexMemory;
    expect(buildCodexMemoryConfigOverrides(settings)).toMatchObject({
      memories: {
        use_memories: true,
        generate_memories: false
      }
    });
    expect(buildCodexMemoryConfigOverrides({
      ...settings,
      generationEngine: "codex_native"
    })).toMatchObject({
      memories: {
        use_memories: true,
        generate_memories: true
      }
    });
  });
});
