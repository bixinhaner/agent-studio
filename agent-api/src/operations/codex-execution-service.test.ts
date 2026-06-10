import { describe, expect, it, vi } from "vitest";

import { CodexExecutionService } from "./codex-execution-service.js";

describe("CodexExecutionService", () => {
  it("delegates runtime stream completion through one execution entrypoint", async () => {
    const service = new CodexExecutionService();
    const events = (async function* () {
      yield {
        type: "message.delta",
        delta: "done"
      };
    })();
    const onDone = vi.fn();

    await service.streamCompletion({
      events,
      onEvent: vi.fn(),
      onDone
    });

    expect(onDone.mock.calls[0]?.[0]).toMatchObject({
      answer: "done"
    });
  });

  it("collects completion from a runtime thread without exposing event parsing to callers", async () => {
    const service = new CodexExecutionService();
    const runtime = {
      async *runStreamed(_thread: { id: string }, message: string) {
        yield {
          type: "message.delta",
          delta: message
        };
      }
    };

    await expect(service.collectFromRuntime({
      runtime,
      thread: { id: "thread-1" },
      prompt: "answer"
    })).resolves.toMatchObject({
      answer: "answer"
    });
  });
});
