import { randomUUID } from "node:crypto";

import { normalizeAssistantMessageContentOrder } from "../messages/assistant-content-order.js";
import type { ReasoningEffort } from "../model-config.js";
import { sanitizeJsonForPostgres } from "./postgres-json-sanitizer.js";

export type ThreadStatus = "regular" | "archived";
export type { ReasoningEffort } from "../model-config.js";

export type StoredMessageItem = {
  parentId: string | null;
  message: unknown;
  runConfig?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
};

export type ConversationTurnDeliveryStatus = "running" | "completed" | "failed" | "stopped";

export type ConversationTurnDeliveryClaim = {
  threadId: string;
  userMessageId: string;
  runId: string;
  channel: string;
  acceptedAt?: string;
};

export type ConversationTurnDeliveryFinalize = ConversationTurnDeliveryClaim & {
  status: Exclude<ConversationTurnDeliveryStatus, "running">;
  assistant: StoredMessageItem;
};

export type ConversationTurnDeliveryResult = {
  outcome: "claimed" | "already_claimed" | "persisted" | "already_persisted" | "superseded";
  runId: string;
  latestRunId: string;
  assistantMessageId?: string;
};

export type ThreadFeedback = {
  id: string;
  type: "positive" | "negative";
  messageId?: string;
  contentPreview?: string;
  comment?: string;
  userId?: string;
  createdAt: string;
  updatedAt?: string;
};

export type ThreadRecord = {
  id: string;
  organizationId?: string;
  userId?: string;
  securityDomainId?: string;
  userWorkspaceId?: string;
  workspaceFolderId?: string;
  channel?: string;
  externalId?: string;
  status: ThreadStatus;
  title?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  codexThreadId?: string;
  sessionId?: string;
  createdAt: string;
  updatedAt: string;
  headId?: string | null;
  messages: StoredMessageItem[];
  feedback: ThreadFeedback[];
};

type CreateThreadPayload = {
  id?: string;
  organizationId?: string;
  userId?: string;
  securityDomainId?: string;
  userWorkspaceId?: string;
  workspaceFolderId?: string;
  channel?: string;
  title?: string;
  externalId?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  codexThreadId?: string;
  status?: ThreadStatus;
  headId?: string | null;
  createdAt?: string;
  updatedAt?: string;
  feedback?: ThreadFeedback[];
};

type UpdateThreadPayload = Partial<{
  status: ThreadStatus;
  title: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  userWorkspaceId: string | null;
  workspaceFolderId: string | null;
  codexRunConfig: Record<string, unknown> | undefined;
  codexThreadId: string | undefined;
  sessionId: string | undefined;
  headId: string | null;
}>;

type ThreadRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  securityDomainId?: string | null;
  userWorkspaceId?: string | null;
  workspaceFolderId?: string | null;
  channel?: string | null;
  externalId: string | null;
  title: string | null;
  status: string | null;
  model: string | null;
  reasoningEffort: string | null;
  workspace: string | null;
  codexRunConfig: unknown;
  codexThreadId?: string | null;
  headId: string | null;
  feedback: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MessageRow = {
  id: string;
  threadId: string;
  externalId: string | null;
  role: string;
  content: unknown;
  parentId: string | null;
  runConfig: unknown;
  position: number;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type RuntimeSessionRow = {
  externalId: string | null;
};

type ThreadTable = {
  count(args?: unknown): Promise<number>;
  findUnique(args: { where: { id: string } } | { where: { externalId: string } }): Promise<ThreadRow | null>;
  findMany(args?: {
    where?: {
      status?: "active" | "archived";
      userId?: string | null;
      organizationId?: string | null;
      securityDomainId?: string | null;
      userWorkspaceId?: string | null;
      workspaceFolderId?: string | null;
      workspaceTrashBatchId?: string | null;
    };
    orderBy?: { updatedAt: "asc" | "desc" };
  }): Promise<ThreadRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<ThreadRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<ThreadRow>;
  delete(args: { where: { id: string } }): Promise<ThreadRow>;
};

type MessageTable = {
  findMany(args: { where: { threadId: string }; orderBy?: { position: "asc" | "desc" } }): Promise<MessageRow[]>;
  create(args: { data: Record<string, unknown> }): Promise<MessageRow>;
  update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<MessageRow>;
  deleteMany(args: { where: { threadId: string } }): Promise<{ count: number }>;
};

type RuntimeSessionTable = {
  findFirst(args: { where: { threadId: string; status?: "active" | "ended" | "failed" }; orderBy?: { updatedAt: "asc" | "desc" } }): Promise<RuntimeSessionRow | null>;
  deleteMany(args: { where: { threadId: string } }): Promise<{ count: number }>;
};

export type ThreadRepositoryDb = {
  thread: ThreadTable;
  message: MessageTable;
  runtimeSession: RuntimeSessionTable;
  $queryRawUnsafe?<T>(query: string, ...values: unknown[]): Promise<T>;
  $transaction<T>(callback: (tx: ThreadRepositoryDb) => Promise<T>): Promise<T>;
};

async function lockThreadMessages(db: ThreadRepositoryDb, threadId: string): Promise<void> {
  if (!db.$queryRawUnsafe) return;
  await db.$queryRawUnsafe(
    'SELECT 1::int AS "locked" FROM pg_advisory_xact_lock(hashtextextended($1, 0))',
    `thread-messages:${threadId}`
  );
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const TURN_DELIVERY_RUN_CONFIG_KEY = "_agentStudioTurnDelivery";

type StoredTurnDelivery = {
  runId: string;
  channel: string;
  acceptedAt: string;
  status: ConversationTurnDeliveryStatus;
  assistantMessageId?: string;
  completedAt?: string;
};

function storedTurnDelivery(value: unknown): StoredTurnDelivery | undefined {
  const runConfig = asRecord(value);
  const delivery = asRecord(runConfig?.[TURN_DELIVERY_RUN_CONFIG_KEY]);
  const runId = trimOrUndefined(typeof delivery?.runId === "string" ? delivery.runId : undefined);
  const channel = trimOrUndefined(typeof delivery?.channel === "string" ? delivery.channel : undefined);
  const acceptedAt = trimOrUndefined(typeof delivery?.acceptedAt === "string" ? delivery.acceptedAt : undefined);
  const status = trimOrUndefined(
    typeof delivery?.status === "string" ? delivery.status : undefined
  ) as ConversationTurnDeliveryStatus | undefined;
  if (!runId || !channel || !acceptedAt || !status) return undefined;
  if (!["running", "completed", "failed", "stopped"].includes(status)) return undefined;
  return {
    runId,
    channel,
    acceptedAt,
    status,
    assistantMessageId: trimOrUndefined(
      typeof delivery?.assistantMessageId === "string" ? delivery.assistantMessageId : undefined
    ),
    completedAt: trimOrUndefined(typeof delivery?.completedAt === "string" ? delivery.completedAt : undefined)
  };
}

function withStoredTurnDelivery(runConfig: unknown, delivery: StoredTurnDelivery): Record<string, unknown> {
  return {
    ...(asRecord(runConfig) ?? {}),
    [TURN_DELIVERY_RUN_CONFIG_KEY]: delivery
  };
}

function acceptedAtMs(value: string): number {
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function messageIdOf(message: unknown): string | null {
  const obj = asRecord(message);
  if (!obj) return null;
  const id = obj.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
}

type MessageGraphItem = {
  parentId: string | null;
  message: unknown;
};

export function assertMessageGraphForPersistence(items: MessageGraphItem[]): void {
  const byId = new Map<string, MessageGraphItem>();
  for (const item of items) {
    const id = messageIdOf(item.message);
    if (!id) continue;
    if (byId.has(id)) throw new Error("Message ids must be unique within a thread");
    byId.set(id, item);
  }

  for (const [id, item] of byId) {
    const parentId = trimOrUndefined(item.parentId ?? undefined);
    if (parentId && !byId.has(parentId)) {
      throw new Error("Message parent must exist within the same thread");
    }
    const visited = new Set([id]);
    let cursor = parentId;
    while (cursor) {
      if (visited.has(cursor)) throw new Error("Message graph cannot contain a cycle");
      visited.add(cursor);
      cursor = trimOrUndefined(byId.get(cursor)?.parentId ?? undefined);
    }
  }
}

function assertIncomingMessageGraph(messages: MessageRow[], item: StoredMessageItem): void {
  const incomingId = messageIdOf(item.message);
  if (!incomingId) {
    if (trimOrUndefined(item.parentId ?? undefined)) {
      throw new Error("A message without an id cannot reference a parent");
    }
    return;
  }
  const byId = new Map(messages
    .filter((message) => message.externalId && message.externalId !== incomingId)
    .map((message) => [message.externalId!, trimOrUndefined(message.parentId ?? undefined) ?? null]));
  let cursor = trimOrUndefined(item.parentId ?? undefined) ?? null;
  if (cursor && !byId.has(cursor)) {
    throw new Error("Message parent must exist within the same thread");
  }
  const visited = new Set([incomingId]);
  while (cursor) {
    if (visited.has(cursor)) throw new Error("Message graph cannot contain a cycle");
    visited.add(cursor);
    cursor = byId.get(cursor) ?? null;
  }
}

function normalizeMessageRole(message: unknown): "user" | "assistant" | "system" | "tool" {
  const obj = asRecord(message);
  const role = typeof obj?.role === "string" ? obj.role.trim() : "";
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "system";
}

function toIsoString(value: Date | string): string {
  if (value instanceof Date) {
    return value.toISOString();
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return new Date().toISOString();
  }
  return parsed.toISOString();
}

function toDate(value: string | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function messageDate(message: unknown, key: "createdAt" | "updatedAt"): Date | undefined {
  const obj = asRecord(message);
  if (!obj) return undefined;
  const snakeKey = key === "createdAt" ? "created_at" : "updated_at";
  const value = obj[key] ?? obj[snakeKey];
  if (typeof value !== "string" && typeof value !== "number" && !(value instanceof Date)) return undefined;
  const parsed = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function resolvedMessageCreatedAt(item: StoredMessageItem, fallback?: Date): Date {
  return toDate(item.createdAt) ?? messageDate(item.message, "createdAt") ?? fallback ?? new Date();
}

function resolvedMessageUpdatedAt(item: StoredMessageItem, createdAt: Date): Date {
  return toDate(item.updatedAt) ?? messageDate(item.message, "updatedAt") ?? createdAt;
}

function normalizeFeedback(value: unknown): ThreadFeedback[] {
  if (!Array.isArray(value)) return [];
  const items: ThreadFeedback[] = [];
  for (const entry of value) {
    const obj = asRecord(entry);
    if (!obj) continue;
    const id = typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : randomUUID();
    const type = obj.type === "positive" || obj.type === "negative" ? obj.type : undefined;
    if (!type) continue;
    items.push({
      id,
      type,
      messageId: typeof obj.messageId === "string" && obj.messageId.trim() ? obj.messageId.trim() : undefined,
      contentPreview:
        typeof obj.contentPreview === "string" && obj.contentPreview.trim() ? obj.contentPreview.trim() : undefined,
      comment: typeof obj.comment === "string" && obj.comment.trim() ? obj.comment.trim() : undefined,
      userId: typeof obj.userId === "string" && obj.userId.trim() ? obj.userId.trim() : undefined,
      createdAt: typeof obj.createdAt === "string" && obj.createdAt.trim() ? obj.createdAt : new Date().toISOString(),
      updatedAt: typeof obj.updatedAt === "string" && obj.updatedAt.trim() ? obj.updatedAt : undefined
    });
  }
  return items;
}

function matchesFeedbackTarget(item: ThreadFeedback, payload: Omit<ThreadFeedback, "id" | "createdAt">): boolean {
  if (!item.messageId || !payload.messageId || item.messageId !== payload.messageId) return false;
  if (item.userId && payload.userId && item.userId !== payload.userId) return false;
  return true;
}

function mapMessageRow(row: MessageRow): StoredMessageItem {
  return {
    parentId: row.parentId ?? null,
    message: normalizeAssistantMessageContentOrder(row.content),
    runConfig: asRecord(row.runConfig) ?? undefined,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt)
  };
}

function mapThreadStatusFromDb(value: string | null | undefined): ThreadStatus {
  return value === "archived" ? "archived" : "regular";
}

function mapThreadStatusToDb(value: ThreadStatus | undefined): "active" | "archived" | undefined {
  if (value === undefined) return undefined;
  return value === "archived" ? "archived" : "active";
}

function trimOrUndefined(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function persistedExternalIds(items: StoredMessageItem[]): Array<string | null> {
  const seen = new Set<string>();
  return items.map((item) => {
    const incomingId = messageIdOf(item.message);
    if (!incomingId || seen.has(incomingId)) {
      return null;
    }
    seen.add(incomingId);
    return incomingId;
  });
}

type ConversationJsonSanitizeContext = {
  threadId: string;
  operation: string;
  field: string;
  channel?: string;
  runId?: string;
};

function sanitizeConversationJson<T>(value: T, context: ConversationJsonSanitizeContext): T {
  const sanitized = sanitizeJsonForPostgres(value);
  if (sanitized.replacementCount > 0) {
    console.warn("agent_studio_conversation_json_sanitized", {
      threadId: context.threadId,
      operation: context.operation,
      field: context.field,
      channel: context.channel,
      runId: context.runId,
      replacementCount: sanitized.replacementCount
    });
  }
  return sanitized.value;
}

function sanitizeStoredMessageItem(
  item: StoredMessageItem,
  context: Omit<ConversationJsonSanitizeContext, "field">
): StoredMessageItem {
  const message = sanitizeConversationJson(item.message, { ...context, field: "message.content" });
  const runConfig = sanitizeConversationJson(item.runConfig, { ...context, field: "message.runConfig" });
  if (message === item.message && runConfig === item.runConfig) return item;
  return {
    ...item,
    message,
    runConfig
  };
}

export class ThreadRepository {
  constructor(private readonly db: ThreadRepositoryDb) {}

  async count(): Promise<number> {
    return this.db.thread.count();
  }

  async list(organizationId?: string, includeArchived = false): Promise<ThreadRecord[]> {
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    const rows = await this.db.thread.findMany({
      where: {
        workspaceTrashBatchId: null,
        ...(includeArchived ? {} : { status: "active" }),
        ...(normalizedOrganizationId ? { organizationId: normalizedOrganizationId } : {})
      },
      orderBy: { updatedAt: "desc" }
    });
    return Promise.all(rows.map(async (row) => this.loadThreadRecord(this.db, row)));
  }

  async listForUser(userId: string, organizationId?: string, includeArchived = false): Promise<ThreadRecord[]> {
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    const rows = await this.db.thread.findMany({
      where: {
        userId,
        workspaceTrashBatchId: null,
        ...(normalizedOrganizationId ? { organizationId: normalizedOrganizationId } : {}),
        ...(includeArchived ? {} : { status: "active" })
      },
      orderBy: { updatedAt: "desc" }
    });
    return Promise.all(rows.map(async (row) => this.loadThreadRecord(this.db, row)));
  }

  async listForUserInSecurityDomain(
    userId: string,
    organizationId: string,
    securityDomainId: string | null,
    includeArchived = false
  ): Promise<ThreadRecord[]> {
    const rows = await this.db.thread.findMany({
      where: {
        userId,
        organizationId,
        securityDomainId,
        workspaceTrashBatchId: null,
        ...(includeArchived ? {} : { status: "active" })
      },
      orderBy: { updatedAt: "desc" }
    });
    return Promise.all(rows.map(async (row) => this.loadThreadRecord(this.db, row)));
  }

  async create(payload: CreateThreadPayload): Promise<ThreadRecord> {
    const title = trimOrUndefined(payload.title);
    const codexRunConfig = sanitizeConversationJson(payload.codexRunConfig, {
      threadId: payload.id ?? "pending",
      operation: "createThread",
      field: "thread.codexRunConfig",
      channel: payload.channel
    });
    const feedback = sanitizeConversationJson(payload.feedback ?? [], {
      threadId: payload.id ?? "pending",
      operation: "createThread",
      field: "thread.feedback",
      channel: payload.channel
    });
    const created = await this.db.thread.create({
      data: {
        id: payload.id,
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        userId: trimOrUndefined(payload.userId) ?? null,
        securityDomainId: trimOrUndefined(payload.securityDomainId) ?? null,
        userWorkspaceId: trimOrUndefined(payload.userWorkspaceId) ?? null,
        workspaceFolderId: trimOrUndefined(payload.workspaceFolderId) ?? null,
        channel: trimOrUndefined(payload.channel) ?? null,
        externalId: trimOrUndefined(payload.externalId) ?? null,
        title: title ?? null,
        status: mapThreadStatusToDb(payload.status) ?? "active",
        model: payload.model,
        reasoningEffort: payload.reasoningEffort,
        workspace: payload.workspace,
        codexRunConfig: codexRunConfig ?? null,
        codexThreadId: trimOrUndefined(payload.codexThreadId) ?? null,
        headId: payload.headId ?? null,
        feedback,
        createdAt: toDate(payload.createdAt),
        updatedAt: toDate(payload.updatedAt)
      }
    });
    return this.loadThreadRecord(this.db, created, []);
  }

  async importThread(record: ThreadRecord): Promise<ThreadRecord> {
    const existing = await this.db.thread.findUnique({ where: { id: record.id } });
    if (existing) {
      return this.loadThreadRecord(this.db, existing);
    }

    return this.db.$transaction(async (tx) => {
      const normalizedMessages = record.messages.map((item) =>
        sanitizeStoredMessageItem(
          {
            ...item,
            message: normalizeAssistantMessageContentOrder(item.message)
          },
          {
            threadId: record.id,
            operation: "importThread",
            channel: record.channel
          }
        )
      );
      const externalIds = persistedExternalIds(normalizedMessages);
      const codexRunConfig = sanitizeConversationJson(record.codexRunConfig, {
        threadId: record.id,
        operation: "importThread",
        field: "thread.codexRunConfig",
        channel: record.channel
      });
      const feedback = sanitizeConversationJson(record.feedback, {
        threadId: record.id,
        operation: "importThread",
        field: "thread.feedback",
        channel: record.channel
      });
      const created = await tx.thread.create({
        data: {
          id: record.id,
          organizationId: trimOrUndefined(record.organizationId) ?? null,
          userId: trimOrUndefined(record.userId) ?? null,
          securityDomainId: trimOrUndefined(record.securityDomainId) ?? null,
          userWorkspaceId: trimOrUndefined(record.userWorkspaceId) ?? null,
          workspaceFolderId: trimOrUndefined(record.workspaceFolderId) ?? null,
          channel: trimOrUndefined(record.channel) ?? null,
          externalId: record.externalId ?? null,
          title: record.title ?? null,
          status: mapThreadStatusToDb(record.status) ?? "active",
          model: record.model,
          reasoningEffort: record.reasoningEffort,
          workspace: record.workspace,
          codexRunConfig: codexRunConfig ?? null,
          codexThreadId: trimOrUndefined(record.codexThreadId) ?? null,
          headId: record.headId ?? null,
          feedback,
          createdAt: toDate(record.createdAt),
          updatedAt: toDate(record.updatedAt)
        }
      });

      for (const [index, item] of normalizedMessages.entries()) {
        const createdAt = resolvedMessageCreatedAt(item, toDate(record.createdAt));
        await tx.message.create({
          data: {
            id: randomUUID(),
            threadId: record.id,
            externalId: externalIds[index] ?? null,
            role: normalizeMessageRole(item.message),
            content: item.message,
            parentId: item.parentId,
            runConfig: item.runConfig ?? null,
            position: index,
            createdAt,
            updatedAt: resolvedMessageUpdatedAt(item, createdAt)
          }
        });
      }

      return this.loadThreadRecord(tx, created, normalizedMessages);
    });
  }

  async get(threadId: string, organizationId?: string): Promise<ThreadRecord | undefined> {
    const row = await this.db.thread.findUnique({ where: { id: threadId } });
    if (!row) return undefined;
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    if (normalizedOrganizationId && trimOrUndefined(row.organizationId ?? undefined) !== normalizedOrganizationId) {
      return undefined;
    }
    return this.loadThreadRecord(this.db, row);
  }

  async getByExternalId(externalId: string, organizationId?: string): Promise<ThreadRecord | undefined> {
    const normalizedExternalId = trimOrUndefined(externalId);
    if (!normalizedExternalId) return undefined;
    const row = await this.db.thread.findUnique({ where: { externalId: normalizedExternalId } });
    if (!row) return undefined;
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    if (normalizedOrganizationId && trimOrUndefined(row.organizationId ?? undefined) !== normalizedOrganizationId) {
      return undefined;
    }
    return this.loadThreadRecord(this.db, row);
  }

  async getOwned(threadId: string, userId: string, organizationId?: string): Promise<ThreadRecord | undefined> {
    const thread = await this.get(threadId, organizationId);
    if (!thread || thread.userId !== userId) {
      return undefined;
    }
    return thread;
  }

  async update(threadId: string, patch: UpdateThreadPayload): Promise<ThreadRecord> {
    await this.requireThread(threadId);
    const data: Record<string, unknown> = {};

    if (patch.status !== undefined) data.status = mapThreadStatusToDb(patch.status);
    if (patch.title !== undefined) data.title = trimOrUndefined(patch.title) ?? null;
    if (patch.model !== undefined) data.model = patch.model;
    if (patch.reasoningEffort !== undefined) data.reasoningEffort = patch.reasoningEffort;
    if (patch.workspace !== undefined) data.workspace = patch.workspace;
    if (patch.userWorkspaceId !== undefined) {
      data.userWorkspaceId = trimOrUndefined(patch.userWorkspaceId ?? undefined) ?? null;
    }
    if (patch.workspaceFolderId !== undefined) {
      data.workspaceFolderId = trimOrUndefined(patch.workspaceFolderId ?? undefined) ?? null;
    }
    if (patch.codexRunConfig !== undefined) {
      data.codexRunConfig =
        sanitizeConversationJson(patch.codexRunConfig, {
          threadId,
          operation: "updateThread",
          field: "thread.codexRunConfig"
        }) ?? null;
    }
    if (patch.codexThreadId !== undefined) data.codexThreadId = trimOrUndefined(patch.codexThreadId) ?? null;
    if (patch.headId !== undefined) data.headId = patch.headId;
    data.updatedAt = new Date();

    await this.db.thread.update({
      where: { id: threadId },
      data
    });

    return this.requireThread(threadId);
  }

  async delete(threadId: string): Promise<void> {
    await this.db.$transaction(async (tx) => {
      const existing = await tx.thread.findUnique({ where: { id: threadId } });
      if (!existing) {
        return;
      }
      await tx.runtimeSession.deleteMany({ where: { threadId } });
      await tx.message.deleteMany({ where: { threadId } });
      await tx.thread.delete({ where: { id: threadId } });
    });
  }

  async claimTurnDelivery(input: ConversationTurnDeliveryClaim): Promise<ConversationTurnDeliveryResult> {
    return this.db.$transaction(async (tx) => {
      await lockThreadMessages(tx, input.threadId);
      const thread = await tx.thread.findUnique({ where: { id: input.threadId } });
      if (!thread) throw new Error("Thread does not exist");
      const messages = await tx.message.findMany({
        where: { threadId: input.threadId },
        orderBy: { position: "asc" }
      });
      const userMessage = messages.find((message) => message.externalId === input.userMessageId);
      if (!userMessage || normalizeMessageRole(userMessage.content) !== "user") {
        throw new Error("Turn delivery requires an existing user message");
      }

      const acceptedAt = trimOrUndefined(input.acceptedAt) ?? new Date().toISOString();
      const current = storedTurnDelivery(userMessage.runConfig);
      if (current?.runId === input.runId) {
        return {
          outcome: "already_claimed",
          runId: input.runId,
          latestRunId: current.runId,
          assistantMessageId: current.assistantMessageId
        };
      }
      if (current && acceptedAtMs(current.acceptedAt) >= acceptedAtMs(acceptedAt)) {
        return {
          outcome: "superseded",
          runId: input.runId,
          latestRunId: current.runId,
          assistantMessageId: current.assistantMessageId
        };
      }

      const runConfig = sanitizeConversationJson(
        withStoredTurnDelivery(userMessage.runConfig, {
          runId: input.runId,
          channel: input.channel,
          acceptedAt,
          status: "running"
        }),
        {
          threadId: input.threadId,
          operation: "claimTurnDelivery",
          field: "message.runConfig",
          channel: input.channel,
          runId: input.runId
        }
      );
      await tx.message.update({
        where: { id: userMessage.id },
        data: {
          runConfig,
          updatedAt: new Date()
        }
      });
      return {
        outcome: "claimed",
        runId: input.runId,
        latestRunId: input.runId
      };
    });
  }

  async finalizeTurnDelivery(input: ConversationTurnDeliveryFinalize): Promise<ConversationTurnDeliveryResult> {
    return this.db.$transaction(async (tx) => {
      const normalizedAssistant = sanitizeStoredMessageItem(
        {
          ...input.assistant,
          parentId: input.userMessageId,
          message: normalizeAssistantMessageContentOrder(input.assistant.message)
        },
        {
          threadId: input.threadId,
          operation: "finalizeTurnDelivery",
          channel: input.channel,
          runId: input.runId
        }
      );
      const assistantMessageId = messageIdOf(normalizedAssistant.message);
      if (!assistantMessageId) throw new Error("Turn delivery assistant requires a message id");

      await lockThreadMessages(tx, input.threadId);
      const thread = await tx.thread.findUnique({ where: { id: input.threadId } });
      if (!thread) throw new Error("Thread does not exist");
      const messages = await tx.message.findMany({
        where: { threadId: input.threadId },
        orderBy: { position: "asc" }
      });
      const userMessage = messages.find((message) => message.externalId === input.userMessageId);
      if (!userMessage || normalizeMessageRole(userMessage.content) !== "user") {
        throw new Error("Turn delivery requires an existing user message");
      }

      const current = storedTurnDelivery(userMessage.runConfig);
      const requestedAcceptedAt = trimOrUndefined(input.acceptedAt);
      if (current && current.runId !== input.runId && !requestedAcceptedAt) {
        return {
          outcome: "superseded",
          runId: input.runId,
          latestRunId: current.runId,
          assistantMessageId: current.assistantMessageId
        };
      }
      const acceptedAt = requestedAcceptedAt ?? current?.acceptedAt ?? new Date().toISOString();
      if (current && current.runId !== input.runId && acceptedAtMs(current.acceptedAt) >= acceptedAtMs(acceptedAt)) {
        return {
          outcome: "superseded",
          runId: input.runId,
          latestRunId: current.runId,
          assistantMessageId: current.assistantMessageId
        };
      }

      const delivery: StoredTurnDelivery = {
        runId: input.runId,
        channel: input.channel,
        acceptedAt,
        status: input.status,
        assistantMessageId,
        completedAt: new Date().toISOString()
      };
      const assistantRunConfig = sanitizeConversationJson(
        withStoredTurnDelivery(normalizedAssistant.runConfig, delivery),
        {
          threadId: input.threadId,
          operation: "finalizeTurnDelivery",
          field: "message.runConfig",
          channel: input.channel,
          runId: input.runId
        }
      );
      const existingAssistant = messages.find((message) => {
        if (message.parentId !== input.userMessageId || normalizeMessageRole(message.content) !== "assistant") return false;
        const existingDelivery = storedTurnDelivery(message.runConfig);
        return existingDelivery?.runId === input.runId || message.externalId === assistantMessageId;
      });

      if (existingAssistant) {
        await tx.message.update({
          where: { id: existingAssistant.id },
          data: {
            role: normalizeMessageRole(normalizedAssistant.message),
            content: normalizedAssistant.message,
            parentId: input.userMessageId,
            runConfig: assistantRunConfig,
            updatedAt: new Date()
          }
        });
      } else {
        const position = messages.reduce((maximum, message) => Math.max(maximum, message.position), -1) + 1;
        const createdAt = resolvedMessageCreatedAt(normalizedAssistant);
        await tx.message.create({
          data: {
            id: randomUUID(),
            threadId: input.threadId,
            externalId: assistantMessageId,
            role: normalizeMessageRole(normalizedAssistant.message),
            content: normalizedAssistant.message,
            parentId: input.userMessageId,
            runConfig: assistantRunConfig,
            position,
            createdAt,
            updatedAt: resolvedMessageUpdatedAt(normalizedAssistant, createdAt)
          }
        });
      }

      const userRunConfig = sanitizeConversationJson(withStoredTurnDelivery(userMessage.runConfig, delivery), {
        threadId: input.threadId,
        operation: "finalizeTurnDelivery",
        field: "message.runConfig",
        channel: input.channel,
        runId: input.runId
      });
      await tx.message.update({
        where: { id: userMessage.id },
        data: {
          runConfig: userRunConfig,
          updatedAt: new Date()
        }
      });
      const existingAssistantId = existingAssistant?.externalId ?? assistantMessageId;
      const currentHead = messages.find((message) => message.externalId === thread.headId);
      const headIsAssistantForSameTurn =
        currentHead?.parentId === input.userMessageId && normalizeMessageRole(currentHead.content) === "assistant";
      const shouldAdvanceHead =
        thread.headId === input.userMessageId || thread.headId === existingAssistantId || headIsAssistantForSameTurn;
      await tx.thread.update({
        where: { id: input.threadId },
        data: {
          ...(shouldAdvanceHead ? { headId: existingAssistantId } : {}),
          updatedAt: new Date()
        }
      });

      return {
        outcome: existingAssistant ? "already_persisted" : "persisted",
        runId: input.runId,
        latestRunId: input.runId,
        assistantMessageId: existingAssistantId
      };
    });
  }

  async appendMessage(threadId: string, item: StoredMessageItem): Promise<ThreadRecord> {
    return this.db.$transaction(async (tx) => {
      const normalizedItem = sanitizeStoredMessageItem(
        {
          ...item,
          message: normalizeAssistantMessageContentOrder(item.message)
        },
        {
          threadId,
          operation: "appendMessage"
        }
      );
      await lockThreadMessages(tx, threadId);
      const thread = await tx.thread.findUnique({ where: { id: threadId } });
      if (!thread) throw new Error("Thread does not exist");

      const messages = await tx.message.findMany({
        where: { threadId },
        orderBy: { position: "asc" }
      });
      const incomingId = messageIdOf(normalizedItem.message);
      const position = messages.reduce((maximum, message) => Math.max(maximum, message.position), -1) + 1;
      assertIncomingMessageGraph(messages, normalizedItem);

      if (incomingId) {
        const existing = messages.find((message) => message.externalId === incomingId);
        if (existing) {
          await tx.message.update({
            where: { id: existing.id },
            data: {
              role: normalizeMessageRole(normalizedItem.message),
              content: normalizedItem.message,
              parentId: normalizedItem.parentId,
              runConfig: normalizedItem.runConfig ?? null,
              updatedAt: new Date()
            }
          });
        } else {
          const createdAt = resolvedMessageCreatedAt(normalizedItem);
          await tx.message.create({
            data: {
              id: randomUUID(),
              threadId,
              externalId: incomingId,
              role: normalizeMessageRole(normalizedItem.message),
              content: normalizedItem.message,
              parentId: normalizedItem.parentId,
              runConfig: normalizedItem.runConfig ?? null,
              position,
              createdAt,
              updatedAt: resolvedMessageUpdatedAt(normalizedItem, createdAt)
            }
          });
        }
        await tx.thread.update({
          where: { id: threadId },
          data: {
            headId: incomingId,
            updatedAt: new Date()
          }
        });
      } else {
        const createdAt = resolvedMessageCreatedAt(normalizedItem);
        await tx.message.create({
          data: {
            id: randomUUID(),
            threadId,
            externalId: null,
            role: normalizeMessageRole(normalizedItem.message),
            content: normalizedItem.message,
            parentId: normalizedItem.parentId,
            runConfig: normalizedItem.runConfig ?? null,
            position,
            createdAt,
            updatedAt: resolvedMessageUpdatedAt(normalizedItem, createdAt)
          }
        });
        await tx.thread.update({
          where: { id: threadId },
          data: {
            updatedAt: new Date()
          }
        });
      }

      return this.requireThread(threadId, tx);
    });
  }

  async replaceMessages(
    threadId: string,
    repository: { headId?: string | null; messages: StoredMessageItem[] }
  ): Promise<ThreadRecord> {
    return this.db.$transaction(async (tx) => {
      await lockThreadMessages(tx, threadId);
      const thread = await tx.thread.findUnique({ where: { id: threadId } });
      if (!thread) throw new Error("Thread does not exist");

      const normalizedMessages = repository.messages.map((item) =>
        sanitizeStoredMessageItem(
          {
            ...item,
            message: normalizeAssistantMessageContentOrder(item.message)
          },
          {
            threadId,
            operation: "replaceMessages"
          }
        )
      );
      assertMessageGraphForPersistence(normalizedMessages);
      await tx.message.deleteMany({ where: { threadId } });
      const externalIds = persistedExternalIds(normalizedMessages);
      for (const [index, item] of normalizedMessages.entries()) {
        const createdAt = resolvedMessageCreatedAt(item);
        await tx.message.create({
          data: {
            id: randomUUID(),
            threadId,
            externalId: externalIds[index] ?? null,
            role: normalizeMessageRole(item.message),
            content: item.message,
            parentId: item.parentId,
            runConfig: item.runConfig ?? null,
            position: index,
            createdAt,
            updatedAt: resolvedMessageUpdatedAt(item, createdAt)
          }
        });
      }

      await tx.thread.update({
        where: { id: threadId },
        data: {
          headId: repository.headId ?? null,
          updatedAt: new Date()
        }
      });

      return this.requireThread(threadId, tx);
    });
  }

  async getRepository(threadId: string): Promise<{ headId?: string | null; messages: StoredMessageItem[] }> {
    const thread = await this.db.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new Error("Thread does not exist");
    const messages = await this.db.message.findMany({
      where: { threadId },
      orderBy: { position: "asc" }
    });
    return {
      headId: thread.headId ?? null,
      messages: messages.map(mapMessageRow)
    };
  }

  async addFeedback(
    threadId: string,
    payload: Omit<ThreadFeedback, "id" | "createdAt">
  ): Promise<ThreadFeedback> {
    const thread = await this.db.thread.findUnique({ where: { id: threadId } });
    if (!thread) throw new Error("Thread does not exist");

    const now = new Date().toISOString();
    const currentFeedback = normalizeFeedback(thread.feedback);
    const existing = currentFeedback.find((item) => matchesFeedbackTarget(item, payload));
    const rawComment = typeof payload.comment === "string" ? payload.comment : undefined;
    const hasComment = rawComment !== undefined;
    const normalizedComment = rawComment?.trim() ? rawComment.trim() : undefined;
    const comment = payload.type === "negative" ? (hasComment ? normalizedComment : existing?.comment) : undefined;
    const feedback: ThreadFeedback = {
      id: existing?.id ?? randomUUID(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: existing ? now : undefined,
      type: payload.type,
      messageId: payload.messageId,
      contentPreview: payload.contentPreview,
      comment,
      userId: payload.userId
    };
    const nextFeedback = currentFeedback.filter((item) => !matchesFeedbackTarget(item, payload));

    const sanitizedFeedback = sanitizeConversationJson([...nextFeedback, feedback], {
      threadId,
      operation: "addFeedback",
      field: "thread.feedback"
    });
    await this.db.thread.update({
      where: { id: threadId },
      data: {
        feedback: sanitizedFeedback,
        updatedAt: new Date()
      }
    });

    return sanitizedFeedback[sanitizedFeedback.length - 1] ?? feedback;
  }

  private async requireThread(threadId: string, db: ThreadRepositoryDb = this.db): Promise<ThreadRecord> {
    const row = await db.thread.findUnique({ where: { id: threadId } });
    if (!row) throw new Error("Thread does not exist");
    return this.loadThreadRecord(db, row);
  }

  private async loadThreadRecord(
    db: ThreadRepositoryDb,
    row: ThreadRow,
    preloadedMessages?: StoredMessageItem[]
  ): Promise<ThreadRecord> {
    const [messages, activeSession] = await Promise.all([
      preloadedMessages
        ? Promise.resolve(preloadedMessages)
        : db.message
            .findMany({
              where: { threadId: row.id },
              orderBy: { position: "asc" }
            })
            .then((items) => items.map(mapMessageRow)),
      db.runtimeSession.findFirst({
        where: { threadId: row.id, status: "active" },
        orderBy: { updatedAt: "desc" }
      })
    ]);

    return {
      id: row.id,
      organizationId: trimOrUndefined(row.organizationId ?? undefined),
      userId: row.userId ?? undefined,
      securityDomainId: trimOrUndefined(row.securityDomainId ?? undefined),
      userWorkspaceId: trimOrUndefined(row.userWorkspaceId ?? undefined),
      workspaceFolderId: trimOrUndefined(row.workspaceFolderId ?? undefined),
      channel: trimOrUndefined(row.channel ?? undefined),
      externalId: row.externalId ?? undefined,
      status: mapThreadStatusFromDb(row.status),
      title: row.title ?? undefined,
      model: row.model ?? "",
      reasoningEffort: (row.reasoningEffort ?? "high") as ReasoningEffort,
      workspace: row.workspace ?? "",
      codexRunConfig: asRecord(row.codexRunConfig) ?? undefined,
      codexThreadId: trimOrUndefined(row.codexThreadId ?? undefined),
      sessionId: activeSession?.externalId ?? undefined,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      headId: row.headId ?? null,
      messages,
      feedback: normalizeFeedback(row.feedback)
    };
  }
}
