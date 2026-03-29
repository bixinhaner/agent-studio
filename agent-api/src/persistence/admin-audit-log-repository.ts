export type AdminAuditLogRecord = {
  id: string;
  organizationId?: string;
  actorUserId?: string;
  actionType: string;
  targetType: string;
  targetId?: string;
  beforePayload?: unknown;
  afterPayload?: unknown;
  metadata?: unknown;
  createdAt: string;
};

export type CreateAdminAuditLogInput = {
  id?: string;
  organizationId?: string;
  actorUserId?: string;
  actionType: string;
  targetType: string;
  targetId?: string;
  beforePayload?: unknown;
  afterPayload?: unknown;
  metadata?: unknown;
};

type AdminAuditLogRow = {
  id: string;
  organizationId: string | null;
  actorUserId: string | null;
  actionType: string;
  targetType: string;
  targetId: string | null;
  beforePayload: unknown;
  afterPayload: unknown;
  metadata: unknown;
  createdAt: Date | string;
};

type AdminAuditLogTable = {
  findMany(args?: {
    where?: { targetType?: string; targetId?: string | null; actorUserId?: string };
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<AdminAuditLogRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AdminAuditLogRow>;
};

export type AdminAuditLogRepositoryDb = {
  adminAuditLog: AdminAuditLogTable;
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

function mapAuditLog(row: AdminAuditLogRow): AdminAuditLogRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    actorUserId: trimOrUndefined(row.actorUserId),
    actionType: row.actionType,
    targetType: row.targetType,
    targetId: trimOrUndefined(row.targetId),
    beforePayload: row.beforePayload ?? undefined,
    afterPayload: row.afterPayload ?? undefined,
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class AdminAuditLogRepository {
  constructor(private readonly db: AdminAuditLogRepositoryDb) {}

  async create(input: CreateAdminAuditLogInput): Promise<AdminAuditLogRecord> {
    const actionType = trimOrUndefined(input.actionType);
    const targetType = trimOrUndefined(input.targetType);
    if (!actionType || !targetType) {
      throw new Error("audit actionType and targetType are required");
    }
    const created = await this.db.adminAuditLog.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        actorUserId: trimOrUndefined(input.actorUserId) ?? null,
        actionType,
        targetType,
        targetId: trimOrUndefined(input.targetId) ?? null,
        beforePayload: input.beforePayload ?? null,
        afterPayload: input.afterPayload ?? null,
        metadata: input.metadata ?? null
      }
    });
    return mapAuditLog(created);
  }

  async listForTarget(targetType: string, targetId?: string): Promise<AdminAuditLogRecord[]> {
    return this.listByTarget({ targetType, targetId });
  }

  async list(input?: {
    targetType?: string;
    targetId?: string;
    actorUserId?: string;
    take?: number;
  }): Promise<AdminAuditLogRecord[]> {
    const where: { targetType?: string; targetId?: string | null; actorUserId?: string } = {};
    const targetType = trimOrUndefined(input?.targetType);
    if (targetType) {
      where.targetType = targetType;
      where.targetId = trimOrUndefined(input?.targetId) ?? null;
    }
    const actorUserId = trimOrUndefined(input?.actorUserId);
    if (actorUserId) {
      where.actorUserId = actorUserId;
    }
    const rows = await this.db.adminAuditLog.findMany({
      where: Object.keys(where).length > 0 ? where : undefined,
      orderBy: { createdAt: "desc" },
      take: input?.take
    });
    return rows.map(mapAuditLog);
  }

  async listByTarget(input: { targetType: string; targetId?: string }): Promise<AdminAuditLogRecord[]> {
    const normalizedTargetType = trimOrUndefined(input.targetType);
    if (!normalizedTargetType) return [];
    const rows = await this.db.adminAuditLog.findMany({
      where: { targetType: normalizedTargetType, targetId: trimOrUndefined(input.targetId) ?? null },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapAuditLog);
  }
}
