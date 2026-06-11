import { describe, expect, it, vi } from "vitest";

import { createRuntimeStartupTimer } from "./runtime-startup-timing.js";

describe("RuntimeStartupTimer", () => {
  it("logs structured timing without unbounded metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const timer = createRuntimeStartupTimer({
        traceId: "trace-1",
        source: "portal",
        operation: "chat_stream",
        route: "/api/chat/stream"
      });
      timer.mark("request_received", { prompt: "x".repeat(300) });
      await timer.time("async_step", async () => "ok", { values: Array.from({ length: 20 }, (_, index) => index) });
      timer.updateContext({ threadId: "thread-1", sessionId: "session-1", model: "gpt-5.5" });
      timer.finish("success", { done: true });

      expect(info).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(payload.event).toBe("agent_studio_runtime_startup_timing");
      expect(payload.trace_id).toBe("trace-1");
      expect(payload.thread_id).toBe("thread-1");
      expect(payload.steps).toHaveLength(2);
      expect(payload.steps[0].metadata.prompt).toHaveLength(243);
      expect(payload.steps[1].metadata.values).toHaveLength(12);
    } finally {
      info.mockRestore();
    }
  });
});
