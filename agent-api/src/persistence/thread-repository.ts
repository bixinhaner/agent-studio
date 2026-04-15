import { randomUUID } from "node:crypto";

import type { ReasoningEffort } from "../model-config.js";

export type ThreadStatus = "regular" | "archived";
export type { ReasoningEffort } from "../model-config.js";

export type StoredMessageItem = {
  parentId: string | null;
  message: unknown;
  runConfig?: Record<string, unknown>;
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
  externalId?: string;
  status: ThreadStatus;
  title?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
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
  title?: string;
  externalId?: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
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
  codexRunConfig: Record<string, unknown> | undefined;
  sessionId: string | undefined;
  headId: string | null;
}>;

type ThreadRow = {
  id: string;
  organizationId: string | null;
  userId: string | null;
  externalId: string | null;
  title: string | null;
  status: string | null;
  model: string | null;
  reasoningEffort: string | null;
  workspace: string | null;
  codexRunConfig: unknown;
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
  findUnique(args: { where: { id: string } }): Promise<ThreadRow | null>;
  findMany(args?: {
    where?: { status?: "active" | "archived"; userId?: string | null; organizationId?: string | null };
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
  $transaction<T>(callback: (tx: ThreadRepositoryDb) => Promise<T>): Promise<T>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function messageIdOf(message: unknown): string | null {
  const obj = asRecord(message);
  if (!obj) return null;
  const id = obj.id;
  return typeof id === "string" && id.trim() ? id.trim() : null;
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
    message: row.content,
    runConfig: asRecord(row.runConfig) ?? undefined
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

export class ThreadRepository {
  constructor(private readonly db: ThreadRepositoryDb) {}

  async count(): Promise<number> {
    return this.db.thread.count();
  }

  async list(organizationId?: string, includeArchived = false): Promise<ThreadRecord[]> {
    const normalizedOrganizationId = trimOrUndefined(organizationId);
    const rows = await this.db.thread.findMany({
      where: {
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
        ...(normalizedOrganizationId ? { organizationId: normalizedOrganizationId } : {}),
        ...(includeArchived ? {} : { status: "active" })
      },
      orderBy: { updatedAt: "desc" }
    });
    return Promise.all(rows.map(async (row) => this.loadThreadRecord(this.db, row)));
  }

  async create(payload: CreateThreadPayload): Promise<ThreadRecord> {
    const title = trimOrUndefined(payload.title);
    const created = await this.db.thread.create({
      data: {
        id: payload.id,
        organizationId: trimOrUndefined(payload.organizationId) ?? null,
        userId: trimOrUndefined(payload.userId) ?? null,
        externalId: trimOrUndefined(payload.externalId) ?? null,
        title: title ?? null,
        status: mapThreadStatusToDb(payload.status) ?? "active",
        model: payload.model,
        reasoningEffort: payload.reasoningEffort,
        workspace: payload.workspace,
        codexRunConfig: payload.codexRunConfig ?? null,
        headId: payload.headId ?? null,
        feedback: payload.feedback ?? [],
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
      const externalIds = persistedExternalIds(record.messages);
      const created = await tx.thread.create({
        data: {
          id: record.id,
          organizationId: trimOrUndefined(record.organizationId) ?? null,
          userId: trimOrUndefined(record.userId) ?? null,
          externalId: record.externalId ?? null,
          title: record.title ?? null,
          status: mapThreadStatusToDb(record.status) ?? "active",
          model: record.model,
          reasoningEffort: record.reasoningEffort,
          workspace: record.workspace,
          codexRunConfig: record.codexRunConfig ?? null,
          headId: record.headId ?? null,
          feedback: record.feedback,
          createdAt: toDate(record.createdAt),
          updatedAt: toDate(record.updatedAt)
        }
      });

      for (const [index, item] of record.messages.entries()) {
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
            createdAt: toDate(record.createdAt),
            updatedAt: toDate(record.updatedAt)
          }
        });
      }

      return this.loadThreadRecord(tx, created, record.messages);
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
    if (patch.codexRunConfig !== undefined) data.codexRunConfig = patch.codexRunConfig ?? null;
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

  async appendMessage(threadId: string, item: StoredMessageItem): Promise<ThreadRecord> {
    return this.db.$transaction(async (tx) => {
      const thread = await tx.thread.findUnique({ where: { id: threadId } });
      if (!thread) throw new Error("Thread does not exist");

      const messages = await tx.message.findMany({
        where: { threadId },
        orderBy: { position: "asc" }
      });
      const incomingId = messageIdOf(item.message);
      const position = messages.length;

      if (incomingId) {
        const existing = messages.find((message) => message.externalId === incomingId);
        if (existing) {
          await tx.message.update({
            where: { id: existing.id },
            data: {
              role: normalizeMessageRole(item.message),
              content: item.message,
              parentId: item.parentId,
              runConfig: item.runConfig ?? null,
              updatedAt: new Date()
            }
          });
        } else {
          await tx.message.create({
            data: {
              id: randomUUID(),
              threadId,
              externalId: incomingId,
              role: normalizeMessageRole(item.message),
              content: item.message,
              parentId: item.parentId,
              runConfig: item.runConfig ?? null,
              position,
              createdAt: new Date(),
              updatedAt: new Date()
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
        await tx.message.create({
          data: {
            id: randomUUID(),
            threadId,
            externalId: null,
            role: normalizeMessageRole(item.message),
            content: item.message,
            parentId: item.parentId,
            runConfig: item.runConfig ?? null,
            position,
            createdAt: new Date(),
            updatedAt: new Date()
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
      const thread = await tx.thread.findUnique({ where: { id: threadId } });
      if (!thread) throw new Error("Thread does not exist");

      await tx.message.deleteMany({ where: { threadId } });
      const externalIds = persistedExternalIds(repository.messages);
      for (const [index, item] of repository.messages.entries()) {
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
            createdAt: new Date(),
            updatedAt: new Date()
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

    await this.db.thread.update({
      where: { id: threadId },
      data: {
        feedback: [...nextFeedback, feedback],
        updatedAt: new Date()
      }
    });

    return feedback;
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
      externalId: row.externalId ?? undefined,
      status: mapThreadStatusFromDb(row.status),
      title: row.title ?? undefined,
      model: row.model ?? "",
      reasoningEffort: (row.reasoningEffort ?? "high") as ReasoningEffort,
      workspace: row.workspace ?? "",
      codexRunConfig: asRecord(row.codexRunConfig) ?? undefined,
      sessionId: activeSession?.externalId ?? undefined,
      createdAt: toIsoString(row.createdAt),
      updatedAt: toIsoString(row.updatedAt),
      headId: row.headId ?? null,
      messages,
      feedback: normalizeFeedback(row.feedback)
    };
  }
}
