import type { ThreadPublicShareSnapshot } from "../public-share/thread-public-share-snapshot.js";
import { normalizeThreadPublicShareSnapshot } from "../public-share/thread-public-share-snapshot.js";

export type ThreadPublicShareRecord = {
  id: string;
  threadId: string;
  token: string;
  title: string;
  selectedTurnCount: number;
  snapshot: ThreadPublicShareSnapshot;
  createdByUserId?: string;
  revokedByUserId?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

export type ThreadPublicShareCreateInput = {
  threadId: string;
  token: string;
  title: string;
  selectedTurnCount: number;
  snapshot: ThreadPublicShareSnapshot;
  createdByUserId: string;
};

type ThreadPublicShareRow = {
  id: string;
  threadId: string;
  token: string;
  title: string | null;
  selectedTurnCount: number | null;
  snapshotJson: unknown;
  createdByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ThreadPublicShareTable = {
  findMany(args?: {
    where?: {
      threadId?: string;
      revokedAt?: null;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ThreadPublicShareRow[]>;
  findFirst(args?: {
    where?: {
      threadId?: string;
      token?: string;
      revokedAt?: null;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ThreadPublicShareRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadPublicShareRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ThreadPublicShareRow>;
};

export type ThreadPublicShareRepositoryDb = {
  threadPublicShare: ThreadPublicShareTable;
  $transaction<T>(callback: (tx: ThreadPublicShareRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed.toISOString();
}

function mapThreadPublicShare(row: ThreadPublicShareRow): ThreadPublicShareRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    token: row.token,
    title: trimOrUndefined(row.title) || "Shared conversation",
    selectedTurnCount: Math.max(1, row.selectedTurnCount ?? 1),
    snapshot: normalizeThreadPublicShareSnapshot(row.snapshotJson),
    createdByUserId: trimOrUndefined(row.createdByUserId),
    revokedByUserId: trimOrUndefined(row.revokedByUserId),
    revokedAt: toIsoString(row.revokedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

export class ThreadPublicShareRepository {
  constructor(private readonly db: ThreadPublicShareRepositoryDb) {}

  async createOrReplaceActiveForThread(input: ThreadPublicShareCreateInput): Promise<ThreadPublicShareRecord> {
    const threadId = trimOrUndefined(input.threadId);
    const token = trimOrUndefined(input.token);
    const title = trimOrUndefined(input.title);
    const createdByUserId = trimOrUndefined(input.createdByUserId);
    if (!threadId) throw new Error("threadId is required");
    if (!token) throw new Error("token is required");
    if (!title) throw new Error("title is required");
    if (!createdByUserId) throw new Error("createdByUserId is required");

    return this.db.$transaction(async (tx) => {
      const activeShares = await tx.threadPublicShare.findMany({
        where: { threadId, revokedAt: null },
        orderBy: { createdAt: "asc" }
      });
      const now = new Date();

      for (const share of activeShares) {
        await tx.threadPublicShare.update({
          where: { id: share.id },
          data: {
            revokedAt: now,
            revokedByUserId: createdByUserId,
            updatedAt: now
          }
        });
      }

      const created = await tx.threadPublicShare.create({
        data: {
          threadId,
          token,
          title,
          selectedTurnCount: Math.max(1, input.selectedTurnCount),
          snapshotJson: input.snapshot,
          createdByUserId,
          revokedByUserId: null,
          revokedAt: null,
          createdAt: now,
          updatedAt: now
        }
      });

      return mapThreadPublicShare(created);
    });
  }

  async getActiveByToken(token: string): Promise<ThreadPublicShareRecord | undefined> {
    const normalizedToken = trimOrUndefined(token);
    if (!normalizedToken) return undefined;
    const row = await this.db.threadPublicShare.findFirst({
      where: {
        token: normalizedToken,
        revokedAt: null
      }
    });
    return row ? mapThreadPublicShare(row) : undefined;
  }
}
