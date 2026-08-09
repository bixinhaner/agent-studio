export type PortalSteerEventStatus = "pending" | "accepted" | "failed";

export type PortalSteerEventRecord = {
  id: string;
  threadId: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  sourceUserMessageId?: string;
  turnId?: string;
  message: string;
  status: PortalSteerEventStatus;
  errorCode?: string;
  resolvedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type PortalSteerEventRow = {
  id: string;
  threadId: string;
  organizationId: string;
  userId: string;
  sessionId: string;
  sourceUserMessageId: string | null;
  turnId: string | null;
  message: string;
  status: string;
  errorCode: string | null;
  resolvedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type PortalSteerEventTable = {
  findUnique(args: { where: { id: string } }): Promise<PortalSteerEventRow | null>;
  findMany(args: {
    where: { threadId: string };
    orderBy: Array<{ createdAt: "asc" } | { id: "asc" }>;
  }): Promise<PortalSteerEventRow[]>;
  create(args: {
    data: {
      id: string;
      threadId: string;
      organizationId: string;
      userId: string;
      sessionId: string;
      sourceUserMessageId: string | null;
      message: string;
      status: "pending";
    };
  }): Promise<PortalSteerEventRow>;
  update(args: {
    where: { id: string };
    data: {
      sessionId?: string;
      sourceUserMessageId?: string | null;
      status?: PortalSteerEventStatus;
      turnId?: string | null;
      errorCode?: string | null;
      resolvedAt?: Date | null;
    };
  }): Promise<PortalSteerEventRow>;
};

export type PortalSteerEventRepositoryDb = {
  portalSteerEvent: PortalSteerEventTable;
};

function normalized(value: string | undefined | null): string {
  return typeof value === "string" ? value.trim() : "";
}

function optionalString(value: string | undefined | null): string | undefined {
  return normalized(value) || undefined;
}

function toIsoString(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date(0).toISOString() : parsed.toISOString();
}

function toOptionalIsoString(value: Date | string | null): string | undefined {
  return value ? toIsoString(value) : undefined;
}

function normalizeStatus(value: string): PortalSteerEventStatus {
  return value === "accepted" ? "accepted" : value === "failed" ? "failed" : "pending";
}

function toRecord(row: PortalSteerEventRow): PortalSteerEventRecord {
  return {
    id: row.id,
    threadId: row.threadId,
    organizationId: row.organizationId,
    userId: row.userId,
    sessionId: row.sessionId,
    sourceUserMessageId: optionalString(row.sourceUserMessageId),
    turnId: optionalString(row.turnId),
    message: row.message,
    status: normalizeStatus(row.status),
    errorCode: optionalString(row.errorCode),
    resolvedAt: toOptionalIsoString(row.resolvedAt),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

export class PortalSteerEventRepository {
  constructor(private readonly db: PortalSteerEventRepositoryDb) {}

  async get(id: string): Promise<PortalSteerEventRecord | null> {
    const normalizedId = normalized(id);
    if (!normalizedId) return null;
    const row = await this.db.portalSteerEvent.findUnique({ where: { id: normalizedId } });
    return row ? toRecord(row) : null;
  }

  async listForThread(threadId: string): Promise<PortalSteerEventRecord[]> {
    const normalizedThreadId = normalized(threadId);
    if (!normalizedThreadId) return [];
    const rows = await this.db.portalSteerEvent.findMany({
      where: { threadId: normalizedThreadId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }]
    });
    return rows.map(toRecord);
  }

  async begin(input: {
    id: string;
    threadId: string;
    organizationId: string;
    userId: string;
    sessionId: string;
    sourceUserMessageId?: string;
    message: string;
  }): Promise<{ event: PortalSteerEventRecord; alreadyAccepted: boolean }> {
    const id = normalized(input.id);
    const threadId = normalized(input.threadId);
    const organizationId = normalized(input.organizationId);
    const userId = normalized(input.userId);
    const sessionId = normalized(input.sessionId);
    const message = normalized(input.message);
    if (!id || !threadId || !organizationId || !userId || !sessionId || !message) {
      throw new Error("Portal steer event fields are required");
    }

    const existing = await this.get(id);
    if (existing) {
      if (
        existing.threadId !== threadId ||
        existing.organizationId !== organizationId ||
        existing.userId !== userId ||
        existing.message !== message
      ) {
        throw new Error("Portal steer event does not match the current request");
      }
      if (existing.status === "accepted") {
        return { event: existing, alreadyAccepted: true };
      }
      const row = await this.db.portalSteerEvent.update({
        where: { id },
        data: {
          sessionId,
          sourceUserMessageId: optionalString(input.sourceUserMessageId) ?? null,
          status: "pending",
          turnId: null,
          errorCode: null,
          resolvedAt: null
        }
      });
      return { event: toRecord(row), alreadyAccepted: false };
    }

    const row = await this.db.portalSteerEvent.create({
      data: {
        id,
        threadId,
        organizationId,
        userId,
        sessionId,
        sourceUserMessageId: optionalString(input.sourceUserMessageId) ?? null,
        message,
        status: "pending"
      }
    });
    return { event: toRecord(row), alreadyAccepted: false };
  }

  async markAccepted(id: string, turnId: string, at = new Date()): Promise<PortalSteerEventRecord> {
    const row = await this.db.portalSteerEvent.update({
      where: { id: normalized(id) },
      data: {
        status: "accepted",
        turnId: normalized(turnId) || null,
        errorCode: null,
        resolvedAt: at
      }
    });
    return toRecord(row);
  }

  async markFailed(id: string, errorCode = "steer_failed", at = new Date()): Promise<PortalSteerEventRecord> {
    const row = await this.db.portalSteerEvent.update({
      where: { id: normalized(id) },
      data: {
        status: "failed",
        turnId: null,
        errorCode: normalized(errorCode) || "steer_failed",
        resolvedAt: at
      }
    });
    return toRecord(row);
  }
}
