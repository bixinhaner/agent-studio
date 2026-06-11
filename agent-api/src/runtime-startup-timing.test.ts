import { describe, expect, it, vi } from "vitest";

import {
  createRuntimeStartupTimer,
  resolveRuntimeStartupTimingOptions,
  type RuntimeStartupTimingOptions
} from "./runtime-startup-timing.js";

function timingOptions(
  overrides: Partial<RuntimeStartupTimingOptions> = {}
): RuntimeStartupTimingOptions {
  return {
    successEnabled: true,
    slowMs: 1000,
    sampleRate: 0,
    logErrors: true,
    random: () => 0.5,
    ...overrides
  };
}

describe("RuntimeStartupTimer", () => {
  it("logs structured timing for slow startup without unbounded metadata", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const timer = createRuntimeStartupTimer({
        traceId: "trace-1",
        source: "portal",
        operation: "chat_stream",
        route: "/api/chat/stream"
      }, timingOptions({ slowMs: 0 }));
      timer.mark("request_received", { prompt: "x".repeat(300) });
      await timer.time("async_step", async () => "ok", { values: Array.from({ length: 20 }, (_, index) => index) });
      timer.updateContext({ threadId: "thread-1", sessionId: "session-1", model: "gpt-5.5" });
      timer.finish("success", { done: true });

      expect(info).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(payload.event).toBe("agent_studio_runtime_startup_timing");
      expect(payload.trace_id).toBe("trace-1");
      expect(payload.thread_id).toBe("thread-1");
      expect(payload.log_reason).toBe("slow_startup");
      expect(payload.steps).toHaveLength(2);
      expect(payload.steps[0].metadata.prompt).toHaveLength(243);
      expect(payload.steps[1].metadata.values).toHaveLength(12);
    } finally {
      info.mockRestore();
    }
  });

  it("does not log fast successful requests by default", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const timer = createRuntimeStartupTimer({
        traceId: "trace-fast",
        source: "portal",
        operation: "ensure_thread_session"
      }, timingOptions({ slowMs: 1000 }));
      timer.mark("request_received");
      timer.finish("success");

      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it("uses first codex event time instead of full stream duration for chat startup", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const timer = createRuntimeStartupTimer({
        traceId: "trace-stream",
        source: "portal",
        operation: "chat_stream"
      }, timingOptions({ slowMs: 10 }));
      timer.mark("chat_stream.first_codex_event");
      await new Promise((resolve) => setTimeout(resolve, 20));
      timer.finish("success");

      expect(info).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it("logs errors even when successful timing logs are disabled", () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    try {
      const timer = createRuntimeStartupTimer({
        traceId: "trace-error",
        source: "portal",
        operation: "create_thread"
      }, timingOptions({ successEnabled: false, logErrors: true }));
      timer.finish("error", { reason: "test" });

      expect(info).toHaveBeenCalledTimes(1);
      const payload = JSON.parse(String(info.mock.calls[0]?.[0]));
      expect(payload.status).toBe("error");
      expect(payload.log_reason).toBe("error");
    } finally {
      info.mockRestore();
    }
  });

  it("parses timing options from environment", () => {
    const options = resolveRuntimeStartupTimingOptions({
      RUNTIME_STARTUP_TIMING_ENABLED: "false",
      RUNTIME_STARTUP_TIMING_SLOW_MS: "2500",
      RUNTIME_STARTUP_TIMING_SAMPLE_RATE: "0.25",
      RUNTIME_STARTUP_TIMING_LOG_ERRORS: "false"
    });

    expect(options.successEnabled).toBe(false);
    expect(options.slowMs).toBe(2500);
    expect(options.sampleRate).toBe(0.25);
    expect(options.logErrors).toBe(false);
  });
});
