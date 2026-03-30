export type InboxItemStatus = "unread" | "read" | "archived";

export type InboxItemInput = {
  userId: string;
  eventType: string;
  category: string;
  title: string;
  body: string;
  status?: InboxItemStatus;
  threadId?: string | null;
  relatedEntityType?: string | null;
  relatedEntityId?: string | null;
  sourceActorUserId?: string | null;
  payload?: unknown;
};

export type InboxItemRecord = {
  id: string;
  userId: string;
  eventType: string;
  category: string;
  title: string;
  body: string;
  status: InboxItemStatus;
  threadId?: string;
  relatedEntityType?: string;
  relatedEntityId?: string;
  sourceActorUserId?: string;
  payload?: unknown;
  readAt?: string;
  archivedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type InboxItemRow = {
  id: string;
  userId: string;
  eventType: string;
  category: string;
  title: string;
  body: string;
  status: string;
  threadId: string | null;
  relatedEntityType: string | null;
  relatedEntityId: string | null;
  sourceActorUserId: string | null;
  payload: unknown;
  readAt: Date | string | null;
  archivedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type InboxItemTable = {
  create(args: { data: Record<string, unknown> }): Promise<InboxItemRow>;
  findMany(args?: {
    where?: {
      userId?: string;
    };
    orderBy?: { createdAt?: "asc" | "desc" };
  }): Promise<InboxItemRow[]>;
  findUnique(args: { where: { id: string } }): Promise<InboxItemRow | null>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<InboxItemRow>;
};

export type InboxItemRepositoryDb = {
  inboxItem: InboxItemTable;
  $transaction<T>(callback: (tx: InboxItemRepositoryDb) => Promise<T>): Promise<T>;
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

function toDateOrNull(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function mapInboxItem(row: InboxItemRow): InboxItemRecord {
  return {
    id: row.id,
    userId: row.userId,
    eventType: row.eventType,
    category: row.category,
    title: row.title,
    body: row.body,
    status: row.status as InboxItemStatus,
    threadId: trimOrUndefined(row.threadId),
    relatedEntityType: trimOrUndefined(row.relatedEntityType),
    relatedEntityId: trimOrUndefined(row.relatedEntityId),
    sourceActorUserId: trimOrUndefined(row.sourceActorUserId),
    payload: row.payload ?? undefined,
    readAt: toIsoString(row.readAt),
    archivedAt: toIsoString(row.archivedAt),
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function normalizeStatus(value: string | undefined): InboxItemStatus {
  return value === "read" || value === "archived" ? value : "unread";
}

export class InboxItemRepository {
  constructor(private readonly db: InboxItemRepositoryDb) {}

  async create(input: InboxItemInput): Promise<InboxItemRecord> {
    const userId = trimOrUndefined(input.userId);
    const eventType = trimOrUndefined(input.eventType);
    const category = trimOrUndefined(input.category);
    const title = typeof input.title === "string" ? input.title.trim() : "";
    const body = typeof input.body === "string" ? input.body.trim() : "";
    if (!userId || !eventType || !category || !title || !body) {
      throw new Error("userId, eventType, category, title, and body are required");
    }
    const now = new Date();
    const created = await this.db.inboxItem.create({
      data: {
        userId,
        eventType,
        category,
        title,
        body,
        status: normalizeStatus(input.status),
        threadId: trimOrUndefined(input.threadId) ?? null,
        relatedEntityType: trimOrUndefined(input.relatedEntityType) ?? null,
        relatedEntityId: trimOrUndefined(input.relatedEntityId) ?? null,
        sourceActorUserId: trimOrUndefined(input.sourceActorUserId) ?? null,
        payload: input.payload ?? null,
        readAt: null,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      }
    });
    return mapInboxItem(created);
  }

  async listForUser(userId: string): Promise<InboxItemRecord[]> {
    const normalizedUserId = trimOrUndefined(userId);
    if (!normalizedUserId) return [];
    const rows = await this.db.inboxItem.findMany({
      where: { userId: normalizedUserId },
      orderBy: { createdAt: "desc" }
    });
    return rows.map(mapInboxItem);
  }

  async getForUser(id: string, userId: string): Promise<InboxItemRecord | null> {
    const normalizedId = trimOrUndefined(id);
    const normalizedUserId = trimOrUndefined(userId);
    if (!normalizedId || !normalizedUserId) return null;
    const row = await this.db.inboxItem.findUnique({ where: { id: normalizedId } });
    if (!row || row.userId !== normalizedUserId) return null;
    return mapInboxItem(row);
  }

  async markRead(id: string, userId: string): Promise<InboxItemRecord> {
    return this.updateOwnedItem(id, userId, {
      status: "read",
      readAt: new Date(),
      archivedAt: null
    });
  }

  async markUnread(id: string, userId: string): Promise<InboxItemRecord> {
    return this.updateOwnedItem(id, userId, {
      status: "unread",
      readAt: null,
      archivedAt: null
    });
  }

  async archive(id: string, userId: string): Promise<InboxItemRecord> {
    const current = await this.getOwnedRow(id, userId);
    const readAt = toDateOrNull(current?.readAt) ?? new Date();
    return this.updateOwnedItem(id, userId, {
      status: "archived",
      readAt,
      archivedAt: new Date()
    });
  }

  async unarchive(id: string, userId: string): Promise<InboxItemRecord> {
    const current = await this.getOwnedRow(id, userId);
    const status: InboxItemStatus = toDateOrNull(current?.readAt) ? "read" : "unread";
    return this.updateOwnedItem(id, userId, {
      status,
      readAt: toDateOrNull(current?.readAt),
      archivedAt: null
    });
  }

  private async getOwnedRow(id: string, userId: string): Promise<InboxItemRow | null> {
    const normalizedId = trimOrUndefined(id);
    const normalizedUserId = trimOrUndefined(userId);
    if (!normalizedId || !normalizedUserId) return null;
    const row = await this.db.inboxItem.findUnique({ where: { id: normalizedId } });
    if (!row || row.userId !== normalizedUserId) return null;
    return row;
  }

  private async updateOwnedItem(
    id: string,
    userId: string,
    data: {
      status: InboxItemStatus;
      readAt?: Date | string | null;
      archivedAt?: Date | string | null;
    }
  ): Promise<InboxItemRecord> {
    const current = await this.getOwnedRow(id, userId);
    if (!current) {
      throw new Error("inbox item not found");
    }
    const updated = await this.db.inboxItem.update({
      where: { id: current.id },
      data: {
        status: data.status,
        readAt: toDateOrNull(data.readAt),
        archivedAt: toDateOrNull(data.archivedAt),
        updatedAt: new Date()
      }
    });
    return mapInboxItem(updated);
  }
}
