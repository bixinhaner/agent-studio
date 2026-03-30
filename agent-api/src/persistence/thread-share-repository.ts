export type ThreadShareSubjectType = "user" | "department";
export type ThreadSharePermissionLevel = "read_comment";

export type ThreadShareInput = {
  subjectType: ThreadShareSubjectType;
  subjectId: string;
  permissionLevel?: ThreadSharePermissionLevel;
  sharedByUserId?: string | null;
};

export type ThreadShareRecord = {
  id: string;
  threadId: string;
  subjectType: ThreadShareSubjectType;
  subjectId: string;
  permissionLevel: ThreadSharePermissionLevel;
  sharedByUserId?: string;
  revokedByUserId?: string;
  revokedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type ThreadShareRow = {
  id: string;
  threadId: string;
  subjectType: string;
  subjectId: string;
  permissionLevel: string;
  sharedByUserId: string | null;
  revokedByUserId: string | null;
  revokedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ThreadShareTable = {
  findMany(args?: {
    where?: {
      threadId?: string;
      revokedAt?: null;
      subjectType?: string;
      subjectId?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<ThreadShareRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadShareRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ThreadShareRow>;
};

export type ThreadShareRepositoryDb = {
  threadShare: ThreadShareTable;
  $transaction<T>(callback: (tx: ThreadShareRepositoryDb) => Promise<T>): Promise<T>;
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

function assertThreadShareSubjectType(value: string): ThreadShareSubjectType {
  if (value === "user" || value === "department") {
    return value;
  }
  throw new Error("thread share subjectType must be user or department");
}

function mapThreadShare(row: ThreadShareRow): ThreadShareRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    subjectType: assertThreadShareSubjectType(row.subjectType),
    subjectId: row.subjectId,
    permissionLevel: row.permissionLevel as ThreadSharePermissionLevel,
    sharedByUserId: trimOrUndefined(row.sharedByUserId),
    revokedByUserId: trimOrUndefined(row.revokedByUserId),
    revokedAt: toIsoString(row.revokedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function normalizePermissionLevel(value: string | undefined): ThreadSharePermissionLevel {
  return value === "read_comment" ? value : "read_comment";
}

function normalizeShares(shares: ThreadShareInput[]): ThreadShareInput[] {
  const seen = new Set<string>();
  const normalized: ThreadShareInput[] = [];
  for (const share of shares) {
    const subjectType = assertThreadShareSubjectType(share.subjectType);
    const subjectId = trimOrUndefined(share.subjectId);
    if (!subjectId) continue;
    const key = `${subjectType}:${subjectId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push({
      subjectType,
      subjectId,
      permissionLevel: normalizePermissionLevel(share.permissionLevel),
      sharedByUserId: trimOrUndefined(share.sharedByUserId)
    });
  }
  return normalized;
}

export class ThreadShareRepository {
  constructor(private readonly db: ThreadShareRepositoryDb) {}

  async replaceForThread(
    threadId: string,
    shares: ThreadShareInput[],
    revokedByUserId?: string | null
  ): Promise<ThreadShareRecord[]> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) {
      throw new Error("threadId is required");
    }
    const normalizedRevokedByUserId = trimOrUndefined(revokedByUserId);
    const normalizedShares = normalizeShares(shares);

    return this.db.$transaction(async (tx) => {
      const existingShares = await tx.threadShare.findMany({
        where: { threadId: normalizedThreadId, revokedAt: null },
        orderBy: { createdAt: "asc" }
      });
      const now = new Date();
      for (const row of existingShares) {
        await tx.threadShare.update({
          where: { id: row.id },
          data: {
            revokedAt: now,
            revokedByUserId: normalizedRevokedByUserId ?? null,
            updatedAt: now
          }
        });
      }

      const created: ThreadShareRow[] = [];
      for (const share of normalizedShares) {
        created.push(
          await tx.threadShare.create({
            data: {
              threadId: normalizedThreadId,
              subjectType: share.subjectType,
              subjectId: share.subjectId,
              permissionLevel: normalizePermissionLevel(share.permissionLevel),
              sharedByUserId: trimOrUndefined(share.sharedByUserId) ?? null,
              revokedByUserId: null,
              revokedAt: null,
              createdAt: now,
              updatedAt: now
            }
          })
        );
      }
      return created.map(mapThreadShare);
    });
  }

  async listForThread(threadId: string): Promise<ThreadShareRecord[]> {
    const normalizedThreadId = trimOrUndefined(threadId);
    if (!normalizedThreadId) return [];
    const rows = await this.db.threadShare.findMany({
      where: { threadId: normalizedThreadId, revokedAt: null },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapThreadShare);
  }

  async listEffectiveForUser(input: {
    threadId: string;
    userId: string;
    departmentIds: string[];
  }): Promise<ThreadShareRecord[]> {
    const threadId = trimOrUndefined(input.threadId);
    const userId = trimOrUndefined(input.userId);
    if (!threadId || !userId) return [];
    const departmentIds = new Set(
      input.departmentIds.map((departmentId) => trimOrUndefined(departmentId)).filter(Boolean) as string[]
    );

    const rows = await this.db.threadShare.findMany({
      where: { threadId, revokedAt: null },
      orderBy: { createdAt: "asc" }
    });
    return rows
      .filter((row) => {
        const subjectType = assertThreadShareSubjectType(row.subjectType);
        if (subjectType === "user") {
          return row.subjectId === userId;
        }
        return departmentIds.has(row.subjectId);
      })
      .map(mapThreadShare);
  }
}
