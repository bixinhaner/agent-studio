import { describe, expect, it } from "vitest";

import {
  ThreadPublicShareRepository,
  type ThreadPublicShareRepositoryDb
} from "./thread-public-share-repository.js";

type ShareRow = {
  id: string;
  threadId: string;
  token: string;
  title: string;
  selectedTurnCount: number;
  snapshotJson: { version: 1; turns: [] };
  createdByUserId: string;
  revokedByUserId: string | null;
  revokedAt: Date | null;
  expiresAt: Date;
  createdAt: Date;
  updatedAt: Date;
};

function createRepository(rows: ShareRow[]) {
  const table = {
    async findMany(args?: { where?: { threadId?: string; revokedAt?: null } }) {
      return rows.filter(
        (row) =>
          (!args?.where?.threadId || row.threadId === args.where.threadId) &&
          (args?.where?.revokedAt !== null || row.revokedAt === null)
      );
    },
    async findFirst(args?: {
      where?: { threadId?: string; token?: string; revokedAt?: null; expiresAt?: { gt: Date } };
    }) {
      return (
        rows.find(
          (row) =>
            (!args?.where?.threadId || row.threadId === args.where.threadId) &&
            (!args?.where?.token || row.token === args.where.token) &&
            (args?.where?.revokedAt !== null || row.revokedAt === null) &&
            (!args?.where?.expiresAt || row.expiresAt > args.where.expiresAt.gt)
        ) ?? null
      );
    },
    async create(args: { data: Record<string, unknown> }) {
      const row = {
        id: `share-${rows.length + 1}`,
        ...(args.data as Omit<ShareRow, "id">)
      } satisfies ShareRow;
      rows.push(row);
      return row;
    },
    async update(args: { where: { id: string }; data: Record<string, unknown> }) {
      const row = rows.find((item) => item.id === args.where.id);
      if (!row) throw new Error("row not found");
      Object.assign(row, args.data);
      return row;
    }
  };
  const db = {
    threadPublicShare: table,
    async $transaction<T>(callback: (tx: ThreadPublicShareRepositoryDb) => Promise<T>) {
      return callback(db as unknown as ThreadPublicShareRepositoryDb);
    }
  };
  return new ThreadPublicShareRepository(db as unknown as ThreadPublicShareRepositoryDb);
}

function shareRow(input: Partial<ShareRow> = {}): ShareRow {
  const now = new Date();
  return {
    id: "share-1",
    threadId: "thread-1",
    token: "token-1",
    title: "Shared conversation",
    selectedTurnCount: 1,
    snapshotJson: { version: 1, turns: [] },
    createdByUserId: "employee-1",
    revokedByUserId: null,
    revokedAt: null,
    expiresAt: new Date(now.getTime() + 60_000),
    createdAt: now,
    updatedAt: now,
    ...input
  };
}

describe("ThreadPublicShareRepository", () => {
  it("does not return an expired link", async () => {
    const repository = createRepository([
      shareRow({ expiresAt: new Date(Date.now() - 1_000) })
    ]);

    await expect(repository.getActiveByToken("token-1")).resolves.toBeUndefined();
  });

  it("revokes the active link immediately", async () => {
    const rows = [shareRow()];
    const repository = createRepository(rows);

    await expect(
      repository.revokeActiveForThread({ threadId: "thread-1", revokedByUserId: "employee-2" })
    ).resolves.toBe(1);
    expect(rows[0]?.revokedByUserId).toBe("employee-2");
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
    await expect(repository.getActiveByToken("token-1")).resolves.toBeUndefined();
  });

  it("stores the configured expiry when replacing a link", async () => {
    const rows = [shareRow()];
    const repository = createRepository(rows);
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);

    const created = await repository.createOrReplaceActiveForThread({
      threadId: "thread-1",
      token: "token-2",
      title: "New link",
      selectedTurnCount: 2,
      snapshot: { version: 1, turns: [] },
      createdByUserId: "employee-1",
      expiresAt
    });

    expect(created.expiresAt).toBe(expiresAt.toISOString());
    expect(rows[0]?.revokedAt).toBeInstanceOf(Date);
  });
});
