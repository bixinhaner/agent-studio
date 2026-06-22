import { describe, expect, it } from "vitest";

import {
  createLocalAuthProviderSnapshot,
  type ManagedCodexProviderSnapshot
} from "../managed-codex-provider.js";
import { SessionRepository, type SessionRepositoryDb } from "./session-repository.js";

type RuntimeSessionRow = {
  id: string;
  organizationId: string | null;
  threadId: string | null;
  userId: string | null;
  status: "active" | "ended" | "failed";
  externalId: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};

function memoryEnabledSnapshot(): ManagedCodexProviderSnapshot {
  const snapshot = createLocalAuthProviderSnapshot();
  return {
    ...snapshot,
    runtimeOptions: {
      config: {
        features: {
          memories: true
        },
        memories: {
          use_memories: true,
          generate_memories: false
        }
      }
    }
  };
}

function createMemoryDb() {
  const rows = new Map<string, RuntimeSessionRow>();
  const db: SessionRepositoryDb = {
    runtimeSession: {
      async count() {
        return rows.size;
      },
      async findUnique(args) {
        return rows.get(args.where.externalId) ?? null;
      },
      async findFirst(args) {
        const items = [...rows.values()].filter((row) => {
          if (args.where?.threadId && row.threadId !== args.where.threadId) return false;
          if (args.where?.status && row.status !== args.where.status) return false;
          return true;
        });
        items.sort((left, right) => {
          const direction = args.orderBy?.updatedAt === "asc" ? 1 : -1;
          return direction * (left.updatedAt.getTime() - right.updatedAt.getTime());
        });
        return items[0] ?? null;
      },
      async findMany() {
        return [...rows.values()];
      },
      async create(args) {
        const externalId = String(args.data.externalId);
        const now = new Date();
        const row: RuntimeSessionRow = {
          id: "row-1",
          organizationId: typeof args.data.organizationId === "string" ? args.data.organizationId : null,
          threadId: typeof args.data.threadId === "string" ? args.data.threadId : null,
          userId: typeof args.data.userId === "string" ? args.data.userId : null,
          status: args.data.status === "failed" || args.data.status === "ended" ? args.data.status : "active",
          externalId,
          metadata: args.data.metadata,
          createdAt: now,
          updatedAt: now
        };
        rows.set(externalId, row);
        return row;
      },
      async update(args) {
        const existing = rows.get(args.where.externalId);
        if (!existing) throw new Error("missing row");
        const updated: RuntimeSessionRow = {
          ...existing,
          status: args.data.status === "failed" || args.data.status === "ended" ? args.data.status : existing.status,
          metadata: args.data.metadata ?? existing.metadata,
          updatedAt: new Date()
        };
        rows.set(args.where.externalId, updated);
        return updated;
      },
      async deleteMany() {
        rows.clear();
        return { count: 0 };
      }
    }
  };
  return { db, rows };
}

describe("SessionRepository", () => {
  it("preserves provider runtime memory config when only codexThreadId changes", async () => {
    const { db, rows } = createMemoryDb();
    const repository = new SessionRepository(db, null);

    const created = await repository.create({
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace",
      providerSnapshot: memoryEnabledSnapshot()
    });

    await repository.update(created.sessionId, {
      codexThreadId: "codex-thread-1"
    });

    const stored = rows.get(created.sessionId);
    expect(stored?.metadata).toMatchObject({
      providerSnapshot: {
        runtimeOptions: {
          config: {
            features: {
              memories: true
            },
            memories: {
              use_memories: true,
              generate_memories: false
            }
          }
        }
      }
    });
  });

  it("hides retired sessions from active lookups", async () => {
    const { db } = createMemoryDb();
    const repository = new SessionRepository(db, null);

    const created = await repository.create({
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace"
    });

    await repository.retire(created.sessionId, "ended");

    await expect(repository.peek(created.sessionId)).resolves.toBeUndefined();
    await expect(repository.get(created.sessionId)).resolves.toBeUndefined();
  });

  it("can still resolve the latest retired session for thread-level codex resume", async () => {
    const { db } = createMemoryDb();
    const repository = new SessionRepository(db, null);

    const created = await repository.create({
      organizationId: "org-1",
      userId: "user-1",
      threadId: "thread-1",
      model: "gpt-5.5",
      reasoningEffort: "high",
      workspace: "/tmp/workspace",
      codexThreadId: "codex-thread-1"
    });

    await repository.retire(created.sessionId, "ended");

    await expect(repository.latestForThread("thread-1")).resolves.toMatchObject({
      sessionId: created.sessionId,
      codexThreadId: "codex-thread-1"
    });
  });
});
