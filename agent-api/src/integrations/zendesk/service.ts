import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import type { IncomingHttpHeaders } from "node:http";
import path from "node:path";

import { CodexRuntime } from "../../codex-runtime.js";
import {
  extractRuntimeUsageFromStreamEvent,
  stripInternalRunConfigMetadata,
  type RuntimeUsageSnapshot
} from "../../live-runtime-session.js";
import { ZendeskApiError, ZendeskClient } from "./client.js";
import { ZendeskBindingStore } from "./binding-store.js";
import {
  buildInternalNoteFromDecision,
  buildZendeskAgentPrompt,
  parseZendeskAgentDecision
} from "./prompt.js";
import type { ZendeskPromptKnowledgeSet } from "./prompt.js";
import {
  computeWebhookUrl,
  defaultDingTalkNotificationTemplate,
  findZendeskReadinessGaps,
  redactZendeskSettings,
  ZendeskSettingsStore
} from "./settings-store.js";
import { ZendeskRunStore } from "./run-store.js";
import type {
  ZendeskAgentDecision,
  ZendeskBindingRecord,
  ZendeskCommentPayload,
  ZendeskIntegrationSettings,
  ZendeskOverview,
  ZendeskRequesterPayload,
  ZendeskSetupGuide,
  ZendeskTicketContext,
  ZendeskRunStatus
} from "./types.js";
import type { ReasoningEffort } from "../../model-config.js";

type ZendeskSettingsStoreBridge = {
  get(): Promise<ZendeskIntegrationSettings>;
  getForInstance(instanceId: string): Promise<ZendeskIntegrationSettings>;
  update(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    }
  ): Promise<ZendeskIntegrationSettings>;
  updateForInstance(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId: string
  ): Promise<ZendeskIntegrationSettings>;
  rememberValidation(user: { id: number; name: string; email?: string; role?: string }): Promise<ZendeskIntegrationSettings>;
  rememberValidationForInstance(
    user: { id: number; name: string; email?: string; role?: string },
    instanceId: string
  ): Promise<ZendeskIntegrationSettings>;
};

type ProcessTicketResult = {
  status: ZendeskRunStatus;
  detail: string;
  runId: string;
  commentId?: number;
  requesterCommentId?: number;
  decision?: ZendeskAgentDecision["decision"];
};

type ZendeskProcessableInputKind = "requester_public_comment" | "voice_transcript";

type ZendeskProcessableComment = {
  comment: ZendeskCommentPayload;
  kind: ZendeskProcessableInputKind;
  forceInternalNote: boolean;
};

type ZendeskAgentRuntimeOptions = {
  runtime?: CodexRuntime;
  model: string;
  reasoningEffort: ReasoningEffort;
  workspace: string;
  codexRunConfig?: Record<string, unknown>;
  knowledgeSets?: ZendeskPromptKnowledgeSet[];
  enabledSkills?: Array<{
    id: string;
    name: string;
    managedSkillId?: string;
    sourcePath?: string;
    activationPrompt?: string;
  }>;
};

type ZendeskConversationAuditAction = {
  mode: "skip" | "comment";
  publicReply?: boolean;
  body?: string;
  status: ZendeskRunStatus;
  detail: string;
  decision: ZendeskAgentDecision["decision"];
};

type ZendeskUsageTelemetryInput = {
  usage: RuntimeUsageSnapshot;
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
  runtime: Omit<ZendeskAgentRuntimeOptions, "runtime">;
  codexThreadId?: string;
  auditThreadId?: string;
  externalConversationKey?: string;
};

type ZendeskConversationAuditState = {
  threadId: string;
  userMessageId?: string;
  externalConversationKey?: string;
};

type ZendeskAuditProcessRow = {
  id?: string;
  kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
  title: string;
  detail?: string;
  rawDetail?: string;
  at?: string;
};

type ZendeskConversationAuditSync = {
  beforeAgentRun(input: {
    settings: ZendeskIntegrationSettings;
    context: ZendeskTicketContext;
    requesterComment: ZendeskCommentPayload;
    binding?: ZendeskBindingRecord;
    instanceId?: string;
    ticketId: string;
    runId: string;
    source: "webhook" | "manual";
    runtime: Omit<ZendeskAgentRuntimeOptions, "runtime">;
  }): Promise<ZendeskConversationAuditState | undefined>;
  afterAgentRun(input: {
    settings: ZendeskIntegrationSettings;
    context: ZendeskTicketContext;
    requesterComment: ZendeskCommentPayload;
    binding?: ZendeskBindingRecord;
    audit?: ZendeskConversationAuditState;
    instanceId?: string;
    ticketId: string;
    runId: string;
    source: "webhook" | "manual";
    runtime: Omit<ZendeskAgentRuntimeOptions, "runtime">;
    answerText: string;
    decision: ZendeskAgentDecision;
    action: ZendeskConversationAuditAction;
    commentId?: number;
    codexThreadId?: string;
    processRows?: ZendeskAuditProcessRow[];
  }): Promise<void>;
};

type ZendeskRuntimeThread = Awaited<ReturnType<CodexRuntime["startThreadWithOptions"]>>;

type ZendeskRuntimeLike = {
  startThreadWithOptions(options: {
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<ZendeskRuntimeThread>;
  resumeThreadWithOptions(options: {
    threadId: string;
    model: string;
    reasoningEffort: ReasoningEffort;
    workspace: string;
    codexRunConfig?: Record<string, unknown>;
  }): Promise<ZendeskRuntimeThread>;
  runStreamed(thread: ZendeskRuntimeThread, message: string): AsyncGenerator<{ type: string; delta?: string; text?: string; raw?: unknown }>;
};

type ZendeskRuntimeSessionInput = {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  binding?: ZendeskBindingRecord;
  audit?: ZendeskConversationAuditState;
  instanceId?: string;
  ticketId: string;
  runId: string;
  source: "webhook" | "manual";
  runtime: ZendeskRuntimeLike;
  runtimeOptions: Omit<ZendeskAgentRuntimeOptions, "runtime">;
};

type ZendeskRuntimeSessionLease = {
  thread: ZendeskRuntimeThread;
  sessionId?: string;
  codexThreadId?: string;
  status?: "started" | "restored" | "replaced";
  detail?: string;
};

type ZendeskRuntimeSessionBridge = {
  acquire(input: ZendeskRuntimeSessionInput): Promise<ZendeskRuntimeSessionLease | undefined>;
  replace(
    input: ZendeskRuntimeSessionInput & {
      previous?: ZendeskRuntimeSessionLease;
      failedCodexThreadId?: string;
      error?: unknown;
    }
  ): Promise<ZendeskRuntimeSessionLease | undefined>;
  persistCodexThreadId?(
    input: ZendeskRuntimeSessionInput & {
      lease: ZendeskRuntimeSessionLease;
      codexThreadId: string;
    }
  ): Promise<ZendeskRuntimeSessionLease | undefined | void>;
};

type ZendeskAgentRunResult = {
  answerText: string;
  preparedContext: ZendeskTicketContext;
  runtimeOptions: Omit<ZendeskAgentRuntimeOptions, "runtime">;
  audit?: ZendeskConversationAuditState;
  codexThreadId?: string;
  processRows: ZendeskAuditProcessRow[];
};

type ZendeskDingTalkMentionTarget = {
  userIds: string[];
  label?: string;
  detail?: string;
};

function sanitizeTicketId(value: string | number): string {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error("ticket_id 不能为空");
  return normalized;
}

function buildRunConfig(settings: ZendeskIntegrationSettings): Record<string, unknown> {
  const runConfig: Record<string, unknown> = {
    sandboxMode: settings.sandboxMode,
    approvalPolicy: settings.approvalPolicy,
    networkAccessEnabled: settings.networkAccessEnabled,
    webSearchMode: settings.webSearchMode
  };
  if (settings.additionalDirectories.length > 0) {
    runConfig.additionalDirectories = settings.additionalDirectories;
  }
  return runConfig;
}

function normalizeMultilineBody(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, 20000);
}

function selectLatestRequesterComment(context: ZendeskTicketContext) {
  const requesterId = context.ticket.requesterId;
  if (!requesterId) return undefined;
  return context.comments.find(
    (item) => item.public && item.authorId === requesterId && (item.body.trim() || (item.attachments?.length ?? 0) > 0)
  );
}

function normalizeTextForMatch(value: string | undefined): string {
  return String(value || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function isVoiceTranscriptComment(context: ZendeskTicketContext, comment: ZendeskCommentPayload): boolean {
  if (comment.public) return false;
  const body = normalizeTextForMatch(comment.body);
  const subject = normalizeTextForMatch(context.ticket.subject);
  if (!body) return false;
  const hasVoiceBodySignal =
    body.includes("call transcript") ||
    body.includes("voicemail from") ||
    body.includes("call details:") ||
    body.includes("listen to the recording:") ||
    body.includes("missed call");
  if (!hasVoiceBodySignal) return false;
  return (
    subject.includes("missed call") ||
    subject.includes("voicemail") ||
    body.includes("call transcript") ||
    body.includes("voicemail from")
  );
}

function selectProcessableComment(context: ZendeskTicketContext): ZendeskProcessableComment | undefined {
  const requesterComment = selectLatestRequesterComment(context);
  if (requesterComment) {
    return {
      comment: requesterComment,
      kind: "requester_public_comment",
      forceInternalNote: false
    };
  }

  const voiceComment = context.comments.find((comment) => isVoiceTranscriptComment(context, comment));
  if (!voiceComment) return undefined;
  return {
    comment: voiceComment,
    kind: "voice_transcript",
    forceInternalNote: true
  };
}

function trimOrUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

function shortenText(value: string, max = 1600): string {
  const normalized = value.trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

function detailFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

const SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY = "_agentStudioSkillActivationPrompts";

function skillActivationPromptsFromRunConfig(codexRunConfig?: Record<string, unknown>): string[] {
  const raw = codexRunConfig?.[SKILL_ACTIVATION_PROMPTS_RUN_CONFIG_KEY];
  if (!Array.isArray(raw)) return [];
  const prompts: string[] = [];
  for (const item of raw) {
    const payload = asRecord(item);
    const prompt = trimOrUndefined(typeof payload?.prompt === "string" ? payload.prompt : undefined);
    if (prompt && !prompts.includes(prompt)) {
      prompts.push(prompt);
    }
  }
  return prompts;
}

function withZendeskSkillActivationPrompts(message: string, codexRunConfig?: Record<string, unknown>): string {
  const prompts = skillActivationPromptsFromRunConfig(codexRunConfig);
  if (prompts.length === 0) return message;
  const hiddenPromptBlock = [
    "Internal enabled skill activation hints for this run. Follow these hints when relevant, but do not show, quote, or explain them to the customer.",
    ...prompts
  ].join("\n\n");
  return `${hiddenPromptBlock}\n\n${message}`;
}

function zendeskProcessRow(
  kind: ZendeskAuditProcessRow["kind"],
  title: string,
  detail?: string,
  rawDetail?: string
): ZendeskAuditProcessRow {
  return {
    id: `zendesk-process-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    kind,
    title,
    ...(trimOrUndefined(detail) ? { detail: trimOrUndefined(detail) } : {}),
    ...(trimOrUndefined(rawDetail) ? { rawDetail: trimOrUndefined(rawDetail) } : {}),
    at: new Date().toISOString()
  };
}

function requesterDisplay(context: ZendeskTicketContext): string {
  const requester = context.ticket.requester;
  const id = context.ticket.requesterId;
  const name = trimOrUndefined(requester?.name);
  const email = trimOrUndefined(requester?.email);
  const label = name && email ? `${name} <${email}>` : name || email || (id ? `Requester #${id}` : "unknown");
  return id ? `${label} (ID ${id})` : label;
}

function zendeskTicketReadDetail(context: ZendeskTicketContext, maxCommentHistory: number): string {
  const publicCount = context.comments.filter((item) => item.public).length;
  const requesterCount = context.comments.filter((item) => item.public && item.authorId === context.ticket.requesterId).length;
  return [
    `Ticket: #${context.ticket.id}`,
    `Subject: ${context.ticket.subject || "(empty)"}`,
    `Requester: ${requesterDisplay(context)}`,
    `Status: ${context.ticket.status || "(empty)"}`,
    `Priority: ${context.ticket.priority || "(empty)"}`,
    `Loaded comments: ${context.comments.length}/${maxCommentHistory}`,
    `Public comments: ${publicCount}`,
    `Requester public comments: ${requesterCount}`
  ].join("\n");
}

function summarizePreparedAttachments(context: ZendeskTicketContext): string {
  const attachments = context.comments.flatMap((comment) =>
    comment.attachments.map((attachment) => ({
      commentId: comment.id,
      attachment
    }))
  );
  if (attachments.length === 0) return "No Zendesk attachments in the selected comment history.";
  return attachments
    .slice(0, 30)
    .map(({ commentId, attachment }) => {
      const status = attachment.downloadStatus || "metadata_only";
      const bits = [
        `comment ${commentId}`,
        attachment.fileName,
        attachment.contentType,
        attachment.size !== undefined ? `${attachment.size} bytes` : undefined,
        status,
        attachment.relativePath ? `path=${attachment.relativePath}` : undefined,
        attachment.downloadReason ? `reason=${attachment.downloadReason}` : undefined
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    })
    .join("\n");
}

function collectRuntimeProcessRow(
  event: { type: string; delta?: string; text?: string; raw?: unknown },
  processRows: ZendeskAuditProcessRow[]
): void {
  if (processRows.length >= 120) return;
  const raw = asRecord(event.raw);
  const item = asRecord(raw?.item);
  const eventType = event.type;
  const itemType = trimOrUndefined(item?.type) ?? "";
  if (!item || !itemType || eventType !== "item.completed") return;

  if (itemType === "reasoning") {
    const reasoningText = trimOrUndefined(item.text) ?? trimOrUndefined(event.text);
    if (reasoningText) {
      processRows.push(zendeskProcessRow("reasoning", "Model reasoning summary", shortenText(reasoningText, 1800)));
    }
    return;
  }

  if (itemType === "command_execution") {
    const command = trimOrUndefined(item.command) ?? "";
    const output = trimOrUndefined(item.aggregated_output) ?? "";
    const status = trimOrUndefined(item.status);
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
    processRows.push(
      zendeskProcessRow(
        "tool",
        "Command execution completed",
        [
          command ? `$ ${command}` : "",
          status ? `status=${status}` : "",
          exitCode !== undefined ? `exit_code=${exitCode}` : "",
          output ? `output:\n${shortenText(output, 1200)}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      )
    );
    return;
  }

  if (itemType === "mcp_tool_call") {
    const server = trimOrUndefined(item.server) ?? "";
    const tool = trimOrUndefined(item.tool) ?? "";
    const error = asRecord(item.error);
    const errMsg = trimOrUndefined(error?.message);
    processRows.push(
      zendeskProcessRow(
        errMsg ? "error" : "tool",
        `Tool call ${errMsg ? "failed" : "completed"}`,
        [
          server ? `server: ${server}` : "",
          tool ? `tool: ${tool}` : "",
          errMsg ? `error: ${shortenText(errMsg, 600)}` : "",
          item.result !== undefined ? `result:\n${shortenText(detailFromUnknown(item.result), 1200)}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      )
    );
    return;
  }

  if (itemType === "web_search") {
    const query = trimOrUndefined(item.query);
    processRows.push(zendeskProcessRow("tool", "Web search completed", query));
    return;
  }

  if (itemType === "todo_list") {
    const items = Array.isArray(item.items) ? item.items : [];
    const detail = items
      .slice(0, 20)
      .map((entry) => {
        const obj = asRecord(entry);
        if (!obj) return "";
        const text = trimOrUndefined(obj.text);
        if (!text) return "";
        return `${obj.completed ? "[x]" : "[ ]"} ${text}`;
      })
      .filter(Boolean)
      .join("\n");
    processRows.push(zendeskProcessRow("process", "Execution plan updated", detail));
    return;
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const detail = changes
      .slice(0, 30)
      .map((entry) => {
        const obj = asRecord(entry);
        const filePath = trimOrUndefined(obj?.path);
        if (!filePath) return "";
        const kind = trimOrUndefined(obj?.kind) ?? "update";
        return `${kind}: ${filePath}`;
      })
      .filter(Boolean)
      .join("\n");
    processRows.push(zendeskProcessRow("process", "File changes produced", detail));
    return;
  }

  if (itemType === "error") {
    const message = trimOrUndefined(item.message) ?? detailFromUnknown(item);
    processRows.push(zendeskProcessRow("error", "Execution error", shortenText(message, 1200)));
  }
}

function extractCodexThreadIdFromThread(thread: unknown): string | undefined {
  if (!thread || typeof thread !== "object") return undefined;
  return trimOrUndefined((thread as { id?: unknown }).id);
}

function extractCodexThreadIdFromEvent(event: { type?: string; raw?: unknown }): string | undefined {
  if (event.type !== "thread.started") return undefined;
  const raw = event.raw && typeof event.raw === "object" ? (event.raw as Record<string, unknown>) : undefined;
  return trimOrUndefined(raw?.thread_id);
}

function sanitizePathSegment(value: string | number | undefined, fallback: string): string {
  const normalized = String(value || "")
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized || fallback;
}

function sanitizeFileName(value: string, fallback: string): string {
  const normalized = value
    .trim()
    .replace(/[\\/:\0]+/g, "-")
    .replace(/^\.+/, "")
    .slice(0, 160);
  return normalized || fallback;
}

function hasWildcardMime(allowed: string[]): boolean {
  return allowed.some((item) => item.trim().toLowerCase() === "*/*");
}

function isMimeAllowed(contentType: string | undefined, allowed: string[], restrictionEnabled = true): boolean {
  if (!restrictionEnabled || hasWildcardMime(allowed)) return true;
  const normalized = String(contentType || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!normalized) return false;
  return allowed.some((item) => {
    const pattern = item.trim().toLowerCase();
    if (!pattern) return false;
    if (pattern === "*/*" || pattern === normalized) return true;
    if (pattern.endsWith("/*")) {
      return normalized.startsWith(`${pattern.slice(0, -1)}`);
    }
    return false;
  });
}

function zendeskHostSegment(settings: ZendeskIntegrationSettings): string {
  try {
    return sanitizePathSegment(new URL(settings.zendeskBaseUrl).hostname, "zendesk");
  } catch {
    return "zendesk";
  }
}

function attachmentIdentity(input: {
  attachment: ZendeskCommentPayload["attachments"][number];
  index: number;
}): string {
  if (input.attachment.id !== undefined) {
    return `att-${sanitizePathSegment(input.attachment.id, "attachment")}`;
  }
  const hash = createHash("sha256")
    .update(
      [
        input.attachment.contentUrl || "",
        input.attachment.mappedContentUrl || "",
        input.attachment.fileName || "",
        input.attachment.contentType || "",
        input.attachment.size ?? "",
        input.index
      ].join("\n")
    )
    .digest("hex")
    .slice(0, 16);
  return `url-${hash}`;
}

function attachmentCachePath(input: {
  workspacePath: string;
  settings: ZendeskIntegrationSettings;
  ticketId: string | number;
  commentId: string | number;
  attachment: ZendeskCommentPayload["attachments"][number];
  index: number;
}): string {
  const cacheDir = path.join(
    input.workspacePath,
    ".zendesk",
    "attachments",
    "cache",
    zendeskHostSegment(input.settings),
    `ticket-${sanitizePathSegment(input.ticketId, "ticket")}`,
    `comment-${sanitizePathSegment(input.commentId, "comment")}`
  );
  const fileName = `${attachmentIdentity(input)}-${sanitizeFileName(input.attachment.fileName, "attachment")}`;
  return path.join(cacheDir, fileName);
}

async function cachedAttachmentSize(
  filePath: string,
  attachment: ZendeskCommentPayload["attachments"][number],
  maxBytes: number
): Promise<number | undefined> {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > maxBytes) return undefined;
    if (attachment.size !== undefined && stat.size !== attachment.size) return undefined;
    return stat.size;
  } catch {
    return undefined;
  }
}

function orderCommentsForAttachmentDownload(
  comments: ZendeskTicketContext["comments"],
  preferredCommentId?: number
): ZendeskTicketContext["comments"] {
  if (!preferredCommentId) return comments;
  const preferred = comments.filter((comment) => comment.id === preferredCommentId);
  if (preferred.length === 0) return comments;
  return [...preferred, ...comments.filter((comment) => comment.id !== preferredCommentId)];
}

function attachmentDisplaySize(bytes: number | undefined): string {
  if (!Number.isFinite(bytes)) return "";
  const value = Number(bytes);
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  if (value >= 1024) return `${Math.round(value / 1024)} KB`;
  return `${value} B`;
}

function cloneContext(context: ZendeskTicketContext): ZendeskTicketContext {
  return {
    ticket: { ...context.ticket, tags: [...context.ticket.tags] },
    comments: context.comments.map((comment) => ({
      ...comment,
      attachments: (comment.attachments ?? []).map((attachment) => ({ ...attachment }))
    }))
  };
}

type ResolvedAction =
  | {
      mode: "skip";
      status: ZendeskRunStatus;
      detail: string;
      decision: ZendeskAgentDecision["decision"];
    }
  | {
      mode: "comment";
      publicReply: boolean;
      body: string;
      status: ZendeskRunStatus;
      detail: string;
      decision: ZendeskAgentDecision["decision"];
    };

function resolveAction(
  settings: ZendeskIntegrationSettings,
  decision: ZendeskAgentDecision,
  options: { forceInternalNote?: boolean } = {}
): ResolvedAction {
  if (settings.responseMode === "internal_note" || options.forceInternalNote) {
    const body = normalizeMultilineBody(buildInternalNoteFromDecision(decision));
    return {
      mode: "comment",
      publicReply: false,
      body,
      status: decision.decision === "handoff" ? "handoff" : "noted",
      detail: options.forceInternalNote
        ? "语音转写工单已强制记录为内部备注"
        : decision.decision === "handoff"
          ? "已记录内部备注，等待人工接管"
          : "已记录内部备注",
      decision: decision.decision
    };
  }

  if (decision.decision === "public_reply" && decision.body.trim()) {
    return {
      mode: "comment",
      publicReply: true,
      body: normalizeMultilineBody(decision.body),
      status: "replied",
      detail: "已发送公开回复",
      decision: decision.decision
    };
  }

  if (settings.fallbackMode === "internal_note") {
    return {
      mode: "comment",
      publicReply: false,
      body: normalizeMultilineBody(buildInternalNoteFromDecision(decision)),
      status: decision.decision === "handoff" ? "handoff" : "noted",
      detail: decision.decision === "handoff" ? "模型建议转人工，已写入内部备注" : "已降级为内部备注",
      decision: decision.decision
    };
  }

  return {
    mode: "skip",
    status: "skipped",
    detail: "模型未给出公开回复，且当前配置为跳过兜底动作",
    decision: decision.decision
  };
}

const MAX_DINGTALK_MARKDOWN_CHARS = 12000;
const DINGTALK_TEMPLATE_PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

function formatDingTalkPercent(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "Not provided";
  return `${Math.round(value * 100)}%`;
}

function zendeskUserDisplay(user: ZendeskRequesterPayload | undefined, fallback = "Unassigned"): string {
  const name = trimOrUndefined(user?.name);
  const email = trimOrUndefined(user?.email);
  if (name && email) return `${name} <${email}>`;
  return name || email || fallback;
}

function zendeskDecisionLabel(decision: ZendeskAgentDecision["decision"], publicReply: boolean): string {
  if (publicReply) return "Public reply";
  if (decision === "handoff") return "Internal handoff note";
  return "Internal note";
}

function truncateDingTalkSection(value: string, maxChars: number): string {
  const normalized = value.trim();
  if (normalized.length <= maxChars) return normalized;
  return `${normalized.slice(0, Math.max(0, maxChars - 34)).trimEnd()}\n\n[Content truncated for DingTalk.]`;
}

function formatDingTalkList(items: string[] | undefined): string {
  if (!items?.length) return "- Not provided";
  return items.map((item) => `- ${item.replace(/\s+/g, " ").trim()}`).join("\n");
}

function dingtalkTriggerLabel(source: "webhook" | "manual"): string {
  return source === "manual" ? "Manual run" : "Zendesk webhook";
}

function stripInternalNoteEnvelope(value: string): string {
  const normalized = value.trim();
  const match = normalized.match(/\bInternal note:\s*([\s\S]*)/i);
  return (match?.[1] || normalized).trim();
}

function dingTalkAiContent(input: {
  decision: ZendeskAgentDecision;
  action: Extract<ResolvedAction, { mode: "comment" }>;
}): string {
  if (input.action.publicReply) {
    return (
      trimOrUndefined(input.decision.body) ||
      trimOrUndefined(input.action.body) ||
      trimOrUndefined(input.decision.publicReplyPreview) ||
      "No public reply was generated."
    );
  }

  const internalNote =
    trimOrUndefined(input.decision.internalNote) ||
    trimOrUndefined(input.decision.body) ||
    (trimOrUndefined(input.action.body) ? stripInternalNoteEnvelope(input.action.body) : undefined);
  return internalNote || "No internal note was generated.";
}

function renderDingTalkTemplate(template: string, values: Record<string, string>): string {
  return template.replace(DINGTALK_TEMPLATE_PLACEHOLDER_RE, (_match, key: string) => values[key] ?? "");
}

function capDingTalkMarkdown(markdown: string, mentionText: string): string {
  const normalized = markdown.trim();
  if (normalized.length <= MAX_DINGTALK_MARKDOWN_CHARS) return normalized;

  const mentionFooter = mentionText ? `\n\n---\n${mentionText}` : "";
  const body = mentionFooter && normalized.endsWith(mentionFooter) ? normalized.slice(0, -mentionFooter.length) : normalized;
  const maxBodyChars = Math.max(0, MAX_DINGTALK_MARKDOWN_CHARS - mentionFooter.length - 34);
  return `${body.slice(0, maxBodyChars).trimEnd()}\n\n[Content truncated for DingTalk.]${mentionFooter}`;
}

function dingtalkMentionText(atUserIds: string[]): string {
  return atUserIds
    .map((item) => item.trim())
    .filter((item, index, array) => item && array.indexOf(item) === index)
    .map((item) => `@${item}`)
    .join(" ");
}

function isRecoverableCodexResumeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || "");
  return /thread\/resume failed|no rollout found for thread id/i.test(message);
}

function buildZendeskDingTalkMarkdown(input: {
  settings: ZendeskIntegrationSettings;
  context: ZendeskTicketContext;
  requesterComment: ZendeskCommentPayload;
  ticketId: string;
  ticketUrl: string;
  runId: string;
  source: "webhook" | "manual";
  decision: ZendeskAgentDecision;
  action: Extract<ResolvedAction, { mode: "comment" }>;
  commentId?: number;
  mentionLabel?: string;
  atUserIds?: string[];
}): string {
  const ticket = input.context.ticket;
  const template = trimOrUndefined(input.settings.dingtalkNotificationTemplate) || defaultDingTalkNotificationTemplate();
  const mentionText = dingtalkMentionText(input.atUserIds ?? []);
  const mentionLabel = input.mentionLabel ? `@${input.mentionLabel}` : mentionText;
  const baseValues = {
    ticketId: input.ticketId,
    ticketUrl: input.ticketUrl,
    subject: ticket.subject || "Untitled ticket",
    requester: zendeskUserDisplay(ticket.requester, "Unknown requester"),
    assignee: zendeskUserDisplay(ticket.assignee),
    result: zendeskDecisionLabel(input.decision.decision, input.action.publicReply),
    confidence: formatDingTalkPercent(input.decision.confidence),
    trigger: dingtalkTriggerLabel(input.source),
    commentId: input.commentId ? String(input.commentId) : "Not recorded",
    requesterCommentId: String(input.requesterComment.id),
    reasons: formatDingTalkList(input.decision.reasons),
    publicReplyPreview: trimOrUndefined(input.decision.publicReplyPreview) || "Not provided",
    mention: mentionText,
    mentionLabel
  };
  const rawAiContent = dingTalkAiContent({ decision: input.decision, action: input.action });
  const renderWithAiContent = (aiContent: string) => renderDingTalkTemplate(template, { ...baseValues, aiContent });
  let markdown = renderWithAiContent(rawAiContent);
  if (mentionText && !markdown.includes(mentionText)) {
    markdown = `${markdown.trimEnd()}\n\n---\n${mentionText}`;
  }

  if (markdown.length > MAX_DINGTALK_MARKDOWN_CHARS) {
    const withoutContent = renderWithAiContent("");
    const availableForContent = Math.max(
      1200,
      MAX_DINGTALK_MARKDOWN_CHARS - withoutContent.length - (mentionText ? mentionText.length + 10 : 0) - 80
    );
    markdown = renderWithAiContent(truncateDingTalkSection(rawAiContent, availableForContent));
    if (mentionText && !markdown.includes(mentionText)) {
      markdown = `${markdown.trimEnd()}\n\n---\n${mentionText}`;
    }
  }

  return capDingTalkMarkdown(markdown, mentionText);
}

function signedDingTalkWebhookUrl(webhookUrl: string, secret: string): string {
  const normalizedSecret = trimOrUndefined(secret);
  if (!normalizedSecret) return webhookUrl;
  const timestamp = String(Date.now());
  const sign = createHmac("sha256", normalizedSecret)
    .update(`${timestamp}\n${normalizedSecret}`)
    .digest("base64");
  const url = new URL(webhookUrl);
  url.searchParams.set("timestamp", timestamp);
  url.searchParams.set("sign", sign);
  return url.toString();
}

async function postDingTalkRobotMarkdown(input: {
  webhookUrl: string;
  robotSecret: string;
  title: string;
  markdown: string;
  atUserIds: string[];
}): Promise<void> {
  const endpoint = signedDingTalkWebhookUrl(input.webhookUrl, input.robotSecret);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      msgtype: "markdown",
      markdown: {
        title: input.title,
        text: input.markdown
      },
      at: {
        atUserIds: input.atUserIds,
        isAtAll: false
      }
    })
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`DingTalk robot notification failed (${response.status}): ${shortenText(text, 500)}`);
  }
  const payload = safeParseDingTalkResponse(text);
  const code = Number(payload?.errcode ?? 0);
  if (Number.isFinite(code) && code !== 0) {
    throw new Error(`DingTalk robot notification failed (${code}): ${trimOrUndefined(payload?.errmsg) || "unknown error"}`);
  }
}

function safeParseDingTalkResponse(input: string): Record<string, unknown> | undefined {
  const text = input.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text);
    return asRecord(parsed);
  } catch {
    return undefined;
  }
}

function buildSetupGuide(settings: ZendeskIntegrationSettings, instanceId?: string): ZendeskSetupGuide {
  return {
    webhookUrl: computeWebhookUrl(settings, instanceId),
    legacyWebhookUrl: instanceId ? computeWebhookUrl(settings) : undefined,
    payloadExample: JSON.stringify(
      {
        ticket_id: "{{ticket.id}}",
        event: "ticket_updated",
        trigger_name: "Agent Studio Auto Reply"
      },
      null,
      2
    ),
    triggers: [
      {
        name: "Agent Studio Auto Reply - New Ticket",
        description: "新工单创建后触发自动答复。",
        conditions: [
          "触发条件建议：Ticket is Created",
          "Action：Notify active webhook",
          "Payload 最少只需包含 ticket_id"
        ]
      },
      {
        name: "Agent Studio Auto Reply - Requester Reply",
        description: "客户追加公开评论后触发自动答复。",
        conditions: [
          "触发条件建议：Ticket is Updated",
          "附加条件建议：Current user is end-user",
          "Action：Notify active webhook"
        ]
      },
      {
        name: "Agent Studio Auto Reply - Missed Call / Voicemail",
        description: "未接来电、语音留言或 Call transcript 生成后触发内部备注建议。",
        conditions: [
          "触发条件建议：Ticket is Created 或 Ticket is Updated",
          "附加条件建议：Subject text contains Missed call，或 Comment text contains Call transcript / Voicemail from",
          "Action：Notify active webhook"
        ]
      }
    ]
  };
}

export class ZendeskIntegrationService {
  private readonly queues = new Map<string, Promise<unknown>>();

  constructor(
    private readonly dependencies: {
      resolveRuntime?: () => Promise<CodexRuntime>;
      resolveAgentRuntime?: (input: {
        settings: ZendeskIntegrationSettings;
        instanceId?: string;
        ticketId: string;
        runId: string;
        source: "webhook" | "manual";
      }) => Promise<ZendeskAgentRuntimeOptions>;
      resolveDingTalkMentionTarget?: (input: {
        zendeskUser?: ZendeskRequesterPayload;
        settings: ZendeskIntegrationSettings;
        context: ZendeskTicketContext;
        instanceId?: string;
        ticketId: string;
      }) => Promise<ZendeskDingTalkMentionTarget | undefined>;
      conversationAudit?: ZendeskConversationAuditSync;
      runtimeSession?: ZendeskRuntimeSessionBridge;
      getDrainReason?: () => Promise<string | undefined>;
      recordUsage?: (input: ZendeskUsageTelemetryInput) => Promise<void>;
    } = {},
    private readonly settingsStore = new ZendeskSettingsStore(),
    private readonly bindingStore = new ZendeskBindingStore(),
    private readonly runStore = new ZendeskRunStore()
  ) {}

  private async loadSettings(instanceId?: string): Promise<ZendeskIntegrationSettings> {
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId) {
      return await store.getForInstance(instanceId);
    }
    return await store.get();
  }

  private async saveSettings(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId?: string
  ): Promise<ZendeskIntegrationSettings> {
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId) {
      return await store.updateForInstance(patch, instanceId);
    }
    return await store.update(patch);
  }

  async getOverview(instanceId?: string): Promise<ZendeskOverview> {
    const settings = await this.loadSettings(instanceId);
    const missing = findZendeskReadinessGaps(settings);
    return {
      settings: redactZendeskSettings(settings),
      ready: missing.length === 0,
      missing,
      setup: buildSetupGuide(settings, instanceId),
      runs: await this.runStore.listForInstance(50, instanceId)
    };
  }

  async recoverInterruptedProcessingRuns(options: {
    olderThanMs?: number;
    limit?: number;
    reprocess?: boolean;
  } = {}): Promise<{ markedFailed: number; requeued: number; deferredRequeued: number; deferredSkipped: number }> {
    const olderThanMs = Math.max(0, Number(options.olderThanMs ?? 0) || 0);
    const cutoff = new Date(Date.now() - olderThanMs);
    const limit = options.limit ?? 50;
    const interrupted = await this.runStore.listProcessingOlderThan(cutoff, limit);
    let markedFailed = 0;
    let requeued = 0;
    let deferredRequeued = 0;
    let deferredSkipped = 0;
    for (const run of interrupted) {
      const updated = await this.runStore.update(run.id, {
        status: "failed",
        detail: "服务重启中断，已自动收尾",
        error: "Interrupted by Agent Studio service restart before the agent completed."
      });
      if (!updated) continue;
      markedFailed += 1;
      if (options.reprocess === false) continue;

      try {
        const settings = await this.loadSettings(run.instanceId);
        if (!settings.enabled) continue;
        requeued += 1;
        void this.enqueue(run.instanceId, run.ticketId, () => this.processTicket(run.ticketId, run.source, settings, run.instanceId))
          .catch((error) => {
            console.error("[zendesk] interrupted run reprocess failed", {
              runId: run.id,
              ticketId: run.ticketId,
              instanceId: run.instanceId,
              detail: error instanceof Error ? error.message : String(error)
            });
          });
      } catch (error) {
        console.warn("[zendesk] failed to requeue interrupted run", {
          runId: run.id,
          ticketId: run.ticketId,
          instanceId: run.instanceId,
          detail: error instanceof Error ? error.message : String(error)
        });
      }
    }
    if (options.reprocess !== false) {
      const deferred = await this.runStore.listDeferred(limit);
      for (const run of deferred) {
        try {
          const settings = await this.loadSettings(run.instanceId);
          if (!settings.enabled) {
            const skipped = await this.runStore.update(run.id, {
              status: "skipped",
              detail: "Zendesk 自动答复已关闭，延迟 webhook 未处理"
            });
            if (skipped) deferredSkipped += 1;
            continue;
          }
          const updated = await this.runStore.update(run.id, {
            status: "received",
            detail: "部署完成，已重新进入后台处理队列"
          });
          if (!updated) continue;
          requeued += 1;
          deferredRequeued += 1;
          void this.enqueue(run.instanceId, run.ticketId, () =>
            this.processTicket(run.ticketId, run.source, settings, run.instanceId, run.id)
          ).catch((error) => {
            console.error("[zendesk] deferred webhook reprocess failed", {
              runId: run.id,
              ticketId: run.ticketId,
              instanceId: run.instanceId,
              detail: error instanceof Error ? error.message : String(error)
            });
          });
        } catch (error) {
          deferredSkipped += 1;
          await this.runStore.update(run.id, {
            status: "failed",
            detail: "延迟 webhook 恢复失败",
            error: error instanceof Error ? error.message : String(error)
          });
          console.warn("[zendesk] failed to requeue deferred webhook run", {
            runId: run.id,
            ticketId: run.ticketId,
            instanceId: run.instanceId,
            detail: error instanceof Error ? error.message : String(error)
          });
        }
      }
    }
    return { markedFailed, requeued, deferredRequeued, deferredSkipped };
  }

  async updateSettings(
    patch: Partial<ZendeskIntegrationSettings> & {
      zendeskApiToken?: string | undefined;
      webhookSigningSecret?: string | undefined;
    },
    instanceId?: string
  ): Promise<ZendeskOverview> {
    await this.saveSettings(patch, instanceId);
    return await this.getOverview(instanceId);
  }

  async validateConnection(instanceId?: string): Promise<{ ok: true; overview: ZendeskOverview }> {
    const settings = await this.loadSettings(instanceId);
    const missing = findZendeskReadinessGaps(settings).filter(
      (item) => !["public_base_url", "agent_mode_id"].includes(item)
    );
    if (missing.length > 0) {
      throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
    }

    const client = new ZendeskClient(settings);
    const me = await client.getMe();
    const store = this.settingsStore as ZendeskSettingsStoreBridge;
    if (instanceId) {
      await store.rememberValidationForInstance(me, instanceId);
    } else {
      await store.rememberValidation(me);
    }
    return {
      ok: true,
      overview: await this.getOverview(instanceId)
    };
  }

  async handleWebhook(
    rawBody: string,
    headers: IncomingHttpHeaders,
    instanceId?: string
  ): Promise<{ accepted: true; result: ProcessTicketResult }> {
    const settings = await this.loadSettings(instanceId);
    if (!settings.enabled) {
      throw new Error("Zendesk 自动答复未启用");
    }
    this.verifyWebhookSignature(headers, rawBody, settings.webhookSigningSecret);
    const payload = safeParseJson(rawBody);
    const ticketId = sanitizeTicketId((payload as { ticket_id?: string | number }).ticket_id || "");
    const drainReason = await this.dependencies.getDrainReason?.();
    if (drainReason) {
      const run = await this.runStore.create({
        instanceId,
        ticketId,
        source: "webhook",
        status: "deferred",
        detail: "Agent Studio 正在部署，已暂存 webhook，服务恢复后自动处理"
      });
      return {
        accepted: true,
        result: {
          status: "deferred",
          detail: "Agent Studio 正在部署，已暂存 webhook，服务恢复后自动处理",
          runId: run.id
        }
      };
    }
    const run = await this.runStore.create({
      instanceId,
      ticketId,
      source: "webhook",
      status: "received",
      detail: "已接收 Zendesk webhook，后台处理中"
    });
    void this.enqueue(instanceId, ticketId, () => this.processTicket(ticketId, "webhook", settings, instanceId, run.id))
      .catch((error) => {
        console.error("[zendesk] background webhook run failed", error);
      });
    return {
      accepted: true,
      result: {
        status: "received",
        detail: "已接收 Zendesk webhook，后台处理中",
        runId: run.id
      }
    };
  }

  async runTicket(ticketIdInput: string | number, instanceId?: string): Promise<ProcessTicketResult> {
    const drainReason = await this.dependencies.getDrainReason?.();
    if (drainReason) {
      throw new Error(drainReason);
    }
    const ticketId = sanitizeTicketId(ticketIdInput);
    return await this.enqueue(instanceId, ticketId, async () => {
      const settings = await this.loadSettings(instanceId);
      return await this.processTicket(ticketId, "manual", settings, instanceId);
    });
  }

  private async enqueue(
    instanceId: string | undefined,
    ticketId: string,
    task: () => Promise<ProcessTicketResult>
  ): Promise<ProcessTicketResult> {
    const key = `${instanceId?.trim() || "legacy"}:${ticketId}`;
    const previous = this.queues.get(key) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.queues.get(key) === next) {
          this.queues.delete(key);
        }
      });
    this.queues.set(key, next);
    return await next;
  }

  private async processTicket(
    ticketId: string,
    source: "webhook" | "manual",
    settings: ZendeskIntegrationSettings,
    instanceId?: string,
    existingRunId?: string
  ): Promise<ProcessTicketResult> {
    const runId =
      existingRunId ||
      (
        await this.runStore.create({
          instanceId,
          ticketId,
          source,
          status: "received",
          detail: source === "manual" ? "手动触发处理中" : "收到 Zendesk webhook"
        })
      ).id;

    try {
      const missing = findZendeskReadinessGaps(settings).filter((item) => item !== "public_base_url");
      if (missing.length > 0) {
        throw new Error(`Zendesk 配置不完整: ${missing.join(", ")}`);
      }

      const client = new ZendeskClient(settings);
      const context = await client.getTicketContext(ticketId, settings.maxCommentHistory);
      const processRows: ZendeskAuditProcessRow[] = [
        zendeskProcessRow("meta", "Read Zendesk ticket", zendeskTicketReadDetail(context, settings.maxCommentHistory))
      ];
      await this.runStore.update(runId, {
        ticketSubject: context.ticket.subject,
        detail: `已读取工单 #${ticketId} 上下文`
      });

      if (this.isExcludedByTags(settings, context.ticket.tags)) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: "skipped",
          detail: "命中排除标签，已跳过"
        });
        return {
          status: "skipped",
          detail: "命中排除标签，已跳过",
          runId
        };
      }

      const processableInput = selectProcessableComment(context);
      if (!processableInput) {
        await this.bindingStore.upsert(ticketId, {
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: "skipped",
          detail: "未找到可处理的客户公开评论或语音转写"
        });
        return {
          status: "skipped",
          detail: "未找到可处理的客户公开评论或语音转写",
          runId
        };
      }
      const requesterComment = processableInput.comment;

      const binding = await this.bindingStore.get(ticketId, instanceId);
      if (
        binding?.lastProcessedRequesterCommentId &&
        binding.lastProcessedRequesterCommentId >= requesterComment.id
      ) {
        await this.runStore.update(runId, {
          status: "skipped",
          detail: `Zendesk 输入 ${requesterComment.id} 已处理，跳过重复执行`,
          requesterCommentId: requesterComment.id
        });
        return {
          status: "skipped",
          detail: "重复 webhook，已跳过",
          runId,
          requesterCommentId: requesterComment.id
        };
      }

      await this.runStore.update(runId, {
        status: "processing",
        detail: "正在调用 agent 生成答复",
        requesterCommentId: requesterComment.id
      });
      processRows.push(
        zendeskProcessRow(
          "meta",
          processableInput.kind === "voice_transcript" ? "Selected voice transcript" : "Selected requester comment",
          [
            `comment_id: ${requesterComment.id}`,
            `input_kind: ${processableInput.kind}`,
            processableInput.forceInternalNote ? "forced_action: internal_note" : "",
            `created_at: ${requesterComment.createdAt || ""}`,
            `attachments: ${requesterComment.attachments.length}`,
            requesterComment.body ? `body:\n${shortenText(requesterComment.body, 1200)}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        )
      );

      const agentRun = await this.runAgent(context, settings, client, binding, requesterComment, {
        instanceId,
        ticketId,
        runId,
        source,
        processRows,
        inputKind: processableInput.kind
      });
      const decision = parseZendeskAgentDecision(agentRun.answerText);
      const action = resolveAction(settings, decision, { forceInternalNote: processableInput.forceInternalNote });
      if (decision.processSummary) {
        agentRun.processRows.push(
          zendeskProcessRow("reasoning", "AI process summary", shortenText(decision.processSummary, 1800))
        );
      }
      agentRun.processRows.push(
        zendeskProcessRow(
          "process",
          "Agent decision parsed",
          [
            `decision: ${decision.decision}`,
            decision.confidence !== undefined ? `confidence: ${Math.round(decision.confidence * 100)}%` : "",
            decision.processSummary ? `processSummary:\n${shortenText(decision.processSummary, 1200)}` : "",
            decision.publicReplyPreview ? `publicReplyPreview:\n${shortenText(decision.publicReplyPreview, 1200)}` : "",
            decision.reasons?.length ? `reasons: ${decision.reasons.join("; ")}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        )
      );

      if (action.mode === "skip") {
        await this.syncConversationAfterAgentRun({
          settings,
          context: agentRun.preparedContext,
          requesterComment,
          binding,
          audit: agentRun.audit,
          instanceId,
          ticketId,
          runId,
          source,
          runtime: agentRun.runtimeOptions,
          answerText: agentRun.answerText,
          decision,
          action,
          codexThreadId: agentRun.codexThreadId,
          processRows: [
            ...agentRun.processRows,
            zendeskProcessRow("done", "Skipped Zendesk write", action.detail)
          ]
        });
        await this.bindingStore.upsert(ticketId, {
          lastProcessedRequesterCommentId: requesterComment.id,
          lastAction: "skip",
          lastRunAt: new Date().toISOString(),
          lastRunId: runId
        }, instanceId);
        await this.runStore.update(runId, {
          status: action.status,
          detail: action.detail,
          decision: action.decision,
          requesterCommentId: requesterComment.id
        });
        return {
          status: action.status,
          detail: action.detail,
          runId,
          requesterCommentId: requesterComment.id,
          decision: action.decision
        };
      }

      const commentResult = await this.addCommentWithRetry(client, context, action, settings);
      agentRun.processRows.push(
        zendeskProcessRow(
          action.publicReply ? "done" : "process",
          action.publicReply ? "Wrote Zendesk public reply" : "Wrote Zendesk internal note",
          [
            action.detail,
            commentResult.commentId ? `zendesk_comment_id: ${commentResult.commentId}` : "",
            action.body ? `body:\n${shortenText(action.body, 1800)}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        )
      );
      const notificationRow = await this.sendDingTalkResultNotification({
        settings,
        context: agentRun.preparedContext,
        requesterComment,
        instanceId,
        ticketId,
        runId,
        source,
        decision,
        action,
        commentId: commentResult.commentId,
        ticketUrl: client.buildTicketUrl(ticketId)
      });
      if (notificationRow) {
        agentRun.processRows.push(notificationRow);
      }
      await this.syncConversationAfterAgentRun({
        settings,
        context: agentRun.preparedContext,
        requesterComment,
        binding,
        audit: agentRun.audit,
        instanceId,
        ticketId,
        runId,
        source,
        runtime: agentRun.runtimeOptions,
        answerText: agentRun.answerText,
        decision,
        action,
        commentId: commentResult.commentId,
        codexThreadId: agentRun.codexThreadId,
        processRows: agentRun.processRows
      });
      await this.bindingStore.upsert(ticketId, {
        lastProcessedRequesterCommentId: requesterComment.id,
        lastAction: action.decision,
        lastRunAt: new Date().toISOString(),
        lastRunId: runId
      }, instanceId);
      await this.runStore.update(runId, {
        status: action.status,
        detail: action.detail,
        decision: action.decision,
        requesterCommentId: requesterComment.id,
        commentId: commentResult.commentId
      });

      return {
        status: action.status,
        detail: action.detail,
        runId,
        commentId: commentResult.commentId,
        requesterCommentId: requesterComment.id,
        decision: action.decision
      };
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Zendesk 自动答复失败";
      await this.bindingStore.upsert(ticketId, {
        lastAction: "error",
        lastRunAt: new Date().toISOString(),
        lastRunId: runId
      }, instanceId);
      await this.runStore.update(runId, {
        status: "failed",
        detail: "执行失败",
        error: detail
      });
      throw error;
    }
  }

  private async sendDingTalkResultNotification(input: {
    settings: ZendeskIntegrationSettings;
    context: ZendeskTicketContext;
    requesterComment: ZendeskCommentPayload;
    instanceId?: string;
    ticketId: string;
    runId: string;
    source: "webhook" | "manual";
    decision: ZendeskAgentDecision;
    action: Extract<ResolvedAction, { mode: "comment" }>;
    commentId?: number;
    ticketUrl: string;
  }): Promise<ZendeskAuditProcessRow | undefined> {
    if (!input.settings.dingtalkNotificationEnabled) return undefined;
    if (input.source === "manual" && !input.settings.dingtalkNotificationManualRunsEnabled) return undefined;

    const webhookUrl = trimOrUndefined(input.settings.dingtalkNotificationWebhookUrl);
    if (!webhookUrl) {
      return zendeskProcessRow("error", "DingTalk notification skipped", "DingTalk robot webhook URL is not configured.");
    }

    try {
      const resolvedMention = this.dependencies.resolveDingTalkMentionTarget
        ? await this.dependencies.resolveDingTalkMentionTarget({
            zendeskUser: input.context.ticket.assignee,
            settings: input.settings,
            context: input.context,
            instanceId: input.instanceId,
            ticketId: input.ticketId
          })
        : undefined;
      const assigneeUserIds = (resolvedMention?.userIds ?? [])
        .map((item) => String(item || "").trim())
        .filter((item, index, array) => item && array.indexOf(item) === index);
      const fallbackMention =
        assigneeUserIds.length === 0 && this.dependencies.resolveDingTalkMentionTarget
          ? await this.dependencies.resolveDingTalkMentionTarget({
              settings: input.settings,
              context: input.context,
              instanceId: input.instanceId,
              ticketId: input.ticketId
            })
          : undefined;
      const atUserIds = (assigneeUserIds.length > 0 ? assigneeUserIds : fallbackMention?.userIds ?? [])
        .map((item) => String(item || "").trim())
        .filter((item, index, array) => item && array.indexOf(item) === index);
      const mentionLabel =
        (assigneeUserIds.length > 0
          ? trimOrUndefined(resolvedMention?.label) || zendeskUserDisplay(input.context.ticket.assignee, "")
          : trimOrUndefined(fallbackMention?.label)) ||
        (atUserIds.length ? "Support team" : "");
      const markdown = buildZendeskDingTalkMarkdown({
        settings: input.settings,
        context: input.context,
        requesterComment: input.requesterComment,
        ticketId: input.ticketId,
        ticketUrl: input.ticketUrl,
        runId: input.runId,
        source: input.source,
        decision: input.decision,
        action: input.action,
        commentId: input.commentId,
        mentionLabel: atUserIds.length ? mentionLabel : undefined,
        atUserIds
      });
      await postDingTalkRobotMarkdown({
        webhookUrl,
        robotSecret: input.settings.dingtalkNotificationRobotSecret,
        title: `Zendesk #${input.ticketId} - AI Update`,
        markdown,
        atUserIds
      });
      return zendeskProcessRow(
        "done",
        "Sent DingTalk notification",
        [
          `at_user_ids: ${atUserIds.length}`,
          mentionLabel ? `mention_label: ${mentionLabel}` : "",
          resolvedMention?.detail ? `assignee_mapping: ${resolvedMention.detail}` : "",
          fallbackMention?.detail ? `fallback_mapping: ${fallbackMention.detail}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      );
    } catch (error) {
      return zendeskProcessRow(
        "error",
        "DingTalk notification failed",
        error instanceof Error ? error.message : "DingTalk notification failed"
      );
    }
  }

  private async runAgent(
    context: ZendeskTicketContext,
    settings: ZendeskIntegrationSettings,
    client: ZendeskClient,
    binding: ZendeskBindingRecord | undefined,
    requesterComment: ZendeskCommentPayload,
    run: {
      instanceId?: string;
      ticketId: string;
      runId: string;
      source: "webhook" | "manual";
      processRows?: ZendeskAuditProcessRow[];
      inputKind?: ZendeskProcessableInputKind;
    }
  ): Promise<ZendeskAgentRunResult> {
    const processRows = [...(run.processRows ?? [])];
    const runtimeOptions = this.dependencies.resolveAgentRuntime
      ? await this.dependencies.resolveAgentRuntime({
          settings,
          instanceId: run.instanceId,
          ticketId: run.ticketId,
          runId: run.runId,
          source: run.source
        })
      : {
          model: settings.model,
          reasoningEffort: settings.reasoningEffort,
          workspace: settings.workspace,
          codexRunConfig: buildRunConfig(settings)
        };
    const runtime = (runtimeOptions.runtime ||
      (this.dependencies.resolveRuntime ? await this.dependencies.resolveRuntime() : new CodexRuntime())) as ZendeskRuntimeLike;
    const publicRuntimeOptions = {
      model: runtimeOptions.model,
      reasoningEffort: runtimeOptions.reasoningEffort,
      workspace: runtimeOptions.workspace,
      codexRunConfig: runtimeOptions.codexRunConfig,
      knowledgeSets: runtimeOptions.knowledgeSets,
      enabledSkills: runtimeOptions.enabledSkills
    };
    processRows.push(
      zendeskProcessRow(
        "meta",
        "Resolved Agent Mode runtime",
        [
          `model: ${runtimeOptions.model}`,
          `reasoningEffort: ${runtimeOptions.reasoningEffort}`,
          `workspace: ${runtimeOptions.workspace}`,
          runtimeOptions.codexRunConfig ? `runConfig:\n${shortenText(detailFromUnknown(runtimeOptions.codexRunConfig), 1200)}` : ""
        ]
          .filter(Boolean)
          .join("\n")
      )
    );
    if (runtimeOptions.knowledgeSets?.length) {
      processRows.push(
        zendeskProcessRow(
          "source",
          "Mounted knowledge sets",
          runtimeOptions.knowledgeSets
            .map((knowledgeSet) =>
              [
                `name: ${knowledgeSet.name}`,
                knowledgeSet.id ? `id: ${knowledgeSet.id}` : "",
                knowledgeSet.relativePath ? `relative_path: ${knowledgeSet.relativePath}` : "",
                `absolute_path: ${knowledgeSet.path}`,
                knowledgeSet.manifestPath ? `manifest_path: ${knowledgeSet.manifestPath}` : ""
              ]
                .filter(Boolean)
                .join("\n")
            )
            .join("\n\n")
        )
      );
    }
    if (runtimeOptions.enabledSkills?.length) {
      processRows.push(
        zendeskProcessRow(
          "source",
          "Enabled Codex skills",
          runtimeOptions.enabledSkills
            .map((skill) =>
              [
                `name: ${skill.name}`,
                skill.id ? `id: ${skill.id}` : "",
                skill.managedSkillId ? `managed_skill_id: ${skill.managedSkillId}` : "",
                skill.sourcePath ? `source_path: ${skill.sourcePath}` : "",
                skill.activationPrompt ? "activation_prompt: configured" : ""
              ]
                .filter(Boolean)
                .join("\n")
            )
            .join("\n\n")
        )
      );
    }
    const preparedContext = await this.prepareContextAttachments(
      context,
      settings,
      client,
      runtimeOptions.workspace,
      run.runId,
      requesterComment.id
    );
    processRows.push(zendeskProcessRow("process", "Prepared Zendesk attachments", summarizePreparedAttachments(preparedContext)));
    const audit = await this.syncConversationBeforeAgentRun({
      settings,
      context: preparedContext,
      requesterComment,
      binding,
      instanceId: run.instanceId,
      ticketId: run.ticketId,
      runId: run.runId,
      source: run.source,
      runtime: publicRuntimeOptions
    });
    const runtimeSessionInput: ZendeskRuntimeSessionInput = {
      settings,
      context: preparedContext,
      requesterComment,
      binding,
      audit,
      instanceId: run.instanceId,
      ticketId: run.ticketId,
      runId: run.runId,
      source: run.source,
      runtime,
      runtimeOptions: publicRuntimeOptions
    };
    let observedCodexThreadId = trimOrUndefined(binding?.codexThreadId);
    let thread: ZendeskRuntimeThread | undefined;
    let runtimeSessionLease: ZendeskRuntimeSessionLease | undefined;

    runtimeSessionLease = await this.dependencies.runtimeSession?.acquire(runtimeSessionInput);
    if (runtimeSessionLease?.thread) {
      thread = runtimeSessionLease.thread;
      observedCodexThreadId = trimOrUndefined(runtimeSessionLease.codexThreadId) || observedCodexThreadId;
      processRows.push(
        zendeskProcessRow(
          "meta",
          "Resolved Agent Studio runtime session",
          [
            runtimeSessionLease.status ? `status: ${runtimeSessionLease.status}` : "",
            runtimeSessionLease.sessionId ? `session_id: ${runtimeSessionLease.sessionId}` : "",
            observedCodexThreadId ? `codex_thread_id: ${observedCodexThreadId}` : "",
            runtimeSessionLease.detail ? `detail: ${runtimeSessionLease.detail}` : ""
          ]
            .filter(Boolean)
            .join("\n")
        )
      );
    }

    if (!thread && observedCodexThreadId) {
      try {
        thread = await runtime.resumeThreadWithOptions({
          threadId: observedCodexThreadId,
          model: runtimeOptions.model,
          reasoningEffort: runtimeOptions.reasoningEffort,
          workspace: runtimeOptions.workspace,
          codexRunConfig: stripInternalRunConfigMetadata(runtimeOptions.codexRunConfig)
        });
      } catch (error) {
        console.warn("[zendesk] failed to resume codex thread, starting a new one", {
          ticketId: run.ticketId,
          instanceId: run.instanceId,
          codexThreadId: observedCodexThreadId,
          detail: error instanceof Error ? error.message : String(error)
        });
        processRows.push(
          zendeskProcessRow("error", "Failed to resume Codex thread", `thread_id: ${observedCodexThreadId}\n${error instanceof Error ? error.message : String(error)}`)
        );
        observedCodexThreadId = undefined;
      }
    }

    if (!thread) {
      thread = await runtime.startThreadWithOptions({
        model: runtimeOptions.model,
        reasoningEffort: runtimeOptions.reasoningEffort,
        workspace: runtimeOptions.workspace,
        codexRunConfig: stripInternalRunConfigMetadata(runtimeOptions.codexRunConfig)
      });
      observedCodexThreadId = extractCodexThreadIdFromThread(thread) || observedCodexThreadId;
      processRows.push(zendeskProcessRow("meta", "Started Codex thread", observedCodexThreadId ? `thread_id: ${observedCodexThreadId}` : undefined));
    } else {
      processRows.push(zendeskProcessRow("meta", "Resumed Codex thread", `thread_id: ${observedCodexThreadId}`));
    }

    await this.rememberRuntimeBinding(run.ticketId, run.instanceId, {
      codexThreadId: observedCodexThreadId,
      workspacePath: runtimeOptions.workspace,
      runId: run.runId
    });

    const basePrompt = buildZendeskAgentPrompt(preparedContext, settings, {
      knowledgeSets: runtimeOptions.knowledgeSets,
      inputKind: run.inputKind
    });
    const prompt = withZendeskSkillActivationPrompts(basePrompt, runtimeOptions.codexRunConfig);
    processRows.push(
      zendeskProcessRow(
        "process",
        "Called agent",
        [
          `prompt_chars: ${prompt.length}`,
          `comment_history: ${preparedContext.comments.length}`,
          `input_kind: ${run.inputKind || "requester_public_comment"}`,
          `knowledge_sets: ${runtimeOptions.knowledgeSets?.length ?? 0}`,
          `enabled_skills: ${runtimeOptions.enabledSkills?.length ?? 0}`
        ].join("\n")
      )
    );
    let output = "";
    let latestUsage: RuntimeUsageSnapshot | undefined;
    const runAgentThread = async (currentThread: ZendeskRuntimeThread) => {
      let runOutput = "";
      let runUsage: RuntimeUsageSnapshot | undefined;
      for await (const event of runtime.runStreamed(currentThread, prompt)) {
        const eventCodexThreadId = extractCodexThreadIdFromEvent(event);
        if (eventCodexThreadId) {
          observedCodexThreadId = eventCodexThreadId;
          if (runtimeSessionLease && this.dependencies.runtimeSession?.persistCodexThreadId) {
            const persisted = await this.dependencies.runtimeSession.persistCodexThreadId({
              ...runtimeSessionInput,
              lease: runtimeSessionLease,
              codexThreadId: eventCodexThreadId
            });
            runtimeSessionLease = persisted || runtimeSessionLease;
          }
        }
        runUsage = extractRuntimeUsageFromStreamEvent(event) || runUsage;
        collectRuntimeProcessRow(event, processRows);
        if (event.delta) runOutput += event.delta;
        else if (!runOutput && event.text) runOutput += event.text;
      }
      return { output: runOutput, latestUsage: runUsage };
    };

    try {
      const result = await runAgentThread(thread);
      output = result.output;
      latestUsage = result.latestUsage;
    } catch (error) {
      if (!isRecoverableCodexResumeError(error)) throw error;
      const failedThreadId = observedCodexThreadId;
      processRows.push(
        zendeskProcessRow(
          "error",
          "Codex resume failed during agent call",
          [failedThreadId ? `thread_id: ${failedThreadId}` : "", error instanceof Error ? error.message : String(error)]
            .filter(Boolean)
            .join("\n")
        )
      );
      const replacementLease = await this.dependencies.runtimeSession?.replace({
        ...runtimeSessionInput,
        previous: runtimeSessionLease,
        failedCodexThreadId: failedThreadId,
        error
      });
      if (replacementLease?.thread) {
        runtimeSessionLease = replacementLease;
        thread = replacementLease.thread;
        observedCodexThreadId = trimOrUndefined(replacementLease.codexThreadId) || undefined;
        processRows.push(
          zendeskProcessRow(
            "meta",
            "Started replacement Agent Studio runtime session",
            [
              failedThreadId ? `failed_codex_thread_id: ${failedThreadId}` : "",
              replacementLease.sessionId ? `session_id: ${replacementLease.sessionId}` : "",
              observedCodexThreadId ? `codex_thread_id: ${observedCodexThreadId}` : "",
              replacementLease.detail ? `detail: ${replacementLease.detail}` : ""
            ]
              .filter(Boolean)
              .join("\n")
          )
        );
      } else {
        thread = await runtime.startThreadWithOptions({
          model: runtimeOptions.model,
          reasoningEffort: runtimeOptions.reasoningEffort,
          workspace: runtimeOptions.workspace,
          codexRunConfig: stripInternalRunConfigMetadata(runtimeOptions.codexRunConfig)
        });
        observedCodexThreadId = extractCodexThreadIdFromThread(thread) || undefined;
        processRows.push(
          zendeskProcessRow(
            "meta",
            "Started replacement Codex thread",
            [failedThreadId ? `failed_thread_id: ${failedThreadId}` : "", observedCodexThreadId ? `thread_id: ${observedCodexThreadId}` : ""]
              .filter(Boolean)
              .join("\n")
          )
        );
      }
      await this.rememberRuntimeBinding(run.ticketId, run.instanceId, {
        codexThreadId: observedCodexThreadId,
        workspacePath: runtimeOptions.workspace,
        runId: run.runId
      });
      const retryResult = await runAgentThread(thread);
      output = retryResult.output;
      latestUsage = retryResult.latestUsage;
    }
    processRows.push(zendeskProcessRow("done", "Agent output received", `output_chars: ${output.trim().length}`));

    if (latestUsage && this.dependencies.recordUsage) {
      try {
        await this.dependencies.recordUsage({
          usage: latestUsage,
          settings,
          context: preparedContext,
          requesterComment,
          instanceId: run.instanceId,
          ticketId: run.ticketId,
          runId: run.runId,
          source: run.source,
          runtime: publicRuntimeOptions,
          codexThreadId: observedCodexThreadId,
          auditThreadId: audit?.threadId,
          externalConversationKey: audit?.externalConversationKey
        });
        processRows.push(
          zendeskProcessRow(
            "done",
            "Recorded usage telemetry",
            [
              `input_tokens: ${latestUsage.inputTokens}`,
              `cached_input_tokens: ${latestUsage.cachedInputTokens}`,
              `output_tokens: ${latestUsage.outputTokens}`
            ].join("\n")
          )
        );
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.warn("[zendesk] usage telemetry ingestion failed", {
          ticketId: run.ticketId,
          instanceId: run.instanceId,
          detail
        });
        processRows.push(zendeskProcessRow("error", "Usage telemetry failed", detail));
      }
    }

    await this.rememberRuntimeBinding(run.ticketId, run.instanceId, {
      codexThreadId: observedCodexThreadId,
      workspacePath: runtimeOptions.workspace,
      runId: run.runId
    });
    return {
      answerText: output.trim(),
      preparedContext,
      runtimeOptions: publicRuntimeOptions,
      audit,
      codexThreadId: observedCodexThreadId,
      processRows
    };
  }

  private async syncConversationBeforeAgentRun(
    input: Parameters<ZendeskConversationAuditSync["beforeAgentRun"]>[0]
  ): Promise<ZendeskConversationAuditState | undefined> {
    if (!this.dependencies.conversationAudit) return undefined;
    try {
      return await this.dependencies.conversationAudit.beforeAgentRun(input);
    } catch (error) {
      console.warn("[zendesk] conversation audit sync before agent run failed", {
        ticketId: input.ticketId,
        instanceId: input.instanceId,
        detail: error instanceof Error ? error.message : String(error)
      });
      return undefined;
    }
  }

  private async syncConversationAfterAgentRun(
    input: Parameters<ZendeskConversationAuditSync["afterAgentRun"]>[0]
  ): Promise<void> {
    if (!this.dependencies.conversationAudit) return;
    try {
      await this.dependencies.conversationAudit.afterAgentRun(input);
    } catch (error) {
      console.warn("[zendesk] conversation audit sync after agent run failed", {
        ticketId: input.ticketId,
        instanceId: input.instanceId,
        runId: input.runId,
        detail: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async rememberRuntimeBinding(
    ticketId: string,
    instanceId: string | undefined,
    input: {
      codexThreadId?: string;
      workspacePath?: string;
      runId: string;
    }
  ): Promise<void> {
    if (!trimOrUndefined(input.codexThreadId) && !trimOrUndefined(input.workspacePath)) return;
    await this.bindingStore.upsert(
      ticketId,
      {
        codexThreadId: trimOrUndefined(input.codexThreadId),
        workspacePath: trimOrUndefined(input.workspacePath),
        lastRunId: input.runId
      },
      instanceId
    );
  }

  private async prepareContextAttachments(
    context: ZendeskTicketContext,
    settings: ZendeskIntegrationSettings,
    client: ZendeskClient,
    workspacePath: string,
    runId: string,
    preferredCommentId?: number
  ): Promise<ZendeskTicketContext> {
    const next = cloneContext(context);
    if (!settings.attachmentReadingEnabled) {
      for (const comment of next.comments) {
        comment.attachments = comment.attachments.map((attachment) => ({
          ...attachment,
          downloadStatus: "skipped",
          downloadReason: "后台未启用附件读取"
        }));
      }
      return next;
    }

    const allowed = settings.allowedAttachmentMimeTypes;
    const restrictTypes = settings.attachmentTypeRestrictionEnabled;
    const baseDir = path.join(workspacePath, ".zendesk", "attachments", `run-${sanitizePathSegment(runId, "run")}`);
    await fs.mkdir(baseDir, { recursive: true });

    let downloadedOrSelected = 0;
    for (const comment of orderCommentsForAttachmentDownload(next.comments.slice(0, settings.maxCommentHistory), preferredCommentId)) {
      if (comment.attachments.length === 0) continue;
      let index = 0;
      for (const attachment of comment.attachments) {
        index += 1;
        if (downloadedOrSelected >= settings.maxAttachmentCount) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = "超过本次最大附件数量";
          continue;
        }

        const metadataContentType = attachment.contentType;
        if (metadataContentType && !isMimeAllowed(metadataContentType, allowed, restrictTypes)) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = `附件类型不在白名单: ${metadataContentType}`;
          continue;
        }

        if (attachment.size !== undefined && attachment.size > settings.maxAttachmentBytes) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = `附件大小超过限制: ${attachmentDisplaySize(attachment.size)}`;
          continue;
        }

        const url = attachment.contentUrl || attachment.mappedContentUrl;
        if (!url) {
          attachment.downloadStatus = "skipped";
          attachment.downloadReason = "附件缺少可下载地址";
          continue;
        }

        const cachePath = attachmentCachePath({
          workspacePath,
          settings,
          ticketId: context.ticket.id,
          commentId: comment.id,
          attachment,
          index
        });
        const cacheCanBeTrusted = isMimeAllowed(metadataContentType, allowed, restrictTypes);
        const cachedSize = cacheCanBeTrusted
          ? await cachedAttachmentSize(cachePath, attachment, settings.maxAttachmentBytes)
          : undefined;
        downloadedOrSelected += 1;
        if (cachedSize !== undefined) {
          attachment.size = cachedSize;
          attachment.localPath = cachePath;
          attachment.relativePath = path.relative(workspacePath, cachePath);
          attachment.downloadStatus = "downloaded";
          attachment.downloadReason = "复用 ticket 附件缓存";
          continue;
        }

        try {
          const result = await client.downloadAttachment({
            url,
            maxBytes: settings.maxAttachmentBytes
          });
          const resolvedContentType = result.contentType || metadataContentType;
          if (!isMimeAllowed(resolvedContentType, allowed, restrictTypes)) {
            attachment.downloadStatus = "skipped";
            attachment.downloadReason = `附件类型不在白名单: ${resolvedContentType || "unknown"}`;
            continue;
          }

          await fs.mkdir(path.dirname(cachePath), { recursive: true });
          await fs.writeFile(cachePath, result.content);
          attachment.contentType = resolvedContentType;
          attachment.size = result.content.byteLength;
          attachment.localPath = cachePath;
          attachment.relativePath = path.relative(workspacePath, cachePath);
          attachment.downloadStatus = "downloaded";
        } catch (error) {
          attachment.downloadStatus = "failed";
          attachment.downloadReason = error instanceof Error ? error.message : "附件下载失败";
        }
      }
    }

    await this.writeAttachmentManifest(next, baseDir);
    return next;
  }

  private async writeAttachmentManifest(
    context: ZendeskTicketContext,
    baseDir: string
  ): Promise<void> {
    const attachments = context.comments.flatMap((comment) =>
      comment.attachments.map((attachment) => ({
        commentId: comment.id,
        fileName: attachment.fileName,
        contentType: attachment.contentType,
        size: attachment.size,
        inline: attachment.inline,
        status: attachment.downloadStatus,
        reason: attachment.downloadReason,
        path: attachment.relativePath
      }))
    );
    if (attachments.length === 0) return;
    const manifestPath = path.join(baseDir, "manifest.json");
    await fs.writeFile(
      manifestPath,
      JSON.stringify(
        {
          ticketId: context.ticket.id,
          generatedAt: new Date().toISOString(),
          attachments
        },
        null,
        2
      ),
      "utf8"
    );
  }

  private async addCommentWithRetry(
    client: ZendeskClient,
    context: ZendeskTicketContext,
    action: Extract<ResolvedAction, { mode: "comment" }>,
    settings: ZendeskIntegrationSettings
  ): Promise<{ commentId?: number }> {
    try {
      return await client.addTicketComment({
        ticketId: String(context.ticket.id),
        body: action.body,
        publicReply: action.publicReply,
        autoStatus:
          context.ticket.status === "closed"
            ? "unchanged"
            : this.resolveAutoStatus(settings, context, action),
        updatedAt: context.ticket.updatedAt
      });
    } catch (error) {
      if (!(error instanceof ZendeskApiError) || error.status !== 409) {
        throw error;
      }
      const refreshed = await client.getTicketContext(String(context.ticket.id), 1);
      return await client.addTicketComment({
        ticketId: String(context.ticket.id),
        body: action.body,
        publicReply: action.publicReply,
        autoStatus:
          refreshed.ticket.status === "closed"
            ? "unchanged"
            : this.resolveAutoStatus(settings, refreshed, action),
        updatedAt: refreshed.ticket.updatedAt
      });
    }
  }

  private resolveAutoStatus(
    settings: ZendeskIntegrationSettings,
    context: ZendeskTicketContext,
    action: Extract<ResolvedAction, { mode: "comment" }>
  ): ZendeskIntegrationSettings["autoStatus"] {
    if (context.ticket.status === "solved" || context.ticket.status === "closed") return "unchanged";
    if (!action.publicReply) return "unchanged";
    return settings.autoStatus;
  }

  private isExcludedByTags(settings: ZendeskIntegrationSettings, ticketTags: string[]): boolean {
    if (settings.excludedTags.length === 0) return false;
    const tags = new Set(ticketTags.map((item) => String(item || "").trim().toLowerCase()).filter(Boolean));
    return settings.excludedTags.some((item) => tags.has(item));
  }

  private verifyWebhookSignature(
    headers: IncomingHttpHeaders,
    rawBody: string,
    secret: string
  ): void {
    if (!secret) {
      throw new Error("Webhook 签名密钥未配置");
    }
    const signature = String(headers["x-zendesk-webhook-signature"] || "").trim();
    const timestamp = String(headers["x-zendesk-webhook-signature-timestamp"] || "").trim();
    if (!signature || !timestamp) {
      throw new Error("缺少 Zendesk webhook 签名头");
    }

    const tsValue = Date.parse(timestamp);
    if (Number.isFinite(tsValue)) {
      const ageMs = Math.abs(Date.now() - tsValue);
      if (ageMs > 10 * 60 * 1000) {
        throw new Error("Zendesk webhook 时间戳已过期");
      }
    }

    const expected = createHmac("sha256", secret).update(`${timestamp}${rawBody}`).digest("base64");
    const given = Buffer.from(signature);
    const wanted = Buffer.from(expected);
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted)) {
      throw new Error("Zendesk webhook 签名校验失败");
    }
  }
}

function safeParseJson(input: string): unknown {
  try {
    return JSON.parse(input);
  } catch {
    throw new Error("Webhook payload 不是有效 JSON");
  }
}
