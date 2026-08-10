import fs from "node:fs/promises";
import path from "node:path";

import { Router, type NextFunction, type Request, type Response } from "express";
import multer, { MulterError } from "multer";

import { getDbClient } from "../db/client.js";
import { sendOfficePdfPreview } from "../files/office-preview-service.js";
import { detectedContentType, sendStructuredPreview } from "../files/structured-preview-service.js";
import {
  ThreadRepository,
  type StoredMessageItem,
  type ThreadFeedback,
  type ThreadRecord,
  type ThreadRepositoryDb
} from "../persistence/thread-repository.js";
import {
  ProductFeedbackRepository,
  type ProductFeedbackRecord,
  type ProductFeedbackRepositoryDb,
  type ProductFeedbackStatus,
  type ProductFeedbackType
} from "../persistence/product-feedback-repository.js";
import {
  AiResponseReviewRepository,
  type AiResponseReviewEffectiveStatus,
  type AiResponseReviewFilter,
  type AiResponseReviewRepositoryDb,
  type AiResponseReviewSort
} from "../persistence/ai-response-review-repository.js";
import {
  ExternalConversationBindingRepository,
  type ExternalConversationBindingRecord,
  type ExternalConversationBindingRepositoryDb
} from "../persistence/external-conversation-binding-repository.js";
import { UsageEventRepository, type UsageEventRecord, type UsageEventRepositoryDb } from "../persistence/usage-event-repository.js";
import { ConversationRecordService } from "../operations/conversation-record-service.js";
import { UsageLedgerService } from "../operations/usage-ledger-service.js";
import { usageTotalTokens } from "../operations/usage-metrics.js";
import {
  PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES,
  PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES,
  PRODUCT_FEEDBACK_REPLY_MAX_IMAGES,
  ProductFeedbackReplyError,
  type ProductFeedbackReplyService
} from "../operations/product-feedback-reply-service.js";

const OPENAI_COMPATIBLE_API_TYPE = "openai_compatible_api";

const productFeedbackReplyImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    files: PRODUCT_FEEDBACK_REPLY_MAX_IMAGES,
    fileSize: PRODUCT_FEEDBACK_REPLY_MAX_IMAGE_BYTES
  },
  fileFilter(_req, file, callback) {
    if (PRODUCT_FEEDBACK_REPLY_IMAGE_MIME_TYPES.has(file.mimetype)) {
      callback(null, true);
      return;
    }
    callback(new Error("仅支持 PNG、JPG 或 GIF 图片。"));
  }
});

type ConversationAuditUserRow = {
  id: string;
  userType: string | null;
  displayName: string | null;
  email: string | null;
  role: string | null;
  status: string | null;
};

type UsageEventAuditRow = UsageEventRecord;

type IntegrationInstanceAuditRow = {
  id: string;
  type: string;
  slug: string;
  name: string;
  status: string;
};

type AgentModeAuditRow = {
  id: string;
  name: string;
  slug: string;
  status: string | null;
};

type ConversationAuditDb = ThreadRepositoryDb & ProductFeedbackRepositoryDb & UsageEventRepositoryDb & {
  user: {
    findMany(args?: { orderBy?: { createdAt: "asc" | "desc" } }): Promise<ConversationAuditUserRow[]>;
    findUnique(args: { where: { id: string } }): Promise<ConversationAuditUserRow | null>;
  };
  integrationInstance: {
    findMany(args?: {
      where?: {
        type?: string;
      };
    }): Promise<IntegrationInstanceAuditRow[]>;
  };
  agentMode: {
    findMany(args?: { orderBy?: { createdAt: "asc" | "desc" } }): Promise<AgentModeAuditRow[]>;
  };
  externalConversationBinding: ExternalConversationBindingRepositoryDb["externalConversationBinding"];
};

type ConversationStatusFilter = "all" | "regular" | "archived";
type ConversationFeedbackFilter = "all" | "with_feedback" | "positive" | "negative" | "none";
export type ConversationSourceFilter = "all" | "internal" | "external" | "zendesk" | "dingtalk" | "action_connector";
type ConversationSort = "updated_desc" | "created_desc";

type ApiAuditResultFilter = "all" | "success" | "failed";
type ApiAuditDeliveryFilter = "all" | "delivered" | "client_aborted" | "connection_closed" | "unknown";
type ApiAuditSort = "created_desc" | "tokens_desc" | "latency_desc";
type ProductFeedbackTypeFilter = "all" | ProductFeedbackType;
type ProductFeedbackStatusFilter = "all" | ProductFeedbackStatus;
type ProductFeedbackSort = "created_desc" | "updated_desc";
type AiResponseReviewStatusFilter = "all" | AiResponseReviewEffectiveStatus;

type ConversationAuditUser = {
  id: string;
  userType: string;
  displayName: string | null;
  email: string | null;
  role: string;
  status: string;
};

type ConversationAudience = "internal" | "external" | "unknown";

type ConversationChannelSummary = {
  type: string;
  label: string;
  integrationInstanceId: string | null;
  integrationName: string | null;
  conversationType: string | null;
  externalConversationId: string | null;
  externalConversationKey: string | null;
  externalUserId: string | null;
  externalUnionId: string | null;
  externalUserName: string | null;
  externalGroupId: string | null;
  externalGroupName: string | null;
  botId: string | null;
  botName: string | null;
  agentModeId: string | null;
  lastExternalMessageId: string | null;
  lastMessageAt: string | null;
  requesterOrganization: string | null;
  requesterCountryRegion: string | null;
  sourceSystem: string | null;
  sourceInstanceId: string | null;
  sourceInstanceShortId: string | null;
  sourceInstanceName: string | null;
  sourceInstanceNameIsDefault: boolean;
  sourceUserDisplayName: string | null;
  sourceLocalIPs: string[];
};

type ConversationAgentModeSummary = {
  id: string;
  name: string | null;
  slug: string | null;
  status: string | null;
};

type ConversationTranscriptMessage = {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  text: string;
  attachments: Array<{
    id: string;
    kind: "image" | "document" | "file";
    name: string;
    mimeType: string | null;
    bytes: number | null;
    path: string | null;
    relativePath: string | null;
    contentUrl: string | null;
  }>;
  processRows?: Array<{
    id: string;
    kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
    title: string;
    detail?: string;
    at?: string;
  }>;
  turnStatus: "completed" | "running" | "cancelled" | "disconnected" | "failed";
  turnStatusReason: string | null;
  parentId: string | null;
  createdAt: string | null;
  hasRunConfig: boolean;
};

type ConversationSummary = {
  id: string;
  externalId: string | null;
  audience: ConversationAudience;
  title: string;
  status: ThreadRecord["status"];
  model: string;
  reasoningEffort: string;
  workspace: string;
  enabledSkillNames: string[];
  activeSession: boolean;
  createdAt: string;
  updatedAt: string;
  user: ConversationAuditUser | null;
  channel: ConversationChannelSummary | null;
  agentMode: ConversationAgentModeSummary | null;
  metrics: {
    messageCount: number;
    userMessageCount: number;
    assistantMessageCount: number;
    feedbackCount: number;
    userAttachmentCount: number;
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
    cacheWriteTokens: number;
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

type ProductFeedbackListResponse = {
  filters: {
    query: string;
    type: ProductFeedbackTypeFilter;
    status: ProductFeedbackStatusFilter;
    sort: ProductFeedbackSort;
  };
  summary: {
    totalFeedback: number;
    openCount: number;
    triagedCount: number;
    inProgressCount: number;
    resolvedCount: number;
    closedCount: number;
    bugCount: number;
    featureRequestCount: number;
    usabilityIssueCount: number;
    uniqueUsers: number;
  };
  page: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
  };
  feedback: ProductFeedbackRecord[];
};

type UploadedFileHint = {
  name?: string;
  path?: string;
  relativePath?: string;
  mimeType?: string;
  bytes?: number | null;
};

const UPLOADED_FILE_TAG_PATTERN = /<uploaded_file\s+([^>]+)>/gi;
const UPLOADED_FILE_ATTR_PATTERN = /([a-zA-Z_][\w-]*)=("(?:\\.|[^"])*"|'(?:\\.|[^'])*'|[^\s>]+)/g;
const PROCESS_KINDS = new Set<NonNullable<ConversationTranscriptMessage["processRows"]>[number]["kind"]>([
  "reasoning",
  "tool",
  "source",
  "meta",
  "process",
  "done",
  "error",
  "debug"
]);

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

export function enabledSkillNamesFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  const raw = codexRunConfig?.enabledSkills;
  if (!Array.isArray(raw)) return [];
  const names: string[] = [];
  for (const item of raw) {
    const name =
      typeof item === "string"
        ? trimOrUndefined(item)
        : trimOrUndefined((asRecord(item)?.name ?? asRecord(item)?.skillName) as unknown);
    if (name && !names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

export function agentModeIdFromRunConfig(codexRunConfig?: Record<string, unknown>): string | undefined {
  return trimOrUndefined(codexRunConfig?.mode) ?? trimOrUndefined(codexRunConfig?.agentModeId);
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

function normalizeFilePath(value: string): string {
  return value.replace(/\\/g, "/").trim();
}

function fileNameFromPath(filePath: string): string {
  const normalized = normalizeFilePath(filePath);
  if (!normalized) return "";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function decodeAttributeValue(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
    if (value.startsWith("\"")) {
      try {
        const parsed = JSON.parse(value);
        return typeof parsed === "string" ? parsed : String(parsed ?? "");
      } catch {
        return value.slice(1, -1);
      }
    }
    return value.slice(1, -1);
  }
  return value;
}

function parseUploadedFileHints(text: string): UploadedFileHint[] {
  if (!text.trim()) return [];
  const hints: UploadedFileHint[] = [];
  UPLOADED_FILE_TAG_PATTERN.lastIndex = 0;
  let tagMatch: RegExpExecArray | null = null;
  while ((tagMatch = UPLOADED_FILE_TAG_PATTERN.exec(text)) !== null) {
    const attrText = tagMatch[1] || "";
    const hint: UploadedFileHint = {};
    UPLOADED_FILE_ATTR_PATTERN.lastIndex = 0;
    let attrMatch: RegExpExecArray | null = null;
    while ((attrMatch = UPLOADED_FILE_ATTR_PATTERN.exec(attrText)) !== null) {
      const key = (attrMatch[1] || "").trim();
      const value = decodeAttributeValue(attrMatch[2] || "");
      if (key === "name") hint.name = value;
      if (key === "path") hint.path = value;
      if (key === "relativePath") hint.relativePath = value;
      if (key === "mimeType") hint.mimeType = value;
      if (key === "bytes") {
        const parsed = Number(value);
        hint.bytes = Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
      }
    }
    if (hint.path || hint.relativePath) hints.push(hint);
  }
  return hints;
}

function normalizeRelativePath(value: string): string {
  return value.split(path.sep).join("/");
}

function isPathInside(parentDir: string, candidatePath: string): boolean {
  const normalizedParent = path.resolve(parentDir);
  const normalizedCandidate = path.resolve(candidatePath);
  return normalizedCandidate === normalizedParent || normalizedCandidate.startsWith(`${normalizedParent}${path.sep}`);
}

function isZendeskAttachmentRelativePath(value: string): boolean {
  return value === ".zendesk/attachments" || value.startsWith(".zendesk/attachments/");
}

function sanitizePathSegment(value: string, fallback: string): string {
  const normalized = value
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized || fallback;
}

function legacyThreadWorkspaceUploadDir(workspacePath: string): string {
  return path.join(workspacePath, ".uploads");
}

function threadScopedWorkspaceUploadDir(workspacePath: string, threadId: string): string {
  return path.join(workspacePath, ".agent-studio", "uploads", sanitizePathSegment(threadId, "thread"));
}

export function threadWorkspaceUploadDirs(workspacePath: string, threadId: string): string[] {
  return [...new Set([threadScopedWorkspaceUploadDir(workspacePath, threadId), legacyThreadWorkspaceUploadDir(workspacePath)])];
}

export function resolveThreadFileAbsolutePath(input: {
  workspacePath: string;
  uploadDir: string;
  relativePath?: string;
  filePath?: string;
}): string {
  const normalizedWorkspacePath = path.resolve(input.workspacePath);
  const normalizedUploadDir = path.resolve(input.uploadDir);
  const normalizedRelative = trimOrUndefined(input.relativePath);
  if (normalizedRelative) {
    const normalizedPosixRelative = normalizeRelativePath(normalizedRelative).replace(/^\/+/, "");
    const relativeSegments = normalizedPosixRelative
      .split("/")
      .map((segment) => segment.trim())
      .filter(Boolean);
    if (relativeSegments.length === 0) {
      throw new Error("Invalid relative_path");
    }
    if (isZendeskAttachmentRelativePath(normalizedPosixRelative)) {
      const zendeskAttachmentRoot = path.resolve(normalizedWorkspacePath, ".zendesk", "attachments");
      const candidate = path.resolve(normalizedWorkspacePath, ...relativeSegments);
      if (!isPathInside(zendeskAttachmentRoot, candidate)) {
        throw new Error("Attachment path is outside the allowed Zendesk attachment directory");
      }
      return candidate;
    }
    const candidate = path.resolve(normalizedUploadDir, ...relativeSegments);
    if (!isPathInside(normalizedUploadDir, candidate)) {
      throw new Error("Attachment path is outside the allowed directory");
    }
    return candidate;
  }

  const normalizedFilePath = trimOrUndefined(input.filePath);
  if (!normalizedFilePath) {
    throw new Error("Either relative_path or path is required");
  }

  const candidate = path.isAbsolute(normalizedFilePath)
    ? path.resolve(normalizedFilePath)
    : path.resolve(normalizedWorkspacePath, normalizedFilePath);
  if (!isPathInside(normalizedWorkspacePath, candidate)) {
    throw new Error("File path is outside the thread workspace");
  }
  return candidate;
}

async function resolveExistingThreadFileAbsolutePath(input: {
  workspacePath: string;
  threadId: string;
  relativePath?: string;
  filePath?: string;
}): Promise<string> {
  if (!trimOrUndefined(input.relativePath)) {
    return resolveThreadFileAbsolutePath({
      workspacePath: input.workspacePath,
      uploadDir: threadScopedWorkspaceUploadDir(input.workspacePath, input.threadId),
      filePath: input.filePath
    });
  }

  let firstCandidate: string | undefined;
  for (const uploadDir of threadWorkspaceUploadDirs(input.workspacePath, input.threadId)) {
    const candidate = resolveThreadFileAbsolutePath({
      workspacePath: input.workspacePath,
      uploadDir,
      relativePath: input.relativePath
    });
    firstCandidate ??= candidate;
    const stat = await fs.stat(candidate).catch(() => null);
    if (stat?.isFile()) return candidate;
  }

  return firstCandidate ?? resolveThreadFileAbsolutePath({
    workspacePath: input.workspacePath,
    uploadDir: threadScopedWorkspaceUploadDir(input.workspacePath, input.threadId),
    relativePath: input.relativePath
  });
}

function normalizeProcessKind(
  value: unknown
): NonNullable<ConversationTranscriptMessage["processRows"]>[number]["kind"] {
  const raw = trimOrUndefined(value) ?? "";
  return PROCESS_KINDS.has(raw as NonNullable<ConversationTranscriptMessage["processRows"]>[number]["kind"])
    ? (raw as NonNullable<ConversationTranscriptMessage["processRows"]>[number]["kind"])
    : "process";
}

function sanitizeProcessTitle(value: unknown, fallback = "Process event"): string {
  return trimOrUndefined(value) ?? fallback;
}

function stringifyProcessValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function sanitizeProcessDetail(value: unknown): string | undefined {
  const detail = trimOrUndefined(typeof value === "string" ? value : stringifyProcessValue(value));
  return detail || undefined;
}

function sanitizeProcessAt(value: unknown): string | undefined {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    const normalized = value < 1_000_000_000_000 ? value * 1000 : value;
    const parsed = new Date(normalized);
    return Number.isNaN(parsed.getTime()) ? undefined : parsed.toISOString();
  }
  const raw = trimOrUndefined(value);
  if (!raw) return undefined;
  if (/^\d+$/.test(raw)) {
    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      const normalized = raw.length <= 10 ? numeric * 1000 : numeric;
      const parsed = new Date(normalized);
      if (!Number.isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
  }
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }
  return raw;
}

function collectCommentaryLines(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((line) => trimOrUndefined(line))
    .filter((line): line is string => Boolean(line));
}

function commentaryDetailFromRecord(record: Record<string, unknown>): string | undefined {
  const text = trimOrUndefined(record.text);
  if (text) return text;
  const lines = collectCommentaryLines(record.lines);
  if (lines.length === 0) return undefined;
  return lines.join("\n\n");
}

function commentaryTitle(detail: string, fallback: string): string {
  const condensed = detail.replace(/\s+/g, " ").trim();
  return summarizeText(condensed, 96) ?? fallback;
}

function extractCommentaryProcessRows(
  part: Record<string, unknown>,
  fallbackIndex: number
): NonNullable<ConversationTranscriptMessage["processRows"]> {
  if (trimOrUndefined(part.type) !== "data" || trimOrUndefined(part.name) !== "codex_commentary") {
    return [];
  }

  const data = asRecord(part.data);
  if (!data) return [];

  const entries = Array.isArray(data.entries) ? data.entries : [];
  const rows = entries
    .map((entry, index) => {
      const item = asRecord(entry);
      if (!item) return null;
      const detail = commentaryDetailFromRecord(item);
      if (!detail) return null;
      return {
        id: trimOrUndefined(item.id) ?? `commentary-${fallbackIndex + 1}-${index + 1}`,
        kind: "reasoning" as const,
        title: commentaryTitle(detail, `Thought ${index + 1}`),
        detail,
        at: sanitizeProcessAt(item.last_event_at)
      };
    })
    .filter(Boolean) as NonNullable<ConversationTranscriptMessage["processRows"]>;

  if (rows.length > 0) {
    return rows;
  }

  const detail = commentaryDetailFromRecord(data);
  if (!detail) return [];
  return [
    {
      id: trimOrUndefined(data.id) ?? `commentary-${fallbackIndex + 1}`,
      kind: "reasoning",
      title: commentaryTitle(detail, "Thought"),
      detail,
      at: sanitizeProcessAt(data.last_event_at)
    }
  ];
}

function extractTraceBatchProcessRows(
  part: Record<string, unknown>
): NonNullable<ConversationTranscriptMessage["processRows"]> {
  if (trimOrUndefined(part.type) !== "data" || trimOrUndefined(part.name) !== "codex_trace_batch") {
    return [];
  }

  const data = asRecord(part.data);
  const rows = Array.isArray(data?.rows) ? data.rows : [];
  return rows
    .map((entry, index) => {
      const row = asRecord(entry);
      if (!row) return null;
      return {
        id: trimOrUndefined(row.id) ?? `process-row-${index + 1}`,
        kind: normalizeProcessKind(row.kind),
        title: sanitizeProcessTitle(row.title),
        detail: sanitizeProcessDetail(row.rawDetail ?? row.detail),
        at: sanitizeProcessAt(row.at)
      };
    })
    .filter(Boolean) as NonNullable<ConversationTranscriptMessage["processRows"]>;
}

function extractFallbackProcessRows(
  parts: unknown
): NonNullable<ConversationTranscriptMessage["processRows"]> {
  if (!Array.isArray(parts)) return [];
  const rows: NonNullable<ConversationTranscriptMessage["processRows"]> = [];

  for (const [index, entry] of parts.entries()) {
    const part = asRecord(entry);
    if (!part) continue;
    const type = trimOrUndefined(part.type) ?? "";

    if (type === "reasoning") {
      const detail = sanitizeProcessDetail(part.text);
      if (!detail) continue;
      rows.push({
        id: trimOrUndefined(part.id) ?? `process-row-${index + 1}`,
        kind: "reasoning",
        title: "Reasoning summary",
        detail
      });
      continue;
    }

    if (type === "tool-call") {
      const toolName = trimOrUndefined(part.toolName) ?? "tool";
      const argsText = sanitizeProcessDetail(part.argsText);
      const resultText = sanitizeProcessDetail(part.result);
      rows.push({
        id: trimOrUndefined(part.toolCallId) ?? `process-row-${index + 1}`,
        kind: "tool",
        title: `Tool call · ${toolName}`,
        detail: [argsText, resultText].filter(Boolean).join("\n\n") || undefined
      });
      continue;
    }

    if (
      type === "data" &&
      (trimOrUndefined(part.name) === "codex_process" || trimOrUndefined(part.name) === "codex_process_audit")
    ) {
      const data = asRecord(part.data);
      if (!data) continue;
      rows.push({
        id: trimOrUndefined(part.id) ?? `process-row-${index + 1}`,
        kind: normalizeProcessKind(data.kind),
        title: sanitizeProcessTitle(data.title),
        detail: sanitizeProcessDetail(data.rawDetail ?? data.detail),
        at: sanitizeProcessAt(data.at)
      });
    }
  }

  return rows;
}

export function extractMessageProcessRows(
  message: unknown
): NonNullable<ConversationTranscriptMessage["processRows"]> {
  const obj = asRecord(message);
  const parts = Array.isArray(obj?.content) ? obj.content : [];
  const hasTraceBatch = parts.some((entry) => {
    const part = asRecord(entry);
    return trimOrUndefined(part?.type) === "data" && trimOrUndefined(part?.name) === "codex_trace_batch";
  });
  const rows: NonNullable<ConversationTranscriptMessage["processRows"]> = [];

  for (const [index, entry] of parts.entries()) {
    const part = asRecord(entry);
    if (!part) continue;

    const commentaryRows = extractCommentaryProcessRows(part, index);
    if (commentaryRows.length > 0) {
      rows.push(...commentaryRows);
    }

    const traceRows = extractTraceBatchProcessRows(part);
    if (traceRows.length > 0) {
      rows.push(...traceRows);
      continue;
    }

    if (hasTraceBatch) continue;
    rows.push(...extractFallbackProcessRows([part]));
  }

  return rows.map((row, index) => ({ row, index })).sort((left, right) => {
    const leftAt = left.row.at ? Date.parse(left.row.at) : Number.NaN;
    const rightAt = right.row.at ? Date.parse(right.row.at) : Number.NaN;
    if (!Number.isNaN(leftAt) && !Number.isNaN(rightAt) && leftAt !== rightAt) {
      return leftAt - rightAt;
    }
    return left.index - right.index;
  }).map((item) => item.row);
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

function parseSourceFilter(value: unknown): ConversationSourceFilter {
  return value === "internal" ||
    value === "external" ||
    value === "zendesk" ||
    value === "dingtalk" ||
    value === "action_connector"
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

function parseProductFeedbackType(value: unknown): ProductFeedbackTypeFilter {
  if (value === "bug" || value === "feature_request" || value === "usability_issue" || value === "other") {
    return value;
  }
  return "all";
}

function parseProductFeedbackStatus(value: unknown): ProductFeedbackStatusFilter {
  if (value === "open" || value === "triaged" || value === "in_progress" || value === "resolved" || value === "closed") {
    return value;
  }
  return "all";
}

function parseProductFeedbackSort(value: unknown): ProductFeedbackSort {
  return value === "updated_desc" ? value : "created_desc";
}

function parseAiResponseReviewStatus(value: unknown): AiResponseReviewStatusFilter {
  if (value === "pending" || value === "overdue" || value === "submitted" || value === "cancelled") return value;
  return "all";
}

function parseAiResponseReviewFilter(value: unknown): AiResponseReviewFilter | undefined {
  if (
    value === "all" ||
    value === "unreviewed" ||
    value === "overdue_unreviewed" ||
    value === "submitted" ||
    value === "low_score" ||
    value === "critical_low_score" ||
    value === "lowest_score" ||
    value === "with_suggestion" ||
    value === "notification_failed" ||
    value === "todo_failed" ||
    value === "cancelled"
  ) {
    return value;
  }
  return undefined;
}

function parseAiResponseReviewSort(value: unknown): AiResponseReviewSort | undefined {
  if (
    value === "auto" ||
    value === "created_desc" ||
    value === "due_asc" ||
    value === "overdue_desc" ||
    value === "submitted_desc" ||
    value === "score_asc"
  ) {
    return value;
  }
  return undefined;
}

function normalizeUser(row: ConversationAuditUserRow | null | undefined): ConversationAuditUser | null {
  if (!row) return null;
  return {
    id: row.id,
    userType: trimOrUndefined(row.userType) ?? "internal_employee",
    displayName: trimOrUndefined(row.displayName) ?? null,
    email: trimOrUndefined(row.email) ?? null,
    role: trimOrUndefined(row.role) ?? "employee",
    status: trimOrUndefined(row.status) ?? "active"
  };
}

export function resolveConversationAudience(
  user: { userType?: string | null } | null | undefined,
  channel?: ConversationChannelSummary | null
): ConversationAudience {
  const userType = trimOrUndefined(user?.userType ?? undefined);
  if (!userType && channel?.type === "zendesk") return "external";
  if (!userType) return "unknown";
  return userType === "external_user" ? "external" : "internal";
}

export function matchesConversationSourceFilter(
  summary: {
    audience: ConversationAudience;
    channel?: { type?: string | null } | null;
  },
  filter: ConversationSourceFilter
): boolean {
  if (filter === "all") return true;
  if (filter === "zendesk") return summary.channel?.type === "zendesk";
  if (filter === "dingtalk") return summary.channel?.type === "dingtalk_bot";
  if (filter === "action_connector") return summary.channel?.type === "action_connector";
  if (filter === "internal") return !summary.channel && summary.audience === "internal";
  if (filter === "external") return !summary.channel && summary.audience === "external";
  return true;
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

function uniqueNonEmptyLines(lines: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const normalized = trimOrUndefined(line);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
}

function collectCodexProcessFallback(part: Record<string, unknown>): string[] {
  const name = trimOrUndefined(part.name);
  if (name !== "codex_process" && name !== "codex_process_audit") return [];
  const payload = asRecord(part.data);
  if (!payload) return [];
  const kind = trimOrUndefined(payload.kind) ?? "";
  if (kind !== "error") return [];
  return uniqueNonEmptyLines([
    trimOrUndefined(payload.title),
    trimOrUndefined(payload.rawDetail) ?? trimOrUndefined(payload.detail)
  ]);
}

function collectCodexTraceBatchFallback(part: Record<string, unknown>): string[] {
  if (trimOrUndefined(part.name) !== "codex_trace_batch") return [];
  const payload = asRecord(part.data);
  const rows = Array.isArray(payload?.rows) ? payload.rows : [];
  const errorRows = rows
    .map((item) => asRecord(item))
    .filter((item): item is Record<string, unknown> => Boolean(item))
    .filter((item) => trimOrUndefined(item.kind) === "error");

  return errorRows.flatMap((row) =>
    uniqueNonEmptyLines([
      trimOrUndefined(row.title),
      trimOrUndefined(row.rawDetail) ?? trimOrUndefined(row.detail)
    ])
  );
}

function collectFallbackParts(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectFallbackParts(item));
  }
  const obj = asRecord(value);
  if (!obj) return [];

  if (Array.isArray(obj.content)) {
    return obj.content.flatMap((item) => {
      const part = asRecord(item);
      if (!part) return [];
      const type = trimOrUndefined(part.type);
      if (type === "data") {
        return [
          ...collectCodexProcessFallback(part),
          ...collectCodexTraceBatchFallback(part)
        ];
      }
      if (type === "error") {
        return uniqueNonEmptyLines([
          trimOrUndefined(part.title),
          trimOrUndefined(part.message),
          trimOrUndefined(part.detail)
        ]);
      }
      return collectFallbackParts(part.content);
    });
  }

  return [];
}

export function extractMessageText(message: unknown): string {
  const primaryText = collectTextParts(message).join("\n\n").trim();
  const fallbackText = collectFallbackParts(message).join("\n\n").trim();
  if (!primaryText) return fallbackText;
  if (!fallbackText) return primaryText;
  if (primaryText.includes(fallbackText)) return primaryText;
  return `${primaryText}\n\n${fallbackText}`;
}

function attachmentKindFromValue(value: unknown): "image" | "document" | "file" {
  return value === "image" || value === "document" ? value : "file";
}

function buildAdminThreadFileContentUrl(
  threadId: string,
  input: { relativePath?: string | null; filePath?: string | null }
): string | null {
  const query = new URLSearchParams();
  const relativePath = trimOrUndefined(input.relativePath ?? undefined);
  const filePath = trimOrUndefined(input.filePath ?? undefined);
  if (relativePath) {
    query.set("relative_path", relativePath);
  } else if (filePath) {
    query.set("path", filePath);
  } else {
    return null;
  }
  return `/api/admin/conversations/${encodeURIComponent(threadId)}/files/content?${query.toString()}`;
}

function attachmentDisplayName(
  attachmentName: string | undefined,
  hint: UploadedFileHint | undefined,
  index: number
): string {
  const hintedPath = trimOrUndefined(hint?.relativePath) ?? trimOrUndefined(hint?.path);
  return (
    trimOrUndefined(hint?.name) ??
    trimOrUndefined(attachmentName) ??
    (hintedPath ? fileNameFromPath(hintedPath) : undefined) ??
    `Attachment ${index + 1}`
  );
}

function dedupeTranscriptAttachments(
  attachments: ConversationTranscriptMessage["attachments"]
): ConversationTranscriptMessage["attachments"] {
  const seen = new Set<string>();
  const output: ConversationTranscriptMessage["attachments"] = [];
  for (const attachment of attachments) {
    const key = [
      trimOrUndefined(attachment.relativePath ?? undefined) ?? "",
      trimOrUndefined(attachment.path ?? undefined) ?? "",
      attachment.name
    ].join("::");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(attachment);
  }
  return output;
}

export function extractMessageAttachments(
  threadId: string,
  message: unknown,
  messageId: string
): ConversationTranscriptMessage["attachments"] {
  const obj = asRecord(message);
  const attachments = Array.isArray(obj?.attachments) ? obj.attachments : [];
  const extracted = attachments.flatMap((attachment, attachmentIndex) => {
    const attachmentObj = asRecord(attachment);
    if (!attachmentObj) return [];

    const attachmentName = trimOrUndefined(attachmentObj.name);
    const attachmentMimeType = trimOrUndefined(attachmentObj.contentType) ?? null;
    const attachmentKind = attachmentKindFromValue(attachmentObj.type);
    const hints = parseUploadedFileHints(collectTextParts(attachmentObj.content).join("\n"));

    if (hints.length === 0) {
      return [{
        id: `${messageId}-attachment-${attachmentIndex + 1}`,
        kind: attachmentKind,
        name: attachmentDisplayName(attachmentName, undefined, attachmentIndex),
        mimeType: attachmentMimeType,
        bytes: null,
        path: null,
        relativePath: null,
        contentUrl: null
      }];
    }

    return hints.map((hint, hintIndex) => {
      const relativePath = trimOrUndefined(hint.relativePath) ?? null;
      const filePath = trimOrUndefined(hint.path) ?? null;
      return {
        id: `${messageId}-attachment-${attachmentIndex + 1}-${hintIndex + 1}`,
        kind: attachmentKind,
        name: attachmentDisplayName(attachmentName, hint, attachmentIndex),
        mimeType: trimOrUndefined(hint.mimeType) ?? attachmentMimeType,
        bytes: typeof hint.bytes === "number" ? hint.bytes : null,
        path: filePath,
        relativePath,
        contentUrl: buildAdminThreadFileContentUrl(threadId, {
          relativePath,
          filePath
        })
      };
    });
  });

  return dedupeTranscriptAttachments(extracted);
}

function extractMessageCreatedAt(message: unknown): string | null {
  const obj = asRecord(message);
  return parseDateString(obj?.createdAt) ?? parseDateString(obj?.created_at);
}

function attachmentPreviewText(attachments: ConversationTranscriptMessage["attachments"]): string {
  if (attachments.length === 0) return "";
  const previewNames = attachments
    .map((item) => trimOrUndefined(item.name))
    .filter((item): item is string => Boolean(item))
    .slice(0, 3);
  if (previewNames.length === 0) return `上传了 ${attachments.length} 个文件`;
  return `上传了 ${attachments.length} 个文件：${previewNames.join("、")}${attachments.length > 3 ? " 等" : ""}`;
}

function transcriptPreviewText(message: ConversationTranscriptMessage): string {
  const processPreview = message.processRows?.[message.processRows.length - 1]?.title;
  return (
    trimOrUndefined(message.text) ??
    trimOrUndefined(attachmentPreviewText(message.attachments)) ??
    trimOrUndefined(processPreview) ??
    ""
  );
}

type ConversationTurnStatus = Pick<ConversationTranscriptMessage, "turnStatus" | "turnStatusReason">;

const USER_TURN_DISCONNECTED_REASON =
  "未找到对应助手消息；可能是请求失败、连接中断或历史记录缺失。";
const USER_TURN_RUNNING_REASON = "运行时仍在处理该请求，助手回复完成后会自动更新。";
const ASSISTANT_CANCELLED_REASON = "用户发送了新消息或取消了上一轮生成，本轮未完成。";
const ASSISTANT_FAILED_REASON = "运行时异常，用户侧已显示通用失败提示。";
const ASSISTANT_INCOMPLETE_REASON = "助手回复未完整结束，可能是连接断开或运行中途停止。";
const PERSISTED_RUNNING_STATUS_MAX_AGE_MS = 2 * 60 * 60_000;

function messageStatusRecord(message: unknown): Record<string, unknown> | null {
  return asRecord(asRecord(message)?.status);
}

function normalizedStatusField(status: Record<string, unknown> | null, key: "type" | "reason"): string | undefined {
  return trimOrUndefined(status?.[key])?.toLowerCase();
}

function messageIndicatesStopped(message: unknown): boolean {
  const row = asRecord(message);
  const metadata = asRecord(row?.metadata);
  const custom = asRecord(metadata?.custom);
  return metadata?.stopped === true || custom?.stopped === true;
}

export function projectConversationTurnStatus(
  message: unknown,
  role: ConversationTranscriptMessage["role"],
  options?: { hasAssistantResponse?: boolean; activeTurn?: boolean; nowMs?: number }
): ConversationTurnStatus {
  const status = messageStatusRecord(message);
  const statusType = normalizedStatusField(status, "type");
  const statusReason = normalizedStatusField(status, "reason");

  if (role === "user") {
    if (options?.hasAssistantResponse) return { turnStatus: "completed", turnStatusReason: null };
    if (statusType === "error" || statusType === "failed") {
      return { turnStatus: "failed", turnStatusReason: ASSISTANT_FAILED_REASON };
    }
    if (statusType === "incomplete") {
      if (statusReason === "cancelled" || statusReason === "aborted" || statusReason === "abort") {
        return { turnStatus: "cancelled", turnStatusReason: ASSISTANT_CANCELLED_REASON };
      }
      return { turnStatus: "disconnected", turnStatusReason: USER_TURN_DISCONNECTED_REASON };
    }
    const statusAt = parseDateString(trimOrUndefined(status?.at));
    const nowMs = options?.nowMs ?? Date.now();
    const persistedRunning =
      (statusType === "in_progress" || statusType === "running" || statusType === "pending") &&
      Boolean(statusAt) &&
      Math.max(0, nowMs - new Date(statusAt!).getTime()) <= PERSISTED_RUNNING_STATUS_MAX_AGE_MS;
    if (persistedRunning) return { turnStatus: "running", turnStatusReason: USER_TURN_RUNNING_REASON };
    if (options?.activeTurn) return { turnStatus: "running", turnStatusReason: USER_TURN_RUNNING_REASON };
    return { turnStatus: "disconnected", turnStatusReason: USER_TURN_DISCONNECTED_REASON };
  }

  if (role !== "assistant") {
    return { turnStatus: "completed", turnStatusReason: null };
  }

  if (statusType === "error" || statusReason === "error") {
    return { turnStatus: "failed", turnStatusReason: ASSISTANT_FAILED_REASON };
  }

  if (messageIndicatesStopped(message)) {
    return { turnStatus: "cancelled", turnStatusReason: ASSISTANT_CANCELLED_REASON };
  }

  if (statusType === "incomplete") {
    if (statusReason === "cancelled" || statusReason === "aborted" || statusReason === "abort") {
      return { turnStatus: "cancelled", turnStatusReason: ASSISTANT_CANCELLED_REASON };
    }
    return { turnStatus: "disconnected", turnStatusReason: ASSISTANT_INCOMPLETE_REASON };
  }

  return { turnStatus: "completed", turnStatusReason: null };
}

function toTranscriptMessage(threadId: string, item: StoredMessageItem, index: number): ConversationTranscriptMessage {
  const id = extractMessageId(item.message, `message-${index + 1}`);
  const role = extractMessageRole(item.message);
  const processRows = role === "assistant" ? extractMessageProcessRows(item.message) : [];
  const turnStatus = projectConversationTurnStatus(item.message, role, { hasAssistantResponse: true });
  return {
    id,
    role,
    text: extractMessageText(item.message),
    attachments: extractMessageAttachments(threadId, item.message, id),
    ...(processRows.length > 0 ? { processRows } : {}),
    ...turnStatus,
    parentId: item.parentId ?? null,
    createdAt: parseDateString(item.createdAt) ?? extractMessageCreatedAt(item.message),
    hasRunConfig: Boolean(item.runConfig && Object.keys(item.runConfig).length > 0)
  };
}

export function buildTranscriptMessages(
  threadId: string,
  messages: StoredMessageItem[],
  options: { activeTurn?: boolean } = {}
): ConversationTranscriptMessage[] {
  const transcript = messages.map((item, index) => toTranscriptMessage(threadId, item, index));
  return transcript.map((message, index) => {
    if (message.role !== "user") return message;
    const nextUserIndex = transcript.findIndex((candidate, candidateIndex) => (
      candidateIndex > index && candidate.role === "user"
    ));
    const searchEnd = nextUserIndex >= 0 ? nextUserIndex : transcript.length;
    const hasAssistantResponse = transcript
      .slice(index + 1, searchEnd)
      .some((candidate) => candidate.role === "assistant");
    const activeTurn = options.activeTurn === true && nextUserIndex < 0 && !hasAssistantResponse;
    return {
      ...message,
      ...projectConversationTurnStatus(
        messages[index]?.message,
        "user",
        { hasAssistantResponse, activeTurn }
      )
    };
  });
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

function buildConversationChannelSummary(
  binding: ExternalConversationBindingRecord | undefined,
  integrationMap: Map<string, IntegrationInstanceAuditRow>
): ConversationChannelSummary | null {
  if (!binding) return null;
  const integration = integrationMap.get(binding.integrationInstanceId);
  const type = trimOrUndefined(binding.channel) ?? "external";
  const metadata = asRecord(binding.metadata);
  const externalIdentity = asRecord(metadata?.externalIdentity);
  const sourceMetadata = asRecord(externalIdentity?.metadata);
  const label =
    type === "dingtalk_bot"
      ? binding.conversationType === "group"
        ? "钉钉群聊"
        : "钉钉单聊"
      : type === "zendesk"
        ? "Zendesk 工单"
      : type === "action_connector"
        ? "Action Connector"
      : type;
  return {
    type,
    label,
    integrationInstanceId: binding.integrationInstanceId,
    integrationName: integration?.name ?? binding.botName ?? null,
    conversationType: trimOrUndefined(binding.conversationType) ?? null,
    externalConversationId: trimOrUndefined(binding.externalConversationId) ?? null,
    externalConversationKey: trimOrUndefined(binding.externalConversationKey) ?? null,
    externalUserId: trimOrUndefined(binding.externalUserId) ?? null,
    externalUnionId: trimOrUndefined(binding.externalUnionId) ?? null,
    externalUserName: trimOrUndefined(binding.externalUserName) ?? null,
    externalGroupId: trimOrUndefined(binding.externalGroupId) ?? null,
    externalGroupName: trimOrUndefined(binding.externalGroupName) ?? null,
    botId: trimOrUndefined(binding.botId) ?? null,
    botName: trimOrUndefined(binding.botName) ?? integration?.name ?? null,
    agentModeId: trimOrUndefined(binding.agentModeId) ?? null,
    lastExternalMessageId: trimOrUndefined(binding.lastExternalMessageId) ?? null,
    lastMessageAt: trimOrUndefined(binding.lastMessageAt) ?? null,
    requesterOrganization: trimOrUndefined(metadata?.requesterOrganization) ?? null,
    requesterCountryRegion: trimOrUndefined(metadata?.requesterCountryRegion) ?? null,
    sourceSystem: trimOrUndefined(sourceMetadata?.sourceSystem) ?? null,
    sourceInstanceId: trimOrUndefined(sourceMetadata?.instanceId) ?? null,
    sourceInstanceShortId: trimOrUndefined(sourceMetadata?.instanceShortId) ?? null,
    sourceInstanceName: trimOrUndefined(sourceMetadata?.instanceName) ?? null,
    sourceInstanceNameIsDefault: sourceMetadata?.instanceNameIsDefault === true,
    sourceUserDisplayName: trimOrUndefined(sourceMetadata?.userDisplayName) ?? null,
    sourceLocalIPs: asStringArray(sourceMetadata?.localIPs)
  };
}

function buildConversationAgentModeSummary(
  agentModeId: string | undefined,
  agentModeMap: Map<string, AgentModeAuditRow>
): ConversationAgentModeSummary | null {
  if (!agentModeId) return null;
  const agentMode = agentModeMap.get(agentModeId);
  return {
    id: agentModeId,
    name: trimOrUndefined(agentMode?.name) ?? null,
    slug: trimOrUndefined(agentMode?.slug) ?? null,
    status: trimOrUndefined(agentMode?.status) ?? null
  };
}

function buildConversationSummary(
  thread: ThreadRecord,
  user: ConversationAuditUser | null,
  channel: ConversationChannelSummary | null = null,
  agentModeMap: Map<string, AgentModeAuditRow> = new Map()
): ConversationSummary {
  const transcript = buildTranscriptMessages(thread.id, thread.messages);
  const userMessages = transcript.filter((item) => item.role === "user");
  const assistantMessages = transcript.filter((item) => item.role === "assistant");
  const firstUserText = summarizeText(userMessages.map((item) => transcriptPreviewText(item)).find(Boolean), 180);
  const latestText = summarizeText(
    [...transcript]
      .reverse()
      .map((item) => transcriptPreviewText(item))
      .find(Boolean),
    240
  );
  const feedback = normalizeFeedback(thread.feedback);
  const userAttachmentCount = userMessages.reduce((sum, item) => sum + item.attachments.length, 0);
  const agentModeId = agentModeIdFromRunConfig(thread.codexRunConfig) ?? (channel?.agentModeId ?? undefined);

  return {
    id: thread.id,
    externalId: trimOrUndefined(thread.externalId) ?? null,
    audience: resolveConversationAudience(user, channel),
    title: conversationTitle(thread, firstUserText),
    status: thread.status,
    model: thread.model,
    reasoningEffort: thread.reasoningEffort,
    workspace: thread.workspace,
    enabledSkillNames: enabledSkillNamesFromRunConfig(thread.codexRunConfig),
    activeSession: Boolean(thread.sessionId),
    createdAt: thread.createdAt,
    updatedAt: thread.updatedAt,
    user,
    channel,
    agentMode: buildConversationAgentModeSummary(agentModeId, agentModeMap),
    metrics: {
      messageCount: transcript.length,
      userMessageCount: userMessages.length,
      assistantMessageCount: assistantMessages.length,
      feedbackCount: feedback.length,
      userAttachmentCount
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
      cacheWriteTokens: row.cacheWriteTokens ?? 0,
      outputTokens: row.outputTokens,
      totalTokens: usageTotalTokens(row.inputTokens, row.outputTokens),
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

function matchesSourceFilter(summary: ConversationSummary, filter: ConversationSourceFilter): boolean {
  return matchesConversationSourceFilter(summary, filter);
}

function matchesQuery(summary: ConversationSummary, query: string | undefined): boolean {
  const normalized = trimOrUndefined(query)?.toLowerCase();
  if (!normalized) return true;
  const haystack = [
    summary.id,
    summary.externalId,
    summary.audience,
    summary.title,
    summary.model,
    summary.reasoningEffort,
    summary.workspace,
    summary.channel?.type,
    summary.channel?.label,
    summary.channel?.integrationName,
    summary.channel?.conversationType,
    summary.channel?.externalConversationId,
    summary.channel?.externalConversationKey,
    summary.channel?.externalUserId,
    summary.channel?.externalUnionId,
    summary.channel?.externalUserName,
    summary.channel?.externalGroupId,
    summary.channel?.externalGroupName,
    summary.channel?.botId,
    summary.channel?.botName,
    summary.channel?.agentModeId,
    summary.agentMode?.id,
    summary.agentMode?.name,
    summary.agentMode?.slug,
    ...summary.enabledSkillNames,
    summary.user?.displayName,
    summary.user?.email,
    summary.user?.userType,
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

function matchesProductFeedbackType(record: ProductFeedbackRecord, filter: ProductFeedbackTypeFilter): boolean {
  return filter === "all" || record.type === filter;
}

function matchesProductFeedbackStatus(record: ProductFeedbackRecord, filter: ProductFeedbackStatusFilter): boolean {
  return filter === "all" || record.status === filter;
}

function matchesProductFeedbackQuery(record: ProductFeedbackRecord, query: string | undefined): boolean {
  const normalized = trimOrUndefined(query)?.toLowerCase();
  if (!normalized) return true;
  const contextText =
    record.context && typeof record.context === "object"
      ? JSON.stringify(record.context).slice(0, 6000)
      : typeof record.context === "string"
        ? record.context
        : "";
  const haystack = [
    record.id,
    record.organizationId,
    record.userId,
    record.threadId,
    record.type,
    record.severity,
    record.status,
    record.description,
    record.user?.displayName,
    record.user?.email,
    contextText
  ]
    .map((item) => (typeof item === "string" ? item.toLowerCase() : ""))
    .join("\n");
  return haystack.includes(normalized);
}

function compareProductFeedbackRecord(
  left: ProductFeedbackRecord,
  right: ProductFeedbackRecord,
  sort: ProductFeedbackSort
): number {
  const leftValue = sort === "updated_desc" ? Date.parse(left.updatedAt) : Date.parse(left.createdAt);
  const rightValue = sort === "updated_desc" ? Date.parse(right.updatedAt) : Date.parse(right.createdAt);
  return rightValue - leftValue;
}

function buildProductFeedbackAggregateSummary(records: ProductFeedbackRecord[]): ProductFeedbackListResponse["summary"] {
  return {
    totalFeedback: records.length,
    openCount: records.filter((item) => item.status === "open").length,
    triagedCount: records.filter((item) => item.status === "triaged").length,
    inProgressCount: records.filter((item) => item.status === "in_progress").length,
    resolvedCount: records.filter((item) => item.status === "resolved").length,
    closedCount: records.filter((item) => item.status === "closed").length,
    bugCount: records.filter((item) => item.type === "bug").length,
    featureRequestCount: records.filter((item) => item.type === "feature_request").length,
    usabilityIssueCount: records.filter((item) => item.type === "usability_issue").length,
    uniqueUsers: new Set(records.map((item) => item.userId).filter(Boolean)).size
  };
}

export function createConversationAuditRouter(options: {
  db?: ConversationAuditDb;
  getDb?: () => ConversationAuditDb;
  isThreadActive?: (threadId: string) => boolean | Promise<boolean>;
  productFeedbackReply?: ProductFeedbackReplyService;
} = {}): Router {
  const router = Router();
  let cachedDb: ConversationAuditDb | null = options.db ?? null;

  function getDb(): ConversationAuditDb {
    cachedDb ??= options.getDb?.() ?? (getDbClient() as unknown as ConversationAuditDb);
    return cachedDb;
  }

  function conversationRecords(): ConversationRecordService {
    const db = getDb();
    return new ConversationRecordService({
      threads: new ThreadRepository(db as unknown as ThreadRepositoryDb),
      externalConversations: new ExternalConversationBindingRepository(db as unknown as ExternalConversationBindingRepositoryDb)
    });
  }

  function usageLedger(): UsageLedgerService {
    return new UsageLedgerService({
      usageEvents: new UsageEventRepository(getDb() as unknown as UsageEventRepositoryDb)
    });
  }

  async function listConversationSummaries(): Promise<ConversationSummary[]> {
    const db = getDb();
    const records = conversationRecords();
    const [threads, users, integrations, agentModes] = await Promise.all([
      records.listThreads({ includeArchived: true }),
      db.user.findMany({ orderBy: { createdAt: "asc" } }),
      db.integrationInstance.findMany(),
      db.agentMode.findMany({ orderBy: { createdAt: "asc" } })
    ]);
    const visibleThreads = threads.filter((thread) => !thread.securityDomainId);
    const userMap = new Map(users.map((item) => [item.id, normalizeUser(item)]));
    const integrationMap = new Map(integrations.map((item) => [item.id, item] as const));
    const agentModeMap = new Map(agentModes.map((item) => [item.id, item] as const));
    const bindings = await records.listExternalConversationBindingsByThreadIds(visibleThreads.map((thread) => thread.id));
    const bindingByThreadId = new Map<string, ExternalConversationBindingRecord>();
    for (const binding of bindings) {
      if (!bindingByThreadId.has(binding.threadId)) {
        bindingByThreadId.set(binding.threadId, binding);
      }
    }
    return visibleThreads.map((thread) =>
      buildConversationSummary(
        thread,
        userMap.get(thread.userId ?? "") ?? null,
        buildConversationChannelSummary(bindingByThreadId.get(thread.id), integrationMap),
        agentModeMap
      )
    );
  }

  async function listApiAuditRecords(): Promise<ApiAuditRecord[]> {
    const db = getDb();
    const [events, integrations] = await Promise.all([
      usageLedger().listExternalApiEvents(),
      db.integrationInstance.findMany({
        where: { type: OPENAI_COMPATIBLE_API_TYPE }
      })
    ]);
    const integrationMap = new Map(integrations.map((item) => [item.id, item] as const));
    return events.map((event) => buildApiAuditRecord(event, integrationMap));
  }

  async function listProductFeedbackRecords(): Promise<ProductFeedbackRecord[]> {
    const db = getDb();
    return new ProductFeedbackRepository(db as unknown as ProductFeedbackRepositoryDb).list();
  }

  router.get("/product-feedback", async (req: Request, res: Response) => {
    try {
      const query = trimOrUndefined(req.query.query);
      const type = parseProductFeedbackType(req.query.type);
      const status = parseProductFeedbackStatus(req.query.status);
      const sort = parseProductFeedbackSort(req.query.sort);
      const requestedPage = parsePositiveInteger(req.query.page, 1, 1, 10_000);
      const pageSize = parsePositiveInteger(req.query.page_size, 24, 1, 100);

      const filtered = (await listProductFeedbackRecords())
        .filter((item) => matchesProductFeedbackType(item, type))
        .filter((item) => matchesProductFeedbackStatus(item, status))
        .filter((item) => matchesProductFeedbackQuery(item, query))
        .sort((left, right) => compareProductFeedbackRecord(left, right, sort));

      const totalItems = filtered.length;
      const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
      const page = Math.min(requestedPage, totalPages);
      const start = (page - 1) * pageSize;
      const feedback = filtered.slice(start, start + pageSize);

      res.json({
        filters: {
          query: query ?? "",
          type,
          status,
          sort
        },
        summary: buildProductFeedbackAggregateSummary(filtered),
        page: {
          page,
          pageSize,
          totalItems,
          totalPages
        },
        feedback
      } satisfies ProductFeedbackListResponse);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载系统反馈列表失败";
      res.status(500).json({ detail });
    }
  });

  router.get("/product-feedback/:feedbackId", async (req: Request, res: Response) => {
    try {
      const feedbackId = trimOrUndefined(req.params.feedbackId);
      if (!feedbackId) {
        res.status(400).json({ detail: "feedbackId 不合法" });
        return;
      }

      const repository = new ProductFeedbackRepository(getDb() as unknown as ProductFeedbackRepositoryDb);
      const feedback = await repository.get(feedbackId);
      if (!feedback) {
        res.status(404).json({ detail: "系统反馈不存在" });
        return;
      }

      const reply = options.productFeedbackReply
        ? await options.productFeedbackReply.getState(feedback)
        : undefined;
      res.json({ feedback, reply });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载系统反馈详情失败";
      res.status(500).json({ detail });
    }
  });

  const parseProductFeedbackReplyRequest = (req: Request) => {
    const rawPayload = typeof req.body?.payload === "string" ? req.body.payload : "";
    let payload: Record<string, unknown>;
    try {
      const parsed = rawPayload ? JSON.parse(rawPayload) : {};
      payload = parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed as Record<string, unknown>
        : {};
    } catch {
      throw new ProductFeedbackReplyError("回复内容格式不合法", 400, "invalid_reply_payload");
    }
    const selectedImageIds = Array.isArray(payload.selectedImageIds)
      ? payload.selectedImageIds.filter((value): value is string => typeof value === "string")
      : [];
    const uploads = (Array.isArray(req.files) ? req.files : []).map((file) => ({
      originalname: file.originalname,
      mimetype: file.mimetype,
      size: file.size,
      buffer: file.buffer
    }));
    return {
      subject: String(payload.subject ?? ""),
      bodyText: String(payload.bodyText ?? ""),
      templateLanguage: typeof payload.templateLanguage === "string" ? payload.templateLanguage : undefined,
      selectedImageIds,
      uploads,
      clientRequestId: typeof payload.clientRequestId === "string" ? payload.clientRequestId : ""
    };
  };

  const replyUploadMiddleware = (req: Request, res: Response, next: NextFunction) => {
    productFeedbackReplyImageUpload.array("images", PRODUCT_FEEDBACK_REPLY_MAX_IMAGES)(req, res, (error) => {
      if (!error) {
        next();
        return;
      }
      if (error instanceof MulterError) {
        const detail = error.code === "LIMIT_FILE_SIZE"
          ? "每张图片必须小于等于 2 MB。"
          : error.code === "LIMIT_FILE_COUNT"
            ? `邮件最多可插入 ${PRODUCT_FEEDBACK_REPLY_MAX_IMAGES} 张图片。`
            : "图片上传超过限制。";
        res.status(400).json({ detail, code: error.code });
        return;
      }
      res.status(400).json({
        detail: error instanceof Error ? error.message : "图片上传失败",
        code: "image_upload_failed"
      });
    });
  };

  router.post(
    "/product-feedback/:feedbackId/reply-preview",
    replyUploadMiddleware,
    async (req: Request, res: Response) => {
      if (!options.productFeedbackReply) {
        res.status(503).json({ detail: "系统反馈邮件回复服务不可用" });
        return;
      }
      try {
        const input = parseProductFeedbackReplyRequest(req);
        const result = await options.productFeedbackReply.preview({
          feedbackId: req.params.feedbackId,
          ...input
        });
        res.json(result);
      } catch (error) {
        const status = error instanceof ProductFeedbackReplyError ? error.statusCode : 500;
        res.status(status).json({
          detail: error instanceof Error ? error.message : "生成邮件预览失败",
          code: error instanceof ProductFeedbackReplyError ? error.code : undefined
        });
      }
    }
  );

  router.post(
    "/product-feedback/:feedbackId/reply-and-resolve",
    replyUploadMiddleware,
    async (req: Request, res: Response) => {
      if (!options.productFeedbackReply) {
        res.status(503).json({ detail: "系统反馈邮件回复服务不可用" });
        return;
      }
      try {
        const input = parseProductFeedbackReplyRequest(req);
        const result = await options.productFeedbackReply.sendAndResolve({
          feedbackId: req.params.feedbackId,
          ...input,
          actorUserId: req.currentUser?.id ?? null
        });
        res.status(201).json(result);
      } catch (error) {
        const status = error instanceof ProductFeedbackReplyError ? error.statusCode : 500;
        res.status(status).json({
          detail: error instanceof Error ? error.message : "发送反馈回复失败",
          code: error instanceof ProductFeedbackReplyError ? error.code : undefined
        });
      }
    }
  );

  router.patch("/product-feedback/:feedbackId", async (req: Request, res: Response) => {
    try {
      const feedbackId = trimOrUndefined(req.params.feedbackId);
      if (!feedbackId) {
        res.status(400).json({ detail: "feedbackId 不合法" });
        return;
      }
      const status = parseProductFeedbackStatus(req.body?.status);
      if (status === "all") {
        res.status(400).json({ detail: "status 不合法" });
        return;
      }

      const repository = new ProductFeedbackRepository(getDb() as unknown as ProductFeedbackRepositoryDb);
      const existing = await repository.get(feedbackId);
      if (!existing) {
        res.status(404).json({ detail: "系统反馈不存在" });
        return;
      }

      const feedback = await repository.updateStatus(feedbackId, status);
      res.json({ feedback });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "更新系统反馈失败";
      res.status(500).json({ detail });
    }
  });

  router.get("/conversations", async (req: Request, res: Response) => {
    try {
      const query = trimOrUndefined(req.query.query);
      const status = parseStatusFilter(req.query.status);
      const feedback = parseFeedbackFilter(req.query.feedback);
      const source = parseSourceFilter(req.query.source ?? req.query.audience);
      const sort = parseSort(req.query.sort);
      const requestedPage = parsePositiveInteger(req.query.page, 1, 1, 10_000);
      const pageSize = parsePositiveInteger(req.query.page_size, 24, 1, 100);

      const filtered = (await listConversationSummaries())
        .filter((item) => matchesStatusFilter(item, status))
        .filter((item) => matchesFeedbackFilter(item, feedback))
        .filter((item) => matchesSourceFilter(item, source))
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
          source,
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

  router.get("/conversations/ai-response-reviews", async (req: Request, res: Response) => {
    try {
      const repository = new AiResponseReviewRepository(getDb() as unknown as AiResponseReviewRepositoryDb);
      const query = trimOrUndefined(req.query.query);
      const status = parseAiResponseReviewStatus(req.query.status);
      const filter = parseAiResponseReviewFilter(req.query.filter);
      const sort = parseAiResponseReviewSort(req.query.sort);
      const source = trimOrUndefined(req.query.source) || "zendesk";
      const requestedPage = parsePositiveInteger(req.query.page, 1, 1, 10_000);
      const pageSize = parsePositiveInteger(req.query.page_size, 24, 1, 100);
      const result = await repository.list({
        query,
        source: source === "all" ? undefined : source,
        status,
        filter,
        sort,
        page: requestedPage,
        pageSize
      });
      res.json({
        filters: {
          query: query ?? "",
          source,
          status,
          filter: result.activeFilter,
          sort: result.activeSort
        },
        ...result
      });
    } catch (error) {
      const detail = error instanceof Error ? error.message : "加载 AI 评分列表失败";
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

  router.get("/conversations/:threadId/files/content", async (req: Request, res: Response) => {
    try {
      const threadId = trimOrUndefined(req.params.threadId);
      if (!threadId) {
        res.status(400).json({ detail: "threadId 不合法" });
        return;
      }

      const relativePath = trimOrUndefined(req.query.relative_path);
      const filePath = trimOrUndefined(req.query.path);
      if (!relativePath && !filePath) {
        res.status(400).json({ detail: "Either relative_path or path is required" });
        return;
      }

      const thread = await conversationRecords().getThread(threadId);
      if (!thread || thread.securityDomainId) {
        res.status(404).json({ detail: "thread 不存在" });
        return;
      }

      const workspacePath = trimOrUndefined(thread.workspace);
      if (!workspacePath) {
        res.status(404).json({ detail: "thread workspace 不存在" });
        return;
      }

      const absolutePath = await resolveExistingThreadFileAbsolutePath({
        workspacePath,
        threadId,
        relativePath,
        filePath
      });

      const stat = await fs.stat(absolutePath).catch(() => null);
      if (!stat || !stat.isFile()) {
        res.status(404).json({ detail: "文件不存在" });
        return;
      }

      const fileName = path.basename(absolutePath);
      if (
        await sendOfficePdfPreview(res, {
          requested: req.query.preview === "pdf",
          fileName,
          sourcePath: absolutePath
        })
      ) {
        return;
      }
      if (
        await sendStructuredPreview(res, {
          requested:
            typeof req.query.preview === "string" && req.query.preview !== "pdf"
              ? req.query.preview as "auto" | "text" | "table" | "diagram"
              : undefined,
          fileName,
          sourcePath: absolutePath,
          query: req.query
        })
      ) {
        return;
      }
      const ext = path.extname(fileName);
      const fileBuffer = await fs.readFile(absolutePath);

      res.setHeader("Cache-Control", "private, max-age=60");
      res.setHeader("X-Content-Type-Options", "nosniff");
      res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(fileName)}`);
      res.type(ext || await detectedContentType({ fileName, sourcePath: absolutePath }));
      res.status(200).send(fileBuffer);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "读取会话附件失败";
      res.status(400).json({ detail });
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
      const records = conversationRecords();
      const thread = await records.getThread(threadId);
      if (!thread || thread.securityDomainId) {
        res.status(404).json({ detail: "thread 不存在" });
        return;
      }

      const [userRow, bindings, integrationRows, agentModeRows] = await Promise.all([
        thread.userId ? db.user.findUnique({ where: { id: thread.userId } }) : Promise.resolve(null),
        records.listExternalConversationBindingsByThreadIds([thread.id]),
        db.integrationInstance.findMany(),
        db.agentMode.findMany({ orderBy: { createdAt: "asc" } })
      ]);
      const user = normalizeUser(userRow);
      const [binding] = bindings;
      const integrationMap = new Map(integrationRows.map((item) => [item.id, item] as const));
      const agentModeMap = new Map(agentModeRows.map((item) => [item.id, item] as const));
      const activeTurn = await options.isThreadActive?.(thread.id);
      const transcript = buildTranscriptMessages(thread.id, thread.messages, {
        activeTurn: activeTurn === true
      });

      res.json({
        conversation: buildConversationSummary(thread, user, buildConversationChannelSummary(binding, integrationMap), agentModeMap),
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
