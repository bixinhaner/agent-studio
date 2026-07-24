import { describe, expect, it } from "vitest";

import {
  assertCodexThreadContinuity,
  resolveCodexThreadContinuity,
  resolveCodexThreadContinuityWithHistory
} from "./codex-thread-continuity.js";

describe("resolveCodexThreadContinuity", () => {
  it("prefers the durable business thread binding", () => {
    expect(resolveCodexThreadContinuity({
      threadCodexThreadId: "thread-canonical",
      activeSessionCodexThreadId: "thread-active",
      historicalSessionCodexThreadId: "thread-history"
    })).toBe("thread-canonical");
  });

  it("preserves the active session binding before a stale session is removed", () => {
    expect(resolveCodexThreadContinuity({
      activeSessionCodexThreadId: "thread-active",
      historicalSessionCodexThreadId: "thread-history"
    })).toBe("thread-active");
  });

  it("uses session history only when no durable or active binding exists", () => {
    expect(resolveCodexThreadContinuity({
      historicalSessionCodexThreadId: "thread-history"
    })).toBe("thread-history");
  });

  it("captures the active binding without querying history before session cleanup", async () => {
    let historyLoads = 0;
    await expect(resolveCodexThreadContinuityWithHistory({
      activeSessionCodexThreadId: "thread-active",
      loadHistoricalSessionCodexThreadId: async () => {
        historyLoads += 1;
        return "thread-history";
      }
    })).resolves.toBe("thread-active");
    expect(historyLoads).toBe(0);
  });

  it("loads persisted history when both the business thread and active session lack a binding", async () => {
    await expect(resolveCodexThreadContinuityWithHistory({
      loadHistoricalSessionCodexThreadId: async () => "thread-history"
    })).resolves.toBe("thread-history");
  });
});

describe("assertCodexThreadContinuity", () => {
  it("accepts the same resumed Codex thread", () => {
    expect(() => assertCodexThreadContinuity({
      expectedCodexThreadId: "thread-1",
      observedCodexThreadId: "thread-1",
      scope: "Agent thread"
    })).not.toThrow();
  });

  it("rejects an unexpected Codex thread replacement", () => {
    expect(() => assertCodexThreadContinuity({
      expectedCodexThreadId: "thread-1",
      observedCodexThreadId: "thread-2",
      scope: "Agent thread"
    })).toThrow("Agent thread is already bound to a different Codex thread");
  });
});
