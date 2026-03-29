export type UsageEventRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  model: string;
  featureType: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: string;
  internalCost: string;
  resultStatus: string;
  metadata?: unknown;
  createdAt: string;
};

export type CreateUsageEventInput = {
  id?: string;
  organizationId?: string;
  userId?: string;
  departmentIdSnapshot?: string;
  threadId?: string;
  sessionId?: string;
  model: string;
  featureType: string;
  inputTokens?: number;
  cachedInputTokens?: number;
  outputTokens?: number;
  estimatedCost?: string;
  internalCost?: string;
  resultStatus: string;
  metadata?: unknown;
  createdAt?: string | Date;
};

export type ListUsageEventsInput = {
  model?: string;
  featureType?: string;
  resultStatus?: string;
  sessionId?: string;
  take?: number;
};

type UsageEventRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  departmentIdSnapshot: string | null;
  threadId: string | null;
  sessionId: string | null;
  model: string;
  featureType: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  estimatedCost: unknown;
  internalCost: unknown;
  resultStatus: string;
  metadata: unknown;
  createdAt: Date | string;
};

type UsageEventTable = {
  create(args: { data: Record<string, unknown> }): Promise<UsageEventRow>;
  findMany(args?: {
    where?: {
      model?: string;
      featureType?: string;
      resultStatus?: string;
      sessionId?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<UsageEventRow[]>;
};

export type UsageEventRepositoryDb = {
  usageEvent: UsageEventTable;
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

function formatDecimal(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toFixed(6);
  if (value && typeof value === "object" && "toFixed" in value && typeof value.toFixed === "function") {
    return value.toFixed(6);
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    return String(value.toString());
  }
  return "0.000000";
}

function mapUsageEvent(row: UsageEventRow): UsageEventRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    userId: trimOrUndefined(row.userId),
    departmentIdSnapshot: trimOrUndefined(row.departmentIdSnapshot),
    threadId: trimOrUndefined(row.threadId),
    sessionId: trimOrUndefined(row.sessionId),
    model: row.model,
    featureType: row.featureType,
    inputTokens: row.inputTokens,
    cachedInputTokens: row.cachedInputTokens,
    outputTokens: row.outputTokens,
    estimatedCost: formatDecimal(row.estimatedCost),
    internalCost: formatDecimal(row.internalCost),
    resultStatus: row.resultStatus,
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class UsageEventRepository {
  constructor(private readonly db: UsageEventRepositoryDb) {}

  async create(input: CreateUsageEventInput): Promise<UsageEventRecord> {
    const model = trimOrUndefined(input.model);
    const featureType = trimOrUndefined(input.featureType);
    const resultStatus = trimOrUndefined(input.resultStatus);
    if (!model || !featureType || !resultStatus) {
      throw new Error("usage event model, featureType, and resultStatus are required");
    }

    const created = await this.db.usageEvent.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        userId: trimOrUndefined(input.userId) ?? null,
        departmentIdSnapshot: trimOrUndefined(input.departmentIdSnapshot) ?? null,
        threadId: trimOrUndefined(input.threadId) ?? null,
        sessionId: trimOrUndefined(input.sessionId) ?? null,
        model,
        featureType,
        inputTokens: input.inputTokens ?? 0,
        cachedInputTokens: input.cachedInputTokens ?? 0,
        outputTokens: input.outputTokens ?? 0,
        estimatedCost: trimOrUndefined(input.estimatedCost) ?? "0.000000",
        internalCost: trimOrUndefined(input.internalCost) ?? "0.000000",
        resultStatus,
        metadata: input.metadata ?? null,
        createdAt: input.createdAt instanceof Date ? input.createdAt : input.createdAt ? new Date(input.createdAt) : undefined
      }
    });

    return mapUsageEvent(created);
  }

  async list(input: ListUsageEventsInput = {}): Promise<UsageEventRecord[]> {
    const rows = await this.db.usageEvent.findMany({
      where: {
        model: trimOrUndefined(input.model),
        featureType: trimOrUndefined(input.featureType),
        resultStatus: trimOrUndefined(input.resultStatus),
        sessionId: trimOrUndefined(input.sessionId)
      },
      orderBy: { createdAt: "desc" },
      take: input.take
    });

    return rows.map(mapUsageEvent);
  }
}
