import { describe, expect, it, vi } from "vitest";

import {
  isMissingCodexRolloutError,
  startWithMissingCodexRolloutRecovery
} from "./codex-thread-recovery.js";

describe("Portal Codex thread recovery", () => {
  it("starts a replacement and persists its binding when the rollout is missing", async () => {
    const start = vi.fn(async (threadId?: string) => {
      if (threadId) throw new Error(`no rollout found for thread id ${threadId}`);
      return { sessionId: "session-2", codexThreadId: "codex-thread-2" };
    });
    const persistRecoveredCodexThreadId = vi.fn(async () => undefined);
    const rollbackRecovered = vi.fn(async () => undefined);

    const result = await startWithMissingCodexRolloutRecovery({
      resumeCodexThreadId: "codex-thread-1",
      start,
      codexThreadId: (session) => session.codexThreadId,
      persistRecoveredCodexThreadId,
      rollbackRecovered
    });

    expect(result).toEqual({
      value: { sessionId: "session-2", codexThreadId: "codex-thread-2" },
      recovered: true,
      failedCodexThreadId: "codex-thread-1"
    });
    expect(start).toHaveBeenNthCalledWith(1, "codex-thread-1");
    expect(start).toHaveBeenNthCalledWith(2, undefined);
    expect(persistRecoveredCodexThreadId).toHaveBeenCalledWith("codex-thread-2");
    expect(rollbackRecovered).not.toHaveBeenCalled();
  });

  it("does not replace a thread for unrelated resume failures", async () => {
    const start = vi.fn(async () => {
      throw new Error("authentication failed");
    });

    await expect(startWithMissingCodexRolloutRecovery({
      resumeCodexThreadId: "codex-thread-1",
      start,
      codexThreadId: () => undefined,
      persistRecoveredCodexThreadId: async () => undefined,
      rollbackRecovered: async () => undefined
    })).rejects.toThrow("authentication failed");
    expect(start).toHaveBeenCalledTimes(1);
  });

  it("rolls back the replacement when its binding cannot be persisted", async () => {
    const replacement = { sessionId: "session-2", codexThreadId: "codex-thread-2" };
    const rollbackRecovered = vi.fn(async () => undefined);

    await expect(startWithMissingCodexRolloutRecovery({
      resumeCodexThreadId: "codex-thread-1",
      start: async (threadId) => {
        if (threadId) throw new Error(`thread/resume failed: no rollout found for thread id ${threadId}`);
        return replacement;
      },
      codexThreadId: (session) => session.codexThreadId,
      persistRecoveredCodexThreadId: async () => {
        throw new Error("database unavailable");
      },
      rollbackRecovered
    })).rejects.toThrow("database unavailable");
    expect(rollbackRecovered).toHaveBeenCalledWith(replacement);
  });

  it("recognizes both app-server missing rollout error forms", () => {
    expect(isMissingCodexRolloutError(new Error("no rollout found for thread id abc"))).toBe(true);
    expect(isMissingCodexRolloutError(new Error("thread/resume failed: rollout is missing"))).toBe(true);
    expect(isMissingCodexRolloutError(new Error("thread/resume failed: upstream unavailable"))).toBe(false);
    expect(isMissingCodexRolloutError(new Error("service unavailable"))).toBe(false);
  });
});
