export type ThreadAssignmentInput = {
  threadId: string;
  ownerUserId: string;
  assignedByUserId?: string | null;
};

export type ThreadAssignmentRecord = {
  id: string;
  threadId: string;
  ownerUserId: string;
  assignedByUserId?: string;
  assignedAt: string;
  updatedAt: string;
};

export type ThreadFollowerRecord = {
  id: string;
  threadId: string;
  userId: string;
  addedByUserId?: string;
  createdAt: string;
};

export type ThreadCaptureMarkInput = {
  threadId: string;
  status?: string;
  markedByUserId?: string | null;
  note?: string | null;
};

export type ThreadCaptureMarkRecord = {
  id: string;
  threadId: string;
  status: string;
  markedByUserId?: string;
  markedAt: string;
  note?: string;
  updatedAt: string;
};

type ThreadAssignmentRow = {
  id: string;
  threadId: string;
  ownerUserId: string;
  assignedByUserId: string | null;
  assignedAt: Date | string;
  updatedAt: Date | string;
};

type ThreadFollowerRow = {
  id: string;
  threadId: string;
  userId: string;
  addedByUserId: string | null;
  createdAt: Date | string;
};

type KnowledgeCaptureMarkRow = {
  id: string;
  threadId: string;
  status: string;
  markedByUserId: string | null;
  markedAt: Date | string;
  note: string | null;
  updatedAt: Date | string;
};

type ThreadAssignmentTable = {
  findUnique(args: { where: { threadId: string } }): Promise<ThreadAssignmentRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadAssignmentRow>;
  update(args: { where: { threadId: string }; data: Record<string, unknown> }): Promise<ThreadAssignmentRow>;
};

type ThreadFollowerTable = {
  findMany(args: {
    where: { threadId: string };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ThreadFollowerRow[]>;
  deleteMany(args: { where: { threadId: string } }): Promise<{ count: number }>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadFollowerRow>;
};

type KnowledgeCaptureMarkTable = {
  findUnique(args: { where: { threadId: string } }): Promise<KnowledgeCaptureMarkRow | null>;
  create(args: { data: Record<string, unknown> }): Promise<KnowledgeCaptureMarkRow>;
  update(args: { where: { threadId: string }; data: Record<string, unknown> }): Promise<KnowledgeCaptureMarkRow>;
  delete(args: { where: { threadId: string } }): Promise<KnowledgeCaptureMarkRow>;
};

export type ThreadCollaborationRepositoryDb = {
  threadAssignment: ThreadAssignmentTable;
  threadFollower: ThreadFollowerTable;
  knowledgeCaptureMark: KnowledgeCaptureMarkTable;
  $transaction<T>(callback: (tx: ThreadCollaborationRepositoryDb) => Promise<T>): Promise<T>;
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

function normalizeUnique(values: string[]): string[] {
  const seen = new Set<string>();
  const unique: string[] = [];
  for (const value of values) {
    const trimmed = trimOrUndefined(value);
    if (!trimmed || seen.has(trimmed)) continue;
    seen.add(trimmed);
    unique.push(trimmed);
  }
  return unique;
}

function mapAssignment(row: ThreadAssignmentRow): ThreadAssignmentRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    ownerUserId: row.ownerUserId,
    assignedByUserId: trimOrUndefined(row.assignedByUserId),
    assignedAt: toIsoString(row.assignedAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapFollower(row: ThreadFollowerRow): ThreadFollowerRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    userId: row.userId,
    addedByUserId: trimOrUndefined(row.addedByUserId),
    createdAt: toIsoString(row.createdAt)
  };
}

function mapCaptureMark(row: KnowledgeCaptureMarkRow): ThreadCaptureMarkRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    status: row.status,
    markedByUserId: trimOrUndefined(row.markedByUserId),
    markedAt: toIsoString(row.markedAt),
    note: trimOrUndefined(row.note),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class ThreadCollaborationRepository {
  constructor(private readonly db: ThreadCollaborationRepositoryDb) {}

  async setAssignment(input: ThreadAssignmentInput): Promise<ThreadAssignmentRecord> {
    const threadId = trimOrUndefined(input.threadId);
    const ownerUserId = trimOrUndefined(input.ownerUserId);
    if (!threadId || !ownerUserId) {
      throw new Error("threadId and ownerUserId are required");
    }
    const assignedByUserId = trimOrUndefined(input.assignedByUserId);
    const now = new Date();

    const existing = await this.db.threadAssignment.findUnique({ where: { threadId } });
    if (existing) {
      const updated = await this.db.threadAssignment.update({
        where: { threadId },
        data: {
          ownerUserId,
          assignedByUserId: assignedByUserId ?? null,
          assignedAt: now,
          updatedAt: now
        }
      });
      return mapAssignment(updated);
    }

    const created = await this.db.threadAssignment.create({
      data: {
        threadId,
        ownerUserId,
        assignedByUserId: assignedByUserId ?? null,
        assignedAt: now,
        updatedAt: now
      }
    });
    return mapAssignment(created);
  }

  async replaceFollowers(threadId: string, followerIds: string[], addedByUserId: string): Promise<ThreadFollowerRecord[]> {
    const normalizedThreadId = trimOrUndefined(threadId);
    const normalizedAddedByUserId = trimOrUndefined(addedByUserId);
    if (!normalizedThreadId || !normalizedAddedByUserId) {
      throw new Error("threadId and addedByUserId are required");
    }
    const uniqueFollowerIds = normalizeUnique(followerIds);

    return this.db.$transaction(async (tx) => {
      await tx.threadFollower.deleteMany({ where: { threadId: normalizedThreadId } });
      const created: ThreadFollowerRow[] = [];
      for (const userId of uniqueFollowerIds) {
        created.push(
          await tx.threadFollower.create({
            data: {
              threadId: normalizedThreadId,
              userId,
              addedByUserId: normalizedAddedByUserId,
              createdAt: new Date()
            }
          })
        );
      }
      return created.map(mapFollower);
    });
  }

  async setCaptureMark(input: ThreadCaptureMarkInput | null, threadId?: string): Promise<ThreadCaptureMarkRecord | null> {
    if (!input) {
      const normalizedThreadId = trimOrUndefined(threadId);
      if (!normalizedThreadId) {
        return null;
      }
      return this.clearCaptureMark(normalizedThreadId);
    }

    const normalizedThreadId = trimOrUndefined(input.threadId);
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    const status = trimOrUndefined(input.status) ?? "pending_capture";
    const markedByUserId = trimOrUndefined(input.markedByUserId);
    const note = trimOrUndefined(input.note);
    const now = new Date();

    const existing = await this.db.knowledgeCaptureMark.findUnique({ where: { threadId: normalizedThreadId } });
    if (existing) {
      const updated = await this.db.knowledgeCaptureMark.update({
        where: { threadId: normalizedThreadId },
        data: {
          status,
          markedByUserId: markedByUserId ?? null,
          markedAt: now,
          note: note ?? null,
          updatedAt: now
        }
      });
      return mapCaptureMark(updated);
    }

    const created = await this.db.knowledgeCaptureMark.create({
      data: {
        threadId: normalizedThreadId,
        status,
        markedByUserId: markedByUserId ?? null,
        markedAt: now,
        note: note ?? null,
        updatedAt: now
      }
    });
    return mapCaptureMark(created);
  }

  async clearCaptureMark(threadId: string): Promise<ThreadCaptureMarkRecord | null> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) return null;
    const existing = await this.db.knowledgeCaptureMark.findUnique({ where: { threadId: normalizedThreadId } });
    if (!existing) return null;
    await this.db.knowledgeCaptureMark.delete({ where: { threadId: normalizedThreadId } });
    return null;
  }

  async getState(threadId: string): Promise<{
    assignment: ThreadAssignmentRecord | null;
    followers: ThreadFollowerRecord[];
    captureMark: ThreadCaptureMarkRecord | null;
  }> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) {
      return { assignment: null, followers: [], captureMark: null };
    }

    const [assignment, followers, captureMark] = await Promise.all([
      this.db.threadAssignment.findUnique({ where: { threadId: normalizedThreadId } }),
      this.db.threadFollower.findMany({ where: { threadId: normalizedThreadId }, orderBy: { createdAt: "asc" } }),
      this.db.knowledgeCaptureMark.findUnique({ where: { threadId: normalizedThreadId } })
    ]);

    return {
      assignment: assignment ? mapAssignment(assignment) : null,
      followers: followers.map(mapFollower),
      captureMark: captureMark ? mapCaptureMark(captureMark) : null
    };
  }
}
