export type ResourceAccessLogRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  resourceType: string;
  resourceId: string;
  actionType: string;
  resultStatus: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateResourceAccessLogInput = {
  id?: string;
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  resourceType: string;
  resourceId: string;
  actionType: string;
  resultStatus: string;
  metadata?: unknown;
  createdAt?: string | Date;
};

export type ListResourceAccessLogsInput = {
  userId?: string;
  resourceType?: string;
  resourceId?: string;
  actionType?: string;
  resultStatus?: string;
  sessionId?: string;
  threadId?: string;
  take?: number;
};

type ResourceAccessLogRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  departmentIdSnapshot: string | null;
  threadId: string | null;
  sessionId: string | null;
  resourceType: string;
  resourceId: string;
  actionType: string;
  resultStatus: string;
  metadata: unknown;
  createdAt: Date | string;
};

type ResourceAccessLogTable = {
  create(args: { data: Record<string, unknown> }): Promise<ResourceAccessLogRow>;
  findMany(args?: {
    where?: {
      userId?: string;
      resourceType?: string;
      resourceId?: string;
      actionType?: string;
      resultStatus?: string;
      sessionId?: string;
      threadId?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<ResourceAccessLogRow[]>;
};

export type ResourceAccessLogRepositoryDb = {
  resourceAccessLog: ResourceAccessLogTable;
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

function mapResourceAccessLog(row: ResourceAccessLogRow): ResourceAccessLogRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    userId: trimOrUndefined(row.userId),
    departmentIdSnapshot: trimOrUndefined(row.departmentIdSnapshot),
    threadId: trimOrUndefined(row.threadId),
    sessionId: trimOrUndefined(row.sessionId),
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    actionType: row.actionType,
    resultStatus: row.resultStatus,
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class ResourceAccessLogRepository {
  constructor(private readonly db: ResourceAccessLogRepositoryDb) {}

  async create(input: CreateResourceAccessLogInput): Promise<ResourceAccessLogRecord> {
    const resourceType = trimOrUndefined(input.resourceType);
    const resourceId = trimOrUndefined(input.resourceId);
    const actionType = trimOrUndefined(input.actionType);
    const resultStatus = trimOrUndefined(input.resultStatus);
    if (!resourceType || !resourceId || !actionType || !resultStatus) {
      throw new Error("resource access log resourceType, resourceId, actionType, and resultStatus are required");
    }

    const created = await this.db.resourceAccessLog.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        userId: trimOrUndefined(input.userId) ?? null,
        departmentIdSnapshot: trimOrUndefined(input.departmentIdSnapshot) ?? null,
        threadId: trimOrUndefined(input.threadId) ?? null,
        sessionId: trimOrUndefined(input.sessionId) ?? null,
        resourceType,
        resourceId,
        actionType,
        resultStatus,
        metadata: input.metadata ?? null,
        createdAt: input.createdAt instanceof Date ? input.createdAt : input.createdAt ? new Date(input.createdAt) : undefined
      }
    });

    return mapResourceAccessLog(created);
  }

  async list(input: ListResourceAccessLogsInput = {}): Promise<ResourceAccessLogRecord[]> {
    const rows = await this.db.resourceAccessLog.findMany({
      where: {
        userId: trimOrUndefined(input.userId),
        resourceType: trimOrUndefined(input.resourceType),
        resourceId: trimOrUndefined(input.resourceId),
        actionType: trimOrUndefined(input.actionType),
        resultStatus: trimOrUndefined(input.resultStatus),
        sessionId: trimOrUndefined(input.sessionId),
        threadId: trimOrUndefined(input.threadId)
      },
      orderBy: { createdAt: "desc" },
      take: input.take
    });
    return rows.map(mapResourceAccessLog);
  }
}
