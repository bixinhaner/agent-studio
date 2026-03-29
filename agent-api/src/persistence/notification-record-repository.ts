export type NotificationChannelType = "in_app" | "dingtalk";
export type NotificationStatus = "pending" | "sent" | "failed";

export type NotificationRecord = {
  id: string;
  organizationId?: string;
  channelType: NotificationChannelType;
  targetRef: string;
  eventType: string;
  status: NotificationStatus;
  payload?: unknown;
  errorMessage?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateNotificationRecordInput = {
  id?: string;
  organizationId?: string;
  channelType: NotificationChannelType;
  targetRef: string;
  eventType: string;
  status?: NotificationStatus;
  payload?: unknown;
  errorMessage?: string | null;
};

export type UpdateNotificationRecordInput = {
  status?: NotificationStatus;
  payload?: unknown;
  errorMessage?: string | null;
};

export type ListNotificationRecordsInput = {
  organizationId?: string | null;
  channelType?: NotificationChannelType;
  targetRef?: string;
  eventType?: string;
  status?: NotificationStatus;
  take?: number;
};

type NotificationRecordRow = {
  id: string;
  organizationId: string | null;
  channelType: string;
  targetRef: string;
  eventType: string;
  status: string;
  payload: unknown;
  errorMessage: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type NotificationRecordTable = {
  create(args: { data: Record<string, unknown> }): Promise<NotificationRecordRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<NotificationRecordRow>;
  findMany(args?: {
    where?: {
      organizationId?: string | null;
      channelType?: string;
      targetRef?: string;
      eventType?: string;
      status?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<NotificationRecordRow[]>;
};

export type NotificationRecordRepositoryDb = {
  notificationRecord: NotificationRecordTable;
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

function mapNotificationRecord(row: NotificationRecordRow): NotificationRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    channelType: row.channelType as NotificationChannelType,
    targetRef: row.targetRef,
    eventType: row.eventType,
    status: row.status as NotificationStatus,
    payload: row.payload ?? undefined,
    errorMessage: trimOrUndefined(row.errorMessage),
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function isNotificationChannelType(value: string | undefined): value is NotificationChannelType {
  return value === "in_app" || value === "dingtalk";
}

export class NotificationRecordRepository {
  constructor(private readonly db: NotificationRecordRepositoryDb) {}

  async create(input: CreateNotificationRecordInput): Promise<NotificationRecord> {
    const channelType = trimOrUndefined(input.channelType);
    const targetRef = trimOrUndefined(input.targetRef);
    const eventType = trimOrUndefined(input.eventType);
    if (!isNotificationChannelType(channelType) || !targetRef || !eventType) {
      throw new Error("notification channelType, targetRef, and eventType are required");
    }

    const created = await this.db.notificationRecord.create({
      data: {
        id: trimOrUndefined(input.id),
        organizationId: trimOrUndefined(input.organizationId) ?? null,
        channelType,
        targetRef,
        eventType,
        status: input.status ?? "pending",
        payload: input.payload ?? null,
        errorMessage: trimOrUndefined(input.errorMessage) ?? null
      }
    });
    return mapNotificationRecord(created);
  }

  async update(input: { id: string; changes: UpdateNotificationRecordInput }): Promise<NotificationRecord> {
    const updated = await this.db.notificationRecord.update({
      where: { id: trimOrUndefined(input.id) ?? input.id },
      data: {
        ...(input.changes.status !== undefined ? { status: input.changes.status } : {}),
        ...(input.changes.payload !== undefined ? { payload: input.changes.payload } : {}),
        ...(input.changes.errorMessage !== undefined ? { errorMessage: trimOrUndefined(input.changes.errorMessage) ?? null } : {}),
        updatedAt: new Date()
      }
    });
    return mapNotificationRecord(updated);
  }

  async list(input: ListNotificationRecordsInput = {}): Promise<NotificationRecord[]> {
    const rows = await this.db.notificationRecord.findMany({
      where: {
        ...(input.organizationId !== undefined ? { organizationId: input.organizationId ?? null } : {}),
        ...(input.channelType ? { channelType: input.channelType } : {}),
        ...(trimOrUndefined(input.targetRef) ? { targetRef: trimOrUndefined(input.targetRef) } : {}),
        ...(trimOrUndefined(input.eventType) ? { eventType: trimOrUndefined(input.eventType) } : {}),
        ...(input.status ? { status: input.status } : {})
      },
      orderBy: { createdAt: "asc" },
      take: input.take
    });
    return rows.map(mapNotificationRecord);
  }
}
