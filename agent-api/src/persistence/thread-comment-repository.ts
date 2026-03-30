export type ThreadCommentInput = {
  threadId: string;
  authorUserId: string;
  bodyMarkdown: string;
  mentionedUserIds?: string[];
};

export type ThreadCommentRecord = {
  id: string;
  threadId: string;
  authorUserId?: string;
  bodyMarkdown: string;
  mentionedUserIds: string[];
  createdAt: string;
  updatedAt: string;
};

type ThreadCommentRow = {
  id: string;
  threadId: string;
  authorUserId: string | null;
  bodyMarkdown: string;
  mentionedUserIds: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ThreadCommentTable = {
  findMany(args: {
    where: { threadId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ThreadCommentRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadCommentRow>;
};

export type ThreadCommentRepositoryDb = {
  threadComment: ThreadCommentTable;
  $transaction<T>(callback: (tx: ThreadCommentRepositoryDb) => Promise<T>): Promise<T>;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString();
  return parsed.toISOString();
}

function normalizeMentions(mentionedUserIds: string[] | undefined): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const mentionedUserId of mentionedUserIds ?? []) {
    const value = trimOrUndefined(mentionedUserId);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    mentions.push(value);
  }
  return mentions;
}

function mapThreadComment(row: ThreadCommentRow): ThreadCommentRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    authorUserId: trimOrUndefined(row.authorUserId),
    bodyMarkdown: row.bodyMarkdown,
    mentionedUserIds: Array.isArray(row.mentionedUserIds)
      ? row.mentionedUserIds
          .map((value) => trimOrUndefined(typeof value === "string" ? value : undefined))
          .filter(Boolean) as string[]
      : [],
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class ThreadCommentRepository {
  constructor(private readonly db: ThreadCommentRepositoryDb) {}

  async create(input: ThreadCommentInput): Promise<ThreadCommentRecord> {
    const threadId = trimOrUndefined(input.threadId);
    const authorUserId = trimOrUndefined(input.authorUserId);
    const bodyMarkdown = typeof input.bodyMarkdown === "string" ? input.bodyMarkdown.trim() : "";
    if (!threadId || !authorUserId || !bodyMarkdown) {
      throw new Error("threadId, authorUserId, and bodyMarkdown are required");
    }

    const created = await this.db.threadComment.create({
      data: {
        threadId,
        authorUserId,
        bodyMarkdown,
        mentionedUserIds: normalizeMentions(input.mentionedUserIds),
        createdAt: new Date(),
        updatedAt: new Date()
      }
    });
    return mapThreadComment(created);
  }

  async listForThread(threadId: string): Promise<ThreadCommentRecord[]> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) return [];
    const rows = await this.db.threadComment.findMany({
      where: { threadId: normalizedThreadId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapThreadComment);
  }
}
