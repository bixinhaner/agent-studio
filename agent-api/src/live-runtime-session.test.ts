import { describe, expect, it, vi } from "vitest";

import {
  extractRuntimeUsageFromStreamEvent,
  streamRuntimeCompletionWithBestEffortUsage,
  stripInternalRunConfigMetadata
} from "./live-runtime-session.js";

async function* events(items: Array<Record<string, unknown>>) {
  for (const item of items) {
    yield item;
  }
}

describe("streamRuntimeCompletionWithBestEffortUsage", () => {
  it("uses cumulative token-count telemetry so app-server multi-step turns are billed by snapshot diff", () => {
    expect(extractRuntimeUsageFromStreamEvent({
      type: "token_count",
      thread_id: "codex-thread-1",
      info: {
        total_token_usage: {
          input_tokens: 10_000,
          cached_input_tokens: 8000,
          output_tokens: 500
        },
        last_token_usage: {
          input_tokens: 1200,
          cached_input_tokens: 900,
          output_tokens: 80
        }
      }
    })).toEqual({
      inputTokens: 10_000,
      cachedInputTokens: 8000,
      outputTokens: 500,
      kind: "cumulative_snapshot",
      cumulativeInputTokens: undefined,
      cumulativeCachedInputTokens: undefined,
      cumulativeOutputTokens: undefined,
      codexThreadId: "codex-thread-1"
    });
  });

  it("falls back to last token usage when token-count cumulative telemetry is unavailable", () => {
    expect(extractRuntimeUsageFromStreamEvent({
      type: "token_count",
      thread_id: "codex-thread-1",
      info: {
        last_token_usage: {
          input_tokens: 1200,
          cached_input_tokens: 900,
          output_tokens: 80
        }
      }
    })).toEqual({
      inputTokens: 1200,
      cachedInputTokens: 900,
      outputTokens: 80,
      kind: "turn_delta",
      cumulativeInputTokens: undefined,
      cumulativeCachedInputTokens: undefined,
      cumulativeOutputTokens: undefined,
      codexThreadId: "codex-thread-1"
    });
  });

  it("falls back to cumulative turn completed usage", () => {
    expect(extractRuntimeUsageFromStreamEvent({
      type: "turn.completed",
      usage: {
        input_tokens: 10_000,
        cached_input_tokens: 8000,
        output_tokens: 500
      }
    })).toEqual({
      inputTokens: 10_000,
      cachedInputTokens: 8000,
      outputTokens: 500,
      kind: "cumulative_snapshot",
      cumulativeInputTokens: undefined,
      cumulativeCachedInputTokens: undefined,
      cumulativeOutputTokens: undefined,
      codexThreadId: undefined
    });
  });

  it("returns only the last completed agent message as the final answer", async () => {
    const onDone = vi.fn();

    await streamRuntimeCompletionWithBestEffortUsage({
      events: events([
        {
          type: "item.updated",
          delta: "我先查一下资料。",
          text: "我先查一下资料。",
          raw: {
            type: "item.updated",
            item: {
              type: "agent_message",
              text: "我先查一下资料。"
            }
          }
        },
        {
          type: "item.completed",
          text: "我先查一下资料。",
          raw: {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "我先查一下资料。"
            }
          }
        },
        {
          type: "item.completed",
          text: "西安婚假是 **15 天**。",
          raw: {
            type: "item.completed",
            item: {
              type: "agent_message",
              text: "西安婚假是 **15 天**。"
            }
          }
        }
      ]),
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone).toHaveBeenCalledWith({
      answer: "西安婚假是 **15 天**。",
      usage: undefined
    });
  });

  it("uses turn.completed last_agent_message when item.completed is missing", async () => {
    const onDone = vi.fn();

    await streamRuntimeCompletionWithBestEffortUsage({
      events: events([
        {
          type: "item.agent_message.delta",
          delta: "流式片段不完整"
        },
        {
          type: "turn.completed",
          raw: {
            type: "turn.completed",
            turn_id: "turn-1",
            last_agent_message: "这是 app-server 完成事件里的最终答案。"
          }
        }
      ]),
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone).toHaveBeenCalledWith({
      answer: "这是 app-server 完成事件里的最终答案。",
      usage: undefined
    });
  });

  it("keeps the legacy delta fallback when completed agent messages are unavailable", async () => {
    const onDone = vi.fn();

    await streamRuntimeCompletionWithBestEffortUsage({
      events: events([
        { type: "message.delta", delta: "第一段" },
        { type: "message.delta", delta: "第二段" }
      ]),
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone).toHaveBeenCalledWith({
      answer: "第一段第二段",
      usage: undefined
    });
  });

  it("records captured usage as failed when the stream errors before completion", async () => {
    const recordUsage = vi.fn();
    async function* failingEvents() {
      yield {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 600,
            output_tokens: 40
          },
          last_token_usage: {
            input_tokens: 1000,
            cached_input_tokens: 600,
            output_tokens: 40
          }
        }
      };
      throw new Error("runtime failed");
    }

    await expect(streamRuntimeCompletionWithBestEffortUsage({
      events: failingEvents(),
      onEvent: vi.fn(),
      onDone: vi.fn(),
      recordUsage
    })).rejects.toThrow("runtime failed");

    expect(recordUsage).toHaveBeenCalledWith(expect.objectContaining({
      inputTokens: 1000,
      cachedInputTokens: 600,
      outputTokens: 40,
      kind: "cumulative_snapshot"
    }), "failed");
  });
});

describe("stripInternalRunConfigMetadata", () => {
  it("removes runtime capability metadata before starting Codex", () => {
    expect(stripInternalRunConfigMetadata({
      mode: "default",
      _agentStudioRuntimeCapabilities: {
        crestCrm: {
          enabled: true,
          proxyTokenExpiresAt: "2026-06-06T16:00:00.000Z"
        }
      },
      _agentStudioRuntimeHints: ["use shared python runtime"]
    })).toEqual({
      mode: "default"
    });
  });
});
