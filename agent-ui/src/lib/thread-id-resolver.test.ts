import { describe, expect, it, vi } from "vitest";

import { resolveRunThreadId } from "./thread-id-resolver";

describe("resolveRunThreadId", () => {
  it("uses the id of a new task the server has not created yet", async () => {
    const listThreads = vi.fn(async () => []);
    const threadId = await resolveRunThreadId({
      getActiveRemoteThreadId: () => "",
      getActiveLocalThreadId: () => "__LOCALID_1",
      listThreads,
      findPendingRemoteThreadId: (localId) => (localId === "__LOCALID_1" ? "a".repeat(32) : undefined),
      attempts: 2,
      waitMs: 0
    });
    expect(threadId).toBe("a".repeat(32));
    expect(listThreads).not.toHaveBeenCalled();
  });

  it("matches a saved task by its local id", async () => {
    const threadId = await resolveRunThreadId({
      getActiveRemoteThreadId: () => "",
      getActiveLocalThreadId: () => "__LOCALID_2",
      listThreads: async () => [{ id: "server-2", external_id: "__LOCALID_2" }],
      findPendingRemoteThreadId: () => undefined,
      attempts: 1,
      waitMs: 0
    });
    expect(threadId).toBe("server-2");
  });

  it("gives up when the task is neither pending nor saved", async () => {
    const threadId = await resolveRunThreadId({
      getActiveRemoteThreadId: () => "",
      getActiveLocalThreadId: () => "__LOCALID_3",
      listThreads: async () => [],
      attempts: 2,
      waitMs: 0
    });
    expect(threadId).toBeNull();
  });
});
