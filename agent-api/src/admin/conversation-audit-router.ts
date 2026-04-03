import { Router, type Request, type Response } from "express";

import { getDbClient } from "../db/client.js";
import {
  ThreadRepository,
  type StoredMessageItem,
  type ThreadFeedback,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "../persistence/thread-repository.js";

type ConversationAuditUserRow = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
};

type ConversationAuditDb = ThreadRepositoryDb & {
  user: {
    findMany(args?: { orderBy?: { createdAt: "asc" | "desc" } }): Promise<ConversationAuditUserRow[]>;
    findUnique(args: { where: { id: string } }): Promise<ConversationAuditUserRow | null>;
  };
};

type ConversationStatusFilter = "all" | "regular" | "archived";
type ConversationFeedbackFilter = "all" | "with_feedback" | "positive" | "negative" | "none";
type ConversationSort = "updated_desc" | "created_desc";

type ConversationAuditUser = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

type ConversationTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  parentId: string | null;
  createdAt: string | null;
  hasRunConfig: boolean;
};

type ConversationSummary = {
  id: string;
  externalId: string | null;
  title: string;
  status: ThreadRecord["status"];
  model: string;
  reasoningEffort: string;
  workspace: string;
  activeSession: boolean;
  createdAt: string;
  updatedAt: string;
  user: ConversationAuditUser | null;
  metrics: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    feedbackCount: number;
  };
  preview: {
    firstUserText: string | null;
    latestText: string | null;
  };
  feedbackSummary: {
    total: number;
    positive: number;
    negative: number;
    latestAt: string | null;
  };
  feedback: Array<{
    id: string;
    type: ThreadFeedback["type"];
    messageId: string | null;
    contentPreview: string | null;
    createdAt: string;
  }>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function parseDateString(value: unknown): string | null {
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "number") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
  }
  return null;
}

function summarizeText(value: string | null | undefined, limit = 180): string | null {
  const normalized = trimOrUndefined(value);
  if (!normalized) return null;
  if (normalized.length <= limit) return normalized;
  return `${normalized.slice(0, Math.max(0, limit - 1)).trimEnd()}…`;
}

function parsePositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  const normalized = Math.trunc(numeric);
  if (normalized < min) return min;
  if (normalized > max) return max;
  return normalized;
}

function parseStatusFilter(value: unknown): ConversationStatusFilter {
  return value === "regular" || value === "archived" ? value : "all";
}

function parseFeedbackFilter(value: unknown): ConversationFeedbackFilter {
  return value === "with_feedback" ||
    value === "positive" ||
    value === "negative" ||
    value === "none"
    ? value
    : "all";
}

function parseSort(value: unknown): ConversationSort {
  return value === "created_desc" ? value : "updated_desc";
}

function normalizeUser(row: ConversationAuditUserRow | null | undefined): ConversationAuditUser | null {
  if (!row) return null;
  return {
    id: row.id,
    displayName: trimOrUndefined(row.displayName) ?? null,
    email: trimOrUndefined(row.email) ?? null,
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active"
  };
}

function extractMessageRole(message: unknown): ConversationTranscriptMessage["role"] {
  const obj = asRecord(message);
  const role = typeof obj?.role === "string" ? obj.role.trim() : "";
  if (role === "user" || role === "assistant" || role === "system" || role === "tool") {
    return role;
  }
  return "system";
}

function extractMessageId(message: unknown, fallback: string): string {
  const obj = asRecord(message);
  return trimOrUndefined(obj?.id) ?? fallback;
}

function collectTextParts(value: unknown): string[] {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed ? [trimmed] : [];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectTextParts(item));
  }

  const obj = asRecord(value);
  if (!obj) return [];

  if (Array.isArray(obj.content)) {
    const items = obj.content.flatMap((item) => {
      const part = asRecord(item);
      if (!part) return collectTextParts(item);
      const type = trimOrUndefined(part.type);
      if (type === "source") {
        return [];
      }
      if (typeof part.text === "string" && part.text.trim()) {
        return [part.text.trim()];
      }
      if (typeof part.content === "string" && part.content.trim()) {
        return [part.content.trim()];
      }
      return collectTextParts(part.content);
    });
    return items.filter(Boolean);
  }

  if (typeof obj.content === "string" && obj.content.trim()) {
    return [obj.content.trim()];
  }
  if (typeof obj.text === "string" && obj.text.trim()) {
    return [obj.text.trim()];
  }

  return [];
}

function extractMessageText(message: unknown): string {
  return collectTextParts(message).join("\n\n").trim();
}

function extractMessageCreatedAt(message: unknown): string | null {
  const obj = asRecord(message);
  return parseDateString(obj?.createdAt) ?? parseDateString(obj?.created_at);
}

function toTranscriptMessage(item: StoredMessageItem, index: number): ConversationTranscriptMessage {
  return {
    id: extractMessageId(item.message, `message-${index + 1}`),
    role: extractMessageRole(item.message),
    text: extractMessageText(item.message),
    parentId: item.parentId ?? null,
    createdAt: extractMessageCreatedAt(item.message),
    hasRunConfig: Boolean(item.runConfig && Object.keys(item.runConfig).length > 0)
  };
}

function feedbackCountOf(feedback: ConversationSummary["feedback"], type: ThreadFeedback["type"]): number {
  return feedback.filter((item) => item.type === type).length;
}

function latestFeedbackAt(feedback: ConversationSummary["feedback"]): string | null {
  const values = feedback
    .map((item) => parseDateString(item.createdAt))
    .filter((item): item is string => Boolean(item))
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return values[0] ?? null;
}

function conversationTitle(thread: ThreadRecord, firstUserText: string | null): string {
  const explicit = trimOrUndefined(thread.title);
  if (explicit) return explicit;
  return summarizeText(firstUserText, 56) ?? `Thread ${thread.id.slice(0, 8)}`;
}

function normalizeFeedback(feedback: ThreadRecord["feedback"]): ConversationSummary["feedback"] {
  return feedback
    .slice()
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
    .map((item) => ({
      id: item.id,
      type: item.type,
      messageId: trimOrUndefined(item.messageId) ?? null,
      contentPreview: summarizeText(item.contentPreview, 240),
      createdAt: item.createdAt
    }));
}

function buildConversationSummary(thread: ThreadRecord, user: ConversationAuditUser | null): ConversationSummary {
  const transcript = thread.messages.map((item, index) => toTranscriptMessage(item, index));
  const userMessages = transcript.filter((item) => item.role === "user");
  const assistantMessages = transcript.filter((item) => item.role === "assistant");
  const firstUserText = summarizeText(userMessages.find((item) => item.text)?.text, 180);
  const latestText = summarizeText(
    [...transcript]
      .reverse()
      .find((item) => item.text)?.text,
    240
  );
  const feedback = normalizeFeedback(thread.feedback);

  return {
    id: thread.id,
    externalId: trimOrUndefined(thread.externalId) ?? null,
    title: conversationTitle(thread, firstUserText),
    status: thread.status,
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    workspace: thread.workspace,
    activeSession: Boolean(thread.sessionId),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    user,
    metrics: {
      messageCount: transcript.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      feedbackCount: feedback.length
    },
    preview: {
      firstUserText,
      latestText
    },
    feedbackSummary: {
      total: feedback.length,
      positive: feedbackCountOf(feedback, "positive"),
      negative: feedbackCountOf(feedback, "negative"),
      latestAt: latestFeedbackAt(feedback)
    },
    feedback
  };
}

function matchesStatusFilter(summary: ConversationSummary, filter: ConversationStatusFilter): boolean {
  if (filter === "all") return true;
  return summary.status === filter;
}

function matchesFeedbackFilter(summary: ConversationSummary, filter: ConversationFeedbackFilter): boolean {
  if (filter === "all") return true;
  if (filter === "with_feedback") return summary.feedbackSummary.total > 0;
  if (filter === "none") return summary.feedbackSummary.total === 0;
  if (filter === "positive") return summary.feedbackSummary.positive > 0;
  if (filter === "negative") return summary.feedbackSummary.negative > 0;
  return true;
}

function matchesQuery(summary: ConversationSummary, query: string | undefined): boolean {
  const normalized = trimOrUndefined(query)?.toLowerCase();
  if (!normalized) return true;
  const haystack = [
    summary.id,
    summary.externalId,
    summary.title,
    summary.model,
    summary.reasoningEffort,
    summary.workspace,
    summary.user?.displayName,
    summary.user?.email,
    summary.user?.role,
    summary.preview.firstUserText,
    summary.preview.latestText
  ]
    .map((item) => (typeof item === "string" ? item.toLowerCase() : ""))
    .join("\n");
  return haystack.includes(normalized);
}

function compareConversationSummary(left: ConversationSummary, right: ConversationSummary, sort: ConversationSort): number {
  const leftValue = sort === "created_desc" ? Date.parse(left.createdAt) : Date.parse(left.updatedAt);
  const rightValue = sort === "created_desc" ? Date.parse(right.createdAt) : Date.parse(right.updatedAt);
  return rightValue - leftValue;
}

function buildAggregateSummary(conversations: ConversationSummary[]) {
  const totalFeedback = conversations.reduce((sum, item) => sum + item.feedbackSummary.total, 0);
  const positiveFeedback = conversations.reduce((sum, item) => sum + item.feedbackSummary.positive, 0);
  const negativeFeedback = conversations.reduce((sum, item) => sum + item.feedbackSummary.negative, 0);
  const uniqueUsers = new Set(conversations.map((item) => item.user?.id).filter(Boolean)).size;

  return {
    totalThreads: conversations.length,
    threadsWithFeedback: conversations.filter((item) => item.feedbackSummary.total > 0).length,
    totalFeedback,
    positiveFeedback,
    negativeFeedback,
    uniqueUsers
  };
}

export function createConversationAuditRouter(options: {
  db?: ConversationAuditDb;
  getDb?: () => ConversationAuditDb;
} = {}): Router {
  const router = Router();
  let cachedDb: ConversationAuditDb | null = options.db ?? null;

  function getDb(): ConversationAuditDb {
    cachedDb ??= options.getDb?.() ?? (getDbClient() as unknown as ConversationAuditDb);
    return cachedDb;
  }

  async function listConversationSummaries(): Promise<ConversationSummary[]> {
    const db = getDb();
    const repository = new ThreadRepository(db as unknown as ThreadRepositoryDb);
    const [threads, users] = await Promise.all([repository.list(true), db.user.findMany({ orderBy: { createdAt: "asc" } })]);
    const userMap = new Map(users.map((item) => [item.id, normalizeUser(item)]));
    return threads.map((thread) => buildConversationSummary(thread, userMap.get(thread.userId ?? "") ?? null));
  }

  router.get("/conversations", async (req: Request, res: Response) => {
    try {
      const query = trimOrUndefined(req.query.query);
      const status = parseStatusFilter(req.query.status);
      const feedback = parseFeedbackFilter(req.query.feedback);
      const sort = parseSort(req.query.sort);
      const requestedPage = parsePositiveInteger(req.query.page, 1, 1, 10_000);
      const pageSize = parsePositiveInteger(req.query.page_size, 24, 1, 100);

      const filtered = (await listConversationSummaries())
        .filter((item) => matchesStatusFilter(item, status))
        .filter((item) => matchesFeedbackFilter(item, feedback))
        .filter((item) => matchesQuery(item, query))
        .sort((left, right) => compareConversationSummary(left, right, sort));

      const totalItems = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const start = (page - 1) * pageSize;
      const conversations = filtered.slice(start, start + pageSize);

      res.json({
        filters: {
          query: query ?? "",
          status,
          feedback,
          sort
        },
        summary: buildAggregateSummary(filtered),
        page: {
          page,
          pageSize,
          totalItems,
          totalPages
        },
        conversations
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载会话审计列表失败";
      res.status(500).json({ detail });
    }
  });

  router.get("/conversations/:threadId", async (req: Request, res: Response) => {
    try {
      const threadId = trimOrUndefined(req.params.threadId);
      if (!threadId) {
        res.status(400).json({ detail: "threadId 不合法" });
        return;
      }

      const db = getDb();
      const repository = new ThreadRepository(db as unknown as ThreadRepositoryDb);
      const thread = await repository.get(threadId);
      if (!thread) {
        res.status(404).json({ detail: "thread 不存在" });
        return;
      }

      const user = thread.userId ? normalizeUser(await db.user.findUnique({ where: { id: thread.userId } })) : null;
      const transcript = thread.messages.map((item, index) => toTranscriptMessage(item, index));

      res.json({
        conversation: buildConversationSummary(thread, user),
        transcript: {
          messageCount: transcript.length,
          messages: transcript
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载会话审计详情失败";
      res.status(500).json({ detail });
    }
  });

  return router;
}
