import { describe, expect, it, vi } from "vitest";

import {
  createPortalServerThreadId,
  PendingServerThreads
} from "./pending-server-threads";

describe("pending server threads", () => {
  it("creates ids in the server's thread id format", () => {
    const id = createPortalServerThreadId();
    expect(id).toMatch(/^[a-f0-9]{32}$/);
    expect(createPortalServerThreadId()).not.toBe(id);
  });

  it("keeps a new task local until the server confirms it", () => {
    const pending = new PendingServerThreads();
    pending.add({ remoteId: "a".repeat(32), localId: "__LOCALID_1" });
    expect(pending.has("a".repeat(32))).toBe(true);
    expect(pending.setTitle("a".repeat(32), "Plan")).toBe(true);
    expect(pending.get("a".repeat(32))?.title).toBe("Plan");
    pending.confirm("a".repeat(32));
    expect(pending.has("a".repeat(32))).toBe(false);
    expect(pending.setTitle("a".repeat(32), "Other")).toBe(false);
  });

  it("finds a new task by its local id and keeps its workspace location", () => {
    const pending = new PendingServerThreads();
    pending.add({ remoteId: "c".repeat(32), localId: "__LOCALID_3" });
    expect(pending.findByLocalId("__LOCALID_3")?.remoteId).toBe("c".repeat(32));
    expect(pending.findByLocalId("__LOCALID_other")).toBeUndefined();
    expect(pending.setLocalRootId("c".repeat(32), "root-1")).toBe(true);
    expect(pending.get("c".repeat(32))?.localRootId).toBe("root-1");
    pending.confirm("c".repeat(32));
    expect(pending.findByLocalId("__LOCALID_3")).toBeUndefined();
    expect(pending.setLocalRootId("c".repeat(32), "root-2")).toBe(false);
  });

  it("creates a task once for concurrent uploads and confirms it", async () => {
    const pending = new PendingServerThreads();
    const creator = vi.fn(async () => undefined);
    pending.setCreator(creator);
    pending.add({ remoteId: "b".repeat(32), localId: "__LOCALID_2", folderId: "folder-1" });
    await Promise.all([pending.ensureCreated("b".repeat(32)), pending.ensureCreated("b".repeat(32))]);
    expect(creator).toHaveBeenCalledTimes(1);
    expect(creator).toHaveBeenCalledWith(expect.objectContaining({ folderId: "folder-1" }));
    expect(pending.has("b".repeat(32))).toBe(false);
    await pending.ensureCreated("b".repeat(32));
    expect(creator).toHaveBeenCalledTimes(1);
  });

  it("keeps the task pending when creation fails so a later send can create it", async () => {
    const pending = new PendingServerThreads();
    pending.setCreator(async () => {
      throw new Error("offline");
    });
    pending.add({ remoteId: "c".repeat(32), localId: "__LOCALID_3" });
    await expect(pending.ensureCreated("c".repeat(32))).rejects.toThrow("offline");
    expect(pending.has("c".repeat(32))).toBe(true);
  });
});
