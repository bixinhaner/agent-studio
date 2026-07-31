import { describe, expect, it, vi } from "vitest";

import { ThreadReadStateRepository, type ThreadReadStateRepositoryDb } from "./thread-read-state-repository.js";

describe("ThreadReadStateRepository", () => {
  it("lists only the requested user's thread states", async () => {
    const db: ThreadReadStateRepositoryDb = {
      threadReadState: {
        findMany: vi.fn(async () => [
          {
            threadId: "thread-1",
            userId: "user-1",
            lastReadAt: "2026-07-31T08:00:00.000Z"
          }
        ]),
        upsert: vi.fn()
      }
    };
    const result = await new ThreadReadStateRepository(db).listForUserThreadIds("user-1", ["thread-1"]);
    expect(result.get("thread-1")?.lastReadAt).toBe("2026-07-31T08:00:00.000Z");
    expect(db.threadReadState.findMany).toHaveBeenCalledWith({
      where: { userId: "user-1", threadId: { in: ["thread-1"] } }
    });
  });

  it("upserts the latest read timestamp", async () => {
    const db: ThreadReadStateRepositoryDb = {
      threadReadState: {
        findMany: vi.fn(),
        upsert: vi.fn(async () => ({
          threadId: "thread-1",
          userId: "user-1",
          lastReadAt: "2026-07-31T08:05:00.000Z"
        }))
      }
    };
    const result = await new ThreadReadStateRepository(db).markRead(
      "thread-1",
      "user-1",
      new Date("2026-07-31T08:05:00.000Z")
    );
    expect(result.lastReadAt).toBe("2026-07-31T08:05:00.000Z");
    expect(db.threadReadState.upsert).toHaveBeenCalledWith({
      where: { threadId_userId: { threadId: "thread-1", userId: "user-1" } },
      create: { threadId: "thread-1", userId: "user-1", lastReadAt: new Date("2026-07-31T08:05:00.000Z") },
      update: { lastReadAt: new Date("2026-07-31T08:05:00.000Z") }
    });
  });
});
