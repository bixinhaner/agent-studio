export type SubscriptionDenialLogRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  threadId?: string;
  sessionId?: string;
  principalType?: string;
  principalId?: string;
  reasonCode: string;
  title: string;
  detail?: string;
  model?: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateSubscriptionDenialLogInput = {
  organizationId?: string | null;
  userId?: string | null;
  threadId?: string | null;
  sessionId?: string | null;
  principalType?: string | null;
  principalId?: string | null;
  reasonCode: string;
  title: string;
  detail?: string | null;
  model?: string | null;
  metadata?: unknown;
};

type SubscriptionDenialLogRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  threadId: string | null;
  sessionId: string | null;
  principalType: string | null;
  principalId: string | null;
  reasonCode: string;
  title: string;
  detail: string | null;
  model: string | null;
  metadata: unknown;
  createdAt: Date | string;
};

type SubscriptionDenialLogTable = {
  create(args: {
    data: {
      organizationId: string | null;
      userId: string | null;
      threadId: string | null;
      sessionId: string | null;
      principalType: string | null;
      principalId: string | null;
      reasonCode: string;
      title: string;
      detail: string | null;
      model: string | null;
      metadata: unknown;
    };
  }): Promise<SubscriptionDenialLogRow>;
  findMany(args?: {
    orderBy?: { createdAt: "desc" };
    take?: number;
  }): Promise<SubscriptionDenialLogRow[]>;
};

export type SubscriptionDenialLogRepositoryDb = {
  subscriptionDenialLog: SubscriptionDenialLogTable;
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

function mapRecord(row: {
  id: string;
  organizationId: string | null;
  userId: string | null;
  threadId: string | null;
  sessionId: string | null;
  principalType: string | null;
  principalId: string | null;
  reasonCode: string;
  title: string;
  detail: string | null;
  model: string | null;
  metadata: unknown;
  createdAt: Date | string;
}): SubscriptionDenialLogRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    userId: trimOrUndefined(row.userId),
    threadId: trimOrUndefined(row.threadId),
    sessionId: trimOrUndefined(row.sessionId),
    principalType: trimOrUndefined(row.principalType),
    principalId: trimOrUndefined(row.principalId),
    reasonCode: row.reasonCode,
    title: row.title,
    detail: trimOrUndefined(row.detail),
    model: trimOrUndefined(row.model),
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class SubscriptionDenialLogRepository {
  constructor(private readonly db: SubscriptionDenialLogRepositoryDb) {}

  async create(input: CreateSubscriptionDenialLogInput): Promise<SubscriptionDenialLogRecord> {
    const row = await this.db.subscriptionDenialLog.create({
      data: {
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        userId: trimOrUndefined(input.userId) ?? null,
        threadId: trimOrUndefined(input.threadId) ?? null,
        sessionId: trimOrUndefined(input.sessionId) ?? null,
        principalType: trimOrUndefined(input.principalType) ?? null,
        principalId: trimOrUndefined(input.principalId) ?? null,
        reasonCode: input.reasonCode,
        title: input.title,
        detail: trimOrUndefined(input.detail) ?? null,
        model: trimOrUndefined(input.model) ?? null,
        metadata: input.metadata ?? null
      }
    });
    return mapRecord(row);
  }

  async list(input?: { take?: number }): Promise<SubscriptionDenialLogRecord[]> {
    const rows = await this.db.subscriptionDenialLog.findMany({
      orderBy: { createdAt: "desc" },
      take: input?.take ?? 100
    });
    return rows.map(mapRecord);
  }
}
