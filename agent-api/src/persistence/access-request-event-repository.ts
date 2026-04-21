export type AccessRequestEventRecord = {
  id: string;
  accessRequestId: string;
  eventType: string;
  actorType: string;
  actorUserId?: string;
  actorEmail?: string;
  title: string;
  detail?: string;
  metadata?: unknown;
  createdAt: string;
};

type AccessRequestEventRow = {
  id: string;
  accessRequestId: string;
  eventType: string | null;
  actorType: string | null;
  actorUserId: string | null;
  actorEmail: string | null;
  title: string;
  detail: string | null;
  metadata: unknown;
  createdAt: Date | string;
};

type AccessRequestEventTable = {
  findMany(args?: {
    where?: { accessRequestId?: string | { in: string[] } };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<AccessRequestEventRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<AccessRequestEventRow>;
};

export type AccessRequestEventRepositoryDb = {
  accessRequestEvent: AccessRequestEventTable;
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function mapEvent(row: AccessRequestEventRow): AccessRequestEventRecord {
  return {
    id: row.id,
    accessRequestId: row.accessRequestId,
    eventType: trimOrUndefined(row.eventType) ?? "updated",
    actorType: trimOrUndefined(row.actorType) ?? "system",
    actorUserId: trimOrUndefined(row.actorUserId),
    actorEmail: trimOrUndefined(row.actorEmail),
    title: row.title,
    detail: trimOrUndefined(row.detail),
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt)
  };
}

export class AccessRequestEventRepository {
  constructor(private readonly db: AccessRequestEventRepositoryDb) {}

  async create(input: {
    accessRequestId: string;
    eventType: string;
    actorType: string;
    actorUserId?: string | null;
    actorEmail?: string | null;
    title: string;
    detail?: string | null;
    metadata?: unknown;
  }): Promise<AccessRequestEventRecord> {
    const row = await this.db.accessRequestEvent.create({
      data: {
        accessRequestId: input.accessRequestId.trim(),
        eventType: input.eventType.trim(),
        actorType: input.actorType.trim(),
        actorUserId: trimOrUndefined(input.actorUserId ?? undefined) ?? null,
        actorEmail: trimOrUndefined(input.actorEmail ?? undefined) ?? null,
        title: input.title.trim(),
        detail: trimOrUndefined(input.detail ?? undefined) ?? null,
        metadata: input.metadata ?? null
      }
    });
    return mapEvent(row);
  }

  async listForRequest(accessRequestId: string): Promise<AccessRequestEventRecord[]> {
    const normalized = trimOrUndefined(accessRequestId);
    if (!normalized) return [];
    const rows = await this.db.accessRequestEvent.findMany({
      where: { accessRequestId: normalized },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(mapEvent);
  }

  async listForRequests(accessRequestIds: string[]): Promise<AccessRequestEventRecord[]> {
    const normalized = [...new Set(accessRequestIds.map((item) => trimOrUndefined(item)).filter(Boolean) as string[])];
    if (!normalized.length) return [];
    const rows = await this.db.accessRequestEvent.findMany({
      where: { accessRequestId: { in: normalized } },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(mapEvent);
  }
}
