export type ThreadReadStateRecord = {
  threadId: string;
  userId: string;
  lastReadAt: string;
};

type ThreadReadStateRow = {
  threadId: string;
  userId: string;
  lastReadAt: Date | string;
};

type ThreadReadStateTable = {
  findMany(args: {
    where: {
      userId: string;
      threadId?: { in: string[] };
    };
  }): Promise<ThreadReadStateRow[]>;
  upsert(args: {
    where: { threadId_userId: { threadId: string; userId: string } };
    create: { threadId: string; userId: string; lastReadAt: Date };
    update: { lastReadAt: Date };
  }): Promise<ThreadReadStateRow>;
};

export type ThreadReadStateRepositoryDb = {
  threadReadState: ThreadReadStateTable;
};

function normalized(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function toIsoString(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

export class ThreadReadStateRepository {
  constructor(private readonly db: ThreadReadStateRepositoryDb) {}

  async listForUserThreadIds(userId: string, threadIds: string[]): Promise<Map<string, ThreadReadStateRecord>> {
    const normalizedUserId = normalized(userId);
    const ids = Array.from(new Set(threadIds.map(normalized).filter(Boolean)));
    if (!normalizedUserId || ids.length === 0) return new Map();

    const rows = await this.db.threadReadState.findMany({
      where: {
        userId: normalizedUserId,
        threadId: { in: ids }
      }
    });
    return new Map(
      rows.map((row) => [
        row.threadId,
        {
          threadId: row.threadId,
          userId: row.userId,
          lastReadAt: toIsoString(row.lastReadAt)
        }
      ])
    );
  }

  async markRead(threadId: string, userId: string, at = new Date()): Promise<ThreadReadStateRecord> {
    const normalizedThreadId = normalized(threadId);
    const normalizedUserId = normalized(userId);
    if (!normalizedThreadId || !normalizedUserId) {
      throw new Error("threadId and userId are required");
    }

    const row = await this.db.threadReadState.upsert({
      where: {
        threadId_userId: {
          threadId: normalizedThreadId,
          userId: normalizedUserId
        }
      },
      create: {
        threadId: normalizedThreadId,
        userId: normalizedUserId,
        lastReadAt: at
      },
      update: {
        lastReadAt: at
      }
    });
    return {
      threadId: row.threadId,
      userId: row.userId,
      lastReadAt: toIsoString(row.lastReadAt)
    };
  }
}
