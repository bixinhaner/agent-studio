import { describe, expect, it, vi } from "vitest";

import {
  PortalSteerEventRepository,
  type PortalSteerEventRepositoryDb
} from "./portal-steer-event-repository.js";

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "steer-1",
    threadId: "thread-1",
    organizationId: "org-1",
    userId: "user-1",
    sessionId: "session-1",
    sourceUserMessageId: "message-1",
    turnId: null,
    message: "focus on deployment cost",
    status: "pending",
    errorCode: null,
    resolvedAt: null,
    createdAt: "2026-08-09T08:00:00.000Z",
    updatedAt: "2026-08-09T08:00:00.000Z",
    ...overrides
  };
}

describe("PortalSteerEventRepository", () => {
  it("creates and lists pending steer events in timeline order", async () => {
    const db: PortalSteerEventRepositoryDb = {
      portalSteerEvent: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => [row()]),
        create: vi.fn(async ({ data }) => row(data)),
        update: vi.fn()
      }
    };
    const repository = new PortalSteerEventRepository(db);
    const created = await repository.begin({
      id: "steer-1",
      threadId: "thread-1",
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      sourceUserMessageId: "message-1",
      message: "focus on deployment cost"
    });
    expect(created.event.status).toBe("pending");
    expect(created.alreadyAccepted).toBe(false);
    expect((await repository.listForThread("thread-1"))[0]?.message).toBe("focus on deployment cost");
    expect(db.portalSteerEvent.findMany).toHaveBeenCalledWith({
      where: { threadId: "thread-1" },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
  });

  it("returns accepted duplicate events without steering twice", async () => {
    const db: PortalSteerEventRepositoryDb = {
      portalSteerEvent: {
        findUnique: vi.fn(async () => row({ status: "accepted", turnId: "turn-1" })),
        findMany: vi.fn(),
        create: vi.fn(),
        update: vi.fn()
      }
    };
    const result = await new PortalSteerEventRepository(db).begin({
      id: "steer-1",
      threadId: "thread-1",
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      message: "focus on deployment cost"
    });
    expect(result.alreadyAccepted).toBe(true);
    expect(result.event.turnId).toBe("turn-1");
    expect(db.portalSteerEvent.update).not.toHaveBeenCalled();
  });

  it("resets a failed event before retry and resolves accepted or failed states", async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce(row({ status: "pending", errorCode: null, resolvedAt: null }))
      .mockResolvedValueOnce(row({ status: "accepted", turnId: "turn-2", resolvedAt: "2026-08-09T08:01:00.000Z" }))
      .mockResolvedValueOnce(row({ status: "failed", errorCode: "steer_failed", resolvedAt: "2026-08-09T08:02:00.000Z" }));
    const db: PortalSteerEventRepositoryDb = {
      portalSteerEvent: {
        findUnique: vi.fn(async () => row({ status: "failed", errorCode: "steer_failed" })),
        findMany: vi.fn(),
        create: vi.fn(),
        update
      }
    };
    const repository = new PortalSteerEventRepository(db);
    expect((await repository.begin({
      id: "steer-1",
      threadId: "thread-1",
      organizationId: "org-1",
      userId: "user-1",
      sessionId: "session-1",
      message: "focus on deployment cost"
    })).event.status).toBe("pending");
    expect((await repository.markAccepted("steer-1", "turn-2")).status).toBe("accepted");
    expect((await repository.markFailed("steer-1")).status).toBe("failed");
  });
});
