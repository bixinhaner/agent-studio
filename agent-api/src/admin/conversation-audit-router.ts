import { Router, type Request, type Response } from "express";

import { getDbClient } from "../db/client.js";
import {
  ThreadRepository,
  type StoredMessageItem,
  type ThreadFeedback,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "../persistence/thread-repository.js";

const EXTERNAL_API_FEATURE_TYPE = "external_openai_api";
const OPENAI_COMPATIBLE_API_TYPE = "openai_compatible_api";

type ConversationAuditUserRow = {
  id: string;
  displayName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
};

type UsageEventAuditRow = {
  id: string;
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

type IntegrationInstanceAuditRow = {
  id: string;
  type: string;
  slug: string;
  name: string;
  status: string;
};

type ConversationAuditDb = ThreadRepositoryDb & {
  user: {
    findMany(args?: { orderBy?: { createdAt: "asc" | "desc" } }): Promise<ConversationAuditUserRow[]>;
    findUnique(args: { where: { id: string } }): Promise<ConversationAuditUserRow | null>;
  };
  usageEvent: {
    findMany(args?: {
      where?: {
        featureType?: string;
      };
      orderBy?: { createdAt: "asc" | "desc" };
    }): Promise<UsageEventAuditRow[]>;
  };
  integrationInstance: {
    findMany(args?: {
      where?: {
        type?: string;
      };
    }): Promise<IntegrationInstanceAuditRow[]>;
  };
};

type ConversationStatusFilter = "all" | "regular" | "archived";
type ConversationFeedbackFilter = "all" | "with_feedback" | "positive" | "negative" | "none";
type ConversationSort = "updated_desc" | "created_desc";

type ApiAuditResultFilter = "all" | "success" | "failed";
type ApiAuditDeliveryFilter = "all" | "delivered" | "client_aborted" | "connection_closed" | "unknown";
type ApiAuditSort = "created_desc" | "tokens_desc" | "latency_desc";

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
    comment: string | null;
    userId: string | null;
    createdAt: string;
    updatedAt: string | null;
  }>;
};

type ApiAuditRecord = {
  id: string;
  sessionId: string | null;
  clientIp: string | null;
  integration: {
    id: string | null;
    slug: string | null;
    name: string | null;
  };
  model: string;
  requestedModel: string | null;
  requestedReasoningEffort: string | null;
  stream: boolean;
  messageCount: number;
  preview: {
    prompt: string | null;
    latest: string | null;
  };
  metrics: {
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    totalTokens: number;
    estimatedCost: string;
    internalCost: string;
    outputChars: number;
    responseStartedMs: number | null;
    responseReadyMs: number | null;
    responseCompletedMs: number | null;
  };
  transport: {
    responseMode: string;
    requestAborted: boolean;
    responseFinished: boolean;
    responseClosedBeforeFinish: boolean;
    responseStatusCode: number | null;
  };
  status: {
    result: string;
    delivery: string;
  };
  errorMessage: string | null;
  agentModeId: string | null;
  knowledgeSetIds: string[];
  createdAt: string;
  responseStartedAt: string | null;
  responseReadyAt: string | null;
  responseCompletedAt: string | null;
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

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = value
    .map((item) => trimOrUndefined(item))
    .filter((item): item is string => Boolean(item));
  return [...new Set(items)];
}

function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  if (value && typeof value === "object" && "toString" in value && typeof value.toString === "function") {
    const parsed = Number(value.toString());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
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

function parseApiResultFilter(value: unknown): ApiAuditResultFilter {
  return value === "success" || value === "failed" ? value : "all";
}

function parseApiDeliveryFilter(value: unknown): ApiAuditDeliveryFilter {
  return value === "delivered" ||
    value === "client_aborted" ||
    value === "connection_closed" ||
    value === "unknown"
    ? value
    : "all";
}

function parseApiSort(value: unknown): ApiAuditSort {
  return value === "tokens_desc" || value === "latency_desc" ? value : "created_desc";
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
    .map((item) => parseDateString(item.updatedAt) ?? parseDateString(item.createdAt))
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
      comment: summarizeText(item.comment, 600),
      userId: trimOrUndefined(item.userId) ?? null,
      createdAt: item.createdAt,
      updatedAt: parseDateString(item.updatedAt) ?? null
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

function asMetric(value: unknown): number | null {
  const parsed = Math.trunc(toNumber(value));
  return parsed > 0 ? parsed : null;
}

function buildApiAuditRecord(
  row: UsageEventAuditRow,
  integrationMap: Map<string, IntegrationInstanceAuditRow>
): ApiAuditRecord {
  const metadata = asRecord(row.metadata);
  const integrationId = trimOrUndefined(metadata?.integrationInstanceId) ?? null;
  const integration = integrationId ? integrationMap.get(integrationId) : undefined;
  const createdAt = parseDateString(row.createdAt) ?? new Date().toISOString();
  const delivery = trimOrUndefined(metadata?.deliveryStatus) ?? "unknown";

  return {
    id: row.id,
    sessionId: trimOrUndefined(row.sessionId) ?? null,
    clientIp: trimOrUndefined(metadata?.clientIp) ?? null,
    integration: {
      id: integrationId,
      slug: integration?.slug ?? trimOrUndefined(metadata?.integrationSlug) ?? null,
      name: integration?.name ?? null
    },
    model: trimOrUndefined(metadata?.selectedModel) ?? row.model,
    requestedModel: trimOrUndefined(metadata?.requestedModel) ?? null,
    requestedReasoningEffort: trimOrUndefined(metadata?.requestedReasoningEffort) ?? null,
    stream: metadata?.stream === true,
    messageCount: Math.max(0, Math.trunc(toNumber(metadata?.messageCount))),
    preview: {
      prompt: summarizeText(trimOrUndefined(metadata?.promptPreview), 220),
      latest: summarizeText(trimOrUndefined(metadata?.latestMessagePreview), 240)
    },
    metrics: {
      inputTokens: row.inputTokens,
      cachedInputTokens: row.cachedInputTokens,
      outputTokens: row.outputTokens,
      totalTokens: row.inputTokens + row.cachedInputTokens + row.outputTokens,
      estimatedCost: formatDecimal(row.estimatedCost),
      internalCost: formatDecimal(row.internalCost),
      outputChars: Math.max(0, Math.trunc(toNumber(metadata?.outputChars))),
      responseStartedMs: asMetric(metadata?.responseStartedMs),
      responseReadyMs: asMetric(metadata?.responseReadyMs),
      responseCompletedMs: asMetric(metadata?.responseCompletedMs)
    },
    transport: {
      responseMode: trimOrUndefined(metadata?.responseMode) ?? (metadata?.stream === true ? "stream" : "non_stream"),
      requestAborted: asBoolean(metadata?.requestAborted) === true,
      responseFinished: asBoolean(metadata?.responseFinished) === true,
      responseClosedBeforeFinish: asBoolean(metadata?.responseClosedBeforeFinish) === true,
      responseStatusCode: asMetric(metadata?.responseStatusCode)
    },
    status: {
      result: trimOrUndefined(row.resultStatus) ?? "unknown",
      delivery
    },
    errorMessage: trimOrUndefined(metadata?.errorMessage) ?? null,
    agentModeId: trimOrUndefined(metadata?.agentModeId) ?? null,
    knowledgeSetIds: asStringArray(metadata?.knowledgeSetIds),
    createdAt,
    responseStartedAt: parseDateString(metadata?.responseStartedAt),
    responseReadyAt: parseDateString(metadata?.responseReadyAt),
    responseCompletedAt: parseDateString(metadata?.responseCompletedAt)
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
    summary.preview.latestText,
    ...summary.feedback.flatMap((item) => [item.contentPreview, item.comment])
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

function buildConversationAggregateSummary(conversations: ConversationSummary[]) {
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

function matchesApiResult(record: ApiAuditRecord, filter: ApiAuditResultFilter): boolean {
  if (filter === "all") return true;
  return record.status.result === filter;
}

function matchesApiDelivery(record: ApiAuditRecord, filter: ApiAuditDeliveryFilter): boolean {
  if (filter === "all") return true;
  return record.status.delivery === filter;
}

function matchesApiQuery(record: ApiAuditRecord, query: string | undefined): boolean {
  const normalized = trimOrUndefined(query)?.toLowerCase();
  if (!normalized) return true;
  const haystack = [
    record.id,
    record.sessionId,
    record.clientIp,
    record.integration.id,
    record.integration.slug,
    record.integration.name,
    record.model,
    record.requestedModel,
    record.requestedReasoningEffort,
    record.preview.prompt,
    record.preview.latest,
    record.errorMessage,
    record.status.result,
    record.status.delivery
  ]
    .map((item) => (typeof item === "string" ? item.toLowerCase() : ""))
    .join("\n");
  return haystack.includes(normalized);
}

function compareApiAuditRecord(left: ApiAuditRecord, right: ApiAuditRecord, sort: ApiAuditSort): number {
  if (sort === "tokens_desc") {
    return right.metrics.totalTokens - left.metrics.totalTokens || Date.parse(right.createdAt) - Date.parse(left.createdAt);
  }
  if (sort === "latency_desc") {
    return (right.metrics.responseCompletedMs ?? -1) - (left.metrics.responseCompletedMs ?? -1) ||
      Date.parse(right.createdAt) - Date.parse(left.createdAt);
  }
  return Date.parse(right.createdAt) - Date.parse(left.createdAt);
}

function buildApiAggregateSummary(records: ApiAuditRecord[]) {
  return {
    totalRequests: records.length,
    successCount: records.filter((item) => item.status.result === "success").length,
    failureCount: records.filter((item) => item.status.result !== "success").length,
    deliveredCount: records.filter((item) => item.status.delivery === "delivered").length,
    deliveryFailureCount: records.filter((item) => item.status.delivery !== "delivered").length,
    streamCount: records.filter((item) => item.stream).length,
    uniqueIps: new Set(records.map((item) => item.clientIp).filter(Boolean)).size,
    missingIpCount: records.filter((item) => !item.clientIp).length
  };
}

function apiFirstSeenAt(records: ApiAuditRecord[], clientIp: string | null): string | null {
  if (!clientIp) return null;
  const matches = records
    .filter((item) => item.clientIp === clientIp)
    .map((item) => item.createdAt)
    .sort((left, right) => new Date(left).getTime() - new Date(right).getTime());
  return matches[0] ?? null;
}

function apiLastSeenAt(records: ApiAuditRecord[], clientIp: string | null): string | null {
  if (!clientIp) return null;
  const matches = records
    .filter((item) => item.clientIp === clientIp)
    .map((item) => item.createdAt)
    .sort((left, right) => new Date(right).getTime() - new Date(left).getTime());
  return matches[0] ?? null;
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
    const [threads, users] = await Promise.all([repository.list(undefined, true), db.user.findMany({ orderBy: { createdAt: "asc" } })]);
    const userMap = new Map(users.map((item) => [item.id, normalizeUser(item)]));
    return threads.map((thread) => buildConversationSummary(thread, userMap.get(thread.userId ?? "") ?? null));
  }

  async function listApiAuditRecords(): Promise<ApiAuditRecord[]> {
    const db = getDb();
    const [events, integrations] = await Promise.all([
      db.usageEvent.findMany({
        where: { featureType: EXTERNAL_API_FEATURE_TYPE },
        orderBy: { createdAt: "desc" }
      }),
      db.integrationInstance.findMany({
        where: { type: OPENAI_COMPATIBLE_API_TYPE }
      })
    ]);
    const integrationMap = new Map(integrations.map((item) => [item.id, item] as const));
    return events.map((event) => buildApiAuditRecord(event, integrationMap));
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
        summary: buildConversationAggregateSummary(filtered),
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

  router.get("/conversations/api-usage", async (req: Request, res: Response) => {
    try {
      const query = trimOrUndefined(req.query.query);
      const result = parseApiResultFilter(req.query.result);
      const delivery = parseApiDeliveryFilter(req.query.delivery);
      const sort = parseApiSort(req.query.sort);
      const requestedPage = parsePositiveInteger(req.query.page, 1, 1, 10_000);
      const pageSize = parsePositiveInteger(req.query.page_size, 24, 1, 100);

      const filtered = (await listApiAuditRecords())
        .filter((item) => matchesApiResult(item, result))
        .filter((item) => matchesApiDelivery(item, delivery))
        .filter((item) => matchesApiQuery(item, query))
        .sort((left, right) => compareApiAuditRecord(left, right, sort));

      const totalItems = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const start = (page - 1) * pageSize;
      const records = filtered.slice(start, start + pageSize);

      res.json({
        filters: {
          query: query ?? "",
          result,
          delivery,
          sort
        },
        summary: buildApiAggregateSummary(filtered),
        page: {
          page,
          pageSize,
          totalItems,
          totalPages
        },
        records
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载 API 审计列表失败";
      res.status(500).json({ detail });
    }
  });

  router.get("/conversations/api-usage/:eventId", async (req: Request, res: Response) => {
    try {
      const eventId = trimOrUndefined(req.params.eventId);
      if (!eventId) {
        res.status(400).json({ detail: "eventId 不合法" });
        return;
      }

      const records = await listApiAuditRecords();
      const record = records.find((item) => item.id === eventId);
      if (!record) {
        res.status(404).json({ detail: "API usage event 不存在" });
        return;
      }

      res.json({
        record,
        relatedSummary: {
          sameIpRequests: record.clientIp ? records.filter((item) => item.clientIp === record.clientIp).length : 0,
          sameSessionRequests: record.sessionId ? records.filter((item) => item.sessionId === record.sessionId).length : 0,
          sameIntegrationRequests: record.integration.id
            ? records.filter((item) => item.integration.id === record.integration.id).length
            : 0,
          firstSeenAt: apiFirstSeenAt(records, record.clientIp),
          lastSeenAt: apiLastSeenAt(records, record.clientIp)
        }
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载 API 审计详情失败";
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
