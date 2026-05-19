export type ExternalConversationBindingRecord = {
  id: string;
  organizationId?: string;
  integrationInstanceId: string;
  threadId: string;
  userId?: string;
  channel: string;
  externalConversationKey: string;
  externalConversationId: string;
  conversationType: string;
  agentModeId?: string;
  externalUserId?: string;
  externalUnionId?: string;
  externalUserName?: string;
  externalGroupId?: string;
  externalGroupName?: string;
  botId?: string;
  botName?: string;
  lastExternalMessageId?: string;
  lastMessageAt?: string;
  metadata?: unknown;
  createdAt: string;
  updatedAt: string;
};

type ExternalConversationBindingRow = {
  id: string;
  organizationId: string | null;
  integrationInstanceId: string;
  threadId: string;
  userId: string | null;
  channel: string;
  externalConversationKey: string;
  externalConversationId: string;
  conversationType: string;
  agentModeId: string | null;
  externalUserId: string | null;
  externalUnionId: string | null;
  externalUserName: string | null;
  externalGroupId: string | null;
  externalGroupName: string | null;
  botId: string | null;
  botName: string | null;
  lastExternalMessageId: string | null;
  lastMessageAt: Date | string | null;
  metadata: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type ExternalConversationBindingTable = {
  findUnique(args: { where: { id?: string; externalConversationKey?: string } }): Promise<ExternalConversationBindingRow | null>;
  findMany(args?: {
    where?: {
      integrationInstanceId?: string;
      threadId?: string | { in: string[] };
      channel?: string;
    };
    orderBy?: { updatedAt?: "asc" | "desc"; createdAt?: "asc" | "desc" };
    take?: number;
  }): Promise<ExternalConversationBindingRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ExternalConversationBindingRow>;
  update(args: { where: { id?: string; externalConversationKey?: string }; data: Record<string, unknown> }): Promise<ExternalConversationBindingRow>;
  upsert(args: {
    where: { externalConversationKey: string };
    create: Record<string, unknown>;
    update: Record<string, unknown>;
  }): Promise<ExternalConversationBindingRow>;
};

export type ExternalConversationBindingRepositoryDb = {
  externalConversationBinding: ExternalConversationBindingTable;
};

export type UpsertExternalConversationBindingInput = {
  organizationId?: string | null;
  integrationInstanceId: string;
  threadId: string;
  userId?: string | null;
  channel: string;
  externalConversationKey: string;
  externalConversationId: string;
  conversationType: string;
  agentModeId?: string | null;
  externalUserId?: string | null;
  externalUnionId?: string | null;
  externalUserName?: string | null;
  externalGroupId?: string | null;
  externalGroupName?: string | null;
  botId?: string | null;
  botName?: string | null;
  lastExternalMessageId?: string | null;
  lastMessageAt?: string | Date | null;
  metadata?: unknown;
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
  return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function mapRow(row: ExternalConversationBindingRow): ExternalConversationBindingRecord {
  return {
    id: row.id,
    organizationId: trimOrUndefined(row.organizationId),
    integrationInstanceId: row.integrationInstanceId,
    threadId: row.threadId,
    userId: trimOrUndefined(row.userId),
    channel: row.channel,
    externalConversationKey: row.externalConversationKey,
    externalConversationId: row.externalConversationId,
    conversationType: row.conversationType,
    agentModeId: trimOrUndefined(row.agentModeId),
    externalUserId: trimOrUndefined(row.externalUserId),
    externalUnionId: trimOrUndefined(row.externalUnionId),
    externalUserName: trimOrUndefined(row.externalUserName),
    externalGroupId: trimOrUndefined(row.externalGroupId),
    externalGroupName: trimOrUndefined(row.externalGroupName),
    botId: trimOrUndefined(row.botId),
    botName: trimOrUndefined(row.botName),
    lastExternalMessageId: trimOrUndefined(row.lastExternalMessageId),
    lastMessageAt: toIsoString(row.lastMessageAt),
    metadata: row.metadata ?? undefined,
    createdAt: toIsoString(row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(row.updatedAt) ?? new Date().toISOString()
  };
}

function dataFromInput(input: UpsertExternalConversationBindingInput): Record<string, unknown> {
  return {
    organizationId: trimOrUndefined(input.organizationId ?? undefined) ?? null,
    integrationInstanceId: input.integrationInstanceId,
    threadId: input.threadId,
    userId: trimOrUndefined(input.userId ?? undefined) ?? null,
    channel: input.channel,
    externalConversationKey: input.externalConversationKey,
    externalConversationId: input.externalConversationId,
    conversationType: input.conversationType,
    agentModeId: trimOrUndefined(input.agentModeId ?? undefined) ?? null,
    externalUserId: trimOrUndefined(input.externalUserId ?? undefined) ?? null,
    externalUnionId: trimOrUndefined(input.externalUnionId ?? undefined) ?? null,
    externalUserName: trimOrUndefined(input.externalUserName ?? undefined) ?? null,
    externalGroupId: trimOrUndefined(input.externalGroupId ?? undefined) ?? null,
    externalGroupName: trimOrUndefined(input.externalGroupName ?? undefined) ?? null,
    botId: trimOrUndefined(input.botId ?? undefined) ?? null,
    botName: trimOrUndefined(input.botName ?? undefined) ?? null,
    lastExternalMessageId: trimOrUndefined(input.lastExternalMessageId ?? undefined) ?? null,
    lastMessageAt: toDate(input.lastMessageAt),
    metadata: input.metadata ?? null
  };
}

export class ExternalConversationBindingRepository {
  constructor(private readonly db: ExternalConversationBindingRepositoryDb) {}

  async getByExternalConversationKey(externalConversationKey: string): Promise<ExternalConversationBindingRecord | undefined> {
    const normalized = trimOrUndefined(externalConversationKey);
    if (!normalized) return undefined;
    const row = await this.db.externalConversationBinding.findUnique({
      where: { externalConversationKey: normalized }
    });
    return row ? mapRow(row) : undefined;
  }

  async upsert(input: UpsertExternalConversationBindingInput): Promise<ExternalConversationBindingRecord> {
    const data = dataFromInput(input);
    const row = await this.db.externalConversationBinding.upsert({
      where: { externalConversationKey: input.externalConversationKey },
      create: data,
      update: {
        ...data,
        updatedAt: new Date()
      }
    });
    return mapRow(row);
  }

  async updateThread(input: {
    externalConversationKey: string;
    threadId: string;
    lastExternalMessageId?: string | null;
    lastMessageAt?: string | Date | null;
    metadata?: unknown;
  }): Promise<ExternalConversationBindingRecord> {
    const row = await this.db.externalConversationBinding.update({
      where: { externalConversationKey: input.externalConversationKey },
      data: {
        threadId: input.threadId,
        lastExternalMessageId: trimOrUndefined(input.lastExternalMessageId ?? undefined) ?? null,
        lastMessageAt: toDate(input.lastMessageAt),
        ...(input.metadata !== undefined ? { metadata: input.metadata ?? null } : {}),
        updatedAt: new Date()
      }
    });
    return mapRow(row);
  }

  async touch(input: {
    externalConversationKey: string;
    lastExternalMessageId?: string | null;
    lastMessageAt?: string | Date | null;
    metadata?: unknown;
  }): Promise<ExternalConversationBindingRecord> {
    const row = await this.db.externalConversationBinding.update({
      where: { externalConversationKey: input.externalConversationKey },
      data: {
        lastExternalMessageId: trimOrUndefined(input.lastExternalMessageId ?? undefined) ?? null,
        lastMessageAt: toDate(input.lastMessageAt),
        ...(input.metadata !== undefined ? { metadata: input.metadata ?? null } : {}),
        updatedAt: new Date()
      }
    });
    return mapRow(row);
  }

  async listRecentForIntegration(integrationInstanceId: string, take = 20): Promise<ExternalConversationBindingRecord[]> {
    const normalized = trimOrUndefined(integrationInstanceId);
    if (!normalized) return [];
    const rows = await this.db.externalConversationBinding.findMany({
      where: { integrationInstanceId: normalized },
      orderBy: { updatedAt: "desc" },
      take: Math.max(1, Math.min(100, Math.trunc(take)))
    });
    return rows.map(mapRow);
  }

  async listByThreadIds(threadIds: string[]): Promise<ExternalConversationBindingRecord[]> {
    const ids = [...new Set(threadIds.map((item) => trimOrUndefined(item)).filter(Boolean) as string[])];
    if (!ids.length) return [];
    const rows = await this.db.externalConversationBinding.findMany({
      where: { threadId: { in: ids } },
      orderBy: { updatedAt: "desc" }
    });
    return rows.map(mapRow);
  }
}
