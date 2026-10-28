import { describe, expect, it, vi } from "vitest";

import { classifyUpstreamTransientError, waitUnlessAborted } from "./upstream-transient-error.js";

describe("classifyUpstreamTransientError", () => {
  it("recognises the errors Codex reports after its own retries are used up", () => {
    // Exact messages from production chat logs (10-25 and 10-22).
    expect(classifyUpstreamTransientError(new Error("exceeded retry limit, last status: 429 Too Many Requests"))).toBe("rate_limited");
    expect(
      classifyUpstreamTransientError(
        new Error("Selected model is at capacity. Please try a different model. (codexErrorInfo=serverOverloaded)")
      )
    ).toBe("overloaded");
    expect(classifyUpstreamTransientError(new Error("exceeded retry limit, last status: 503 Service Unavailable"))).toBe("server_error");
    expect(
      classifyUpstreamTransientError(
        new Error(
          "stream disconnected before completion: An error occurred while processing your request. You can retry your request, or contact us through our help center at help.openai.com if the error persists. Please include the request ID a7640879-7ff8-4185-83a5-2876f429387d in your message. (codexErrorInfo=other)"
        )
      )
    ).toBe("server_error");
    expect(classifyUpstreamTransientError({ message: "wrapped", cause: new Error("last status: 429") })).toBe("rate_limited");
  });

  it("does not retry quota exhaustion or ordinary failures", () => {
    expect(classifyUpstreamTransientError(new Error("You've hit your usage limit. Try again later. 429"))).toBeUndefined();
    expect(classifyUpstreamTransientError(new Error("usageLimitExceeded"))).toBeUndefined();
    expect(classifyUpstreamTransientError(new Error("Codex app-server turn aborted by client"))).toBeUndefined();
    expect(classifyUpstreamTransientError(new Error("任务已达到运行环境内存上限，请缩小处理范围后重试。"))).toBeUndefined();
    expect(classifyUpstreamTransientError(new Error("scopeKey: 'ac91dba3717d4dcce75915f31edf42985e0bf9b977da2fd5557688b04f393241'"))).toBeUndefined();
    expect(classifyUpstreamTransientError(undefined)).toBeUndefined();
  });
});

describe("waitUnlessAborted", () => {
  it("waits for the delay, or stops early when a signal aborts", async () => {
    vi.useFakeTimers();
    try {
      const completed = waitUnlessAborted(10_000, [undefined]);
      await vi.advanceTimersByTimeAsync(10_000);
      await expect(completed).resolves.toBe(true);

      const controller = new AbortController();
      const stopped = waitUnlessAborted(30_000, [controller.signal]);
      controller.abort();
      await expect(stopped).resolves.toBe(false);

      await expect(waitUnlessAborted(10_000, [AbortSignal.abort()])).resolves.toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });
});
