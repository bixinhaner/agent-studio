import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren
} from "react";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  RuntimeAdapterProvider,
  ThreadListItemPrimitive,
  useAui,
  useAuiEvent,
  useLocalRuntime,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  type ChatModelAdapter,
  type EmptyMessagePartProps,
  type ThreadMessage
} from "@assistant-ui/react";
import {
  AssistantActionBar,
  AssistantMessage,
  BranchPicker,
  Thread,
  ThreadList,
  makeMarkdownText
} from "@assistant-ui/react-ui";
import { CheckIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { createAssistantStream, type AssistantStream } from "assistant-stream";
import {
  type AttachmentAdapter,
  type CompleteAttachment,
  CompositeAttachmentAdapter,
  type PendingAttachment,
  type ThreadUserMessagePart,
  type ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
  type RemoteThreadListAdapter,
  type ThreadHistoryAdapter
} from "@assistant-ui/core";
import { useAuiState } from "@assistant-ui/store";
import { ConfigProvider } from "antd";

import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
import {
  DEFAULT_MODEL,
  MODEL_OPTIONS,
  contextLimitForModel,
  normalizeReasoningEffortForModel,
  reasoningOptionsForModel,
  type ReasoningEffort
} from "../../lib/model-config";
import { iterateSSE } from "../../lib/sse";
import { resolveRunThreadId } from "../../lib/thread-id-resolver";
import { RuntimeProfileView } from "../modes/runtime-profile-view";
import type { PortalRuntimeOptions } from "../modes/types";
import { ThreadCollaborationPanel } from "../collaboration/ThreadCollaborationPanel";
import { fetchThreadCollaboration } from "../collaboration/api";
import type { ThreadCollaborationView } from "../collaboration/types";
import { fetchPortalResources } from "../resources/api";
import { KnowledgeSetPicker } from "../resources/KnowledgeSetPicker";
import type { PortalResourcesResponse } from "../resources/types";
import { ZendeskIntegrationPanel } from "../zendesk/ZendeskIntegrationPanel";
import { resolveModeLabel, resolveModeOptions } from "./runtime-labels";
import type { AuthUser } from "../auth/api";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { PortalTopBar } from "./workbench/PortalTopBar";
import { SessionRail } from "./workbench/SessionRail";
import { RightWorkbenchDrawer } from "./workbench/RightWorkbenchDrawer";
import { WritingWorkbenchPanel } from "./workbench/WritingWorkbenchPanel";
import { AdvancedSettingsPanel } from "./workbench/AdvancedSettingsPanel";
import {
  closeWorkbenchDrawer,
  createInitialLayoutState,
  openWorkbenchDrawer,
  switchWorkbenchTab,
  toggleSessionRail
} from "./workbench/layout-state";
import { PORTAL_STARTER_SUGGESTIONS } from "./workbench/starter-suggestions";
import { PORTAL_ANTD_THEME } from "./workbench/theme";
import "./workbench/workbench.css";

type SessionOut = {
  session_id: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  workspace: string;
  created_at: string;
  updated_at: string;
};

type ThreadOut = {
  id: string;
  status: "regular" | "archived";
  title?: string;
  external_id?: string;
  model: string;
  reasoning_effort: ReasoningEffort;
  workspace: string;
  created_at: string;
  updated_at: string;
};

type ThreadListOut = {
  threads: ThreadOut[];
};

type ThreadOneOut = {
  thread: ThreadOut;
};

type ThreadCreateOut = {
  thread: ThreadOut;
  session?: SessionOut;
};

type ThreadSessionOut = {
  session: SessionOut;
};

type ThreadMessagesOut = {
  head_id?: string | null;
  messages: Array<{
    parent_id?: string | null;
    message: unknown;
    run_config?: Record<string, unknown>;
  }>;
};

type DirectoryBrowseOut = {
  roots: string[];
  cwd: string;
  parent: string | null;
  directories: Array<{
    name: string;
    path: string;
  }>;
};

type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
type ApprovalPolicy = "never" | "on-request" | "on-failure" | "untrusted";
type WebSearchMode = "disabled" | "cached" | "live";
type DirectoryPickerTarget = "workspace" | "additional";
type DirectoryLoadOptions = {
  syncInput?: boolean;
  keepDirectoriesOnError?: boolean;
};

type AppliedConfig = {
  workspace: string;
  model: string;
  reasoningEffort: ReasoningEffort;
  sandboxMode: SandboxMode;
  approvalPolicy: ApprovalPolicy;
  networkAccessEnabled: boolean;
  webSearchMode: WebSearchMode;
  additionalDirectoriesRaw: string;
};

type ProcessData = {
  kind: "debug" | "meta" | "process" | "done" | "error";
  at: string;
  title: string;
  detail?: string;
  event?: string;
  item_type?: string;
  status?: string;
};

type TurnUsage = {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

type ContextUsageSnapshot = TurnUsage & {
  threadId: string;
  model: string;
  contextLimit: number;
  updatedAt: string;
};

type ContextUsageTone = "idle" | "ok" | "warn" | "critical";

type ThreadIdentity = {
  remoteId?: string;
  localId?: string;
};

type TimelineRow = {
  id: string;
  kind: "reasoning" | "tool" | "source" | "meta" | "process" | "done" | "error" | "debug";
  title: string;
  detail?: string;
  at?: string;
};

const DEFAULT_WORKSPACE = ".";

const SANDBOX_OPTIONS: Array<{ value: SandboxMode; label: string }> = [
  { value: "workspace-write", label: "workspace-write（推荐：可读写工作区）" },
  { value: "read-only", label: "read-only（只读）" },
  { value: "danger-full-access", label: "danger-full-access（完全权限）" }
];

const APPROVAL_OPTIONS: Array<{ value: ApprovalPolicy; label: string }> = [
  { value: "never", label: "never（不请求审批）" },
  { value: "on-request", label: "on-request（按需审批）" },
  { value: "on-failure", label: "on-failure（失败时审批）" },
  { value: "untrusted", label: "untrusted（不可信操作审批）" }
];

const WEB_SEARCH_OPTIONS: Array<{ value: WebSearchMode; label: string }> = [
  { value: "disabled", label: "disabled（关闭）" },
  { value: "cached", label: "cached（缓存搜索）" },
  { value: "live", label: "live（实时搜索）" }
];
const DEFAULT_RUNNING_STAGE_TEXT = "正在等待模型响应";
const RunningStageTextContext = createContext(DEFAULT_RUNNING_STAGE_TEXT);
const SessionSearchContext = createContext("");

const AssistantMarkdownText = makeMarkdownText();

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function shorten(text: string, max = 1000): string {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n...（已截断）`;
}

function detailFromUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined || value === null) return "";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function parseDirectories(raw: string): string[] | undefined {
  const items = raw
    .split(/[\n,]/g)
    .map((it) => it.trim())
    .filter(Boolean);
  return items.length ? Array.from(new Set(items)) : undefined;
}

function formatDirectories(items: string[]): string {
  const normalized = items.map((it) => it.trim()).filter(Boolean);
  return Array.from(new Set(normalized)).join("\n");
}

function normalizeKnowledgeSetIds(ids: string[]): string[] {
  return Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
}

const PROMPT_TEXT_MAX_CHARS = 200_000;

const TEXT_LIKE_MIME_TYPES = new Set([
  "application/json",
  "application/ld+json",
  "application/xml",
  "application/xhtml+xml",
  "application/javascript",
  "application/ecmascript",
  "application/x-javascript",
  "application/x-httpd-php",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-yaml",
  "application/yaml",
  "application/toml",
  "application/sql"
]);

const TEXT_LIKE_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "tsv",
  "json",
  "jsonl",
  "xml",
  "html",
  "htm",
  "css",
  "scss",
  "sass",
  "less",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "ts",
  "tsx",
  "vue",
  "svelte",
  "yml",
  "yaml",
  "toml",
  "ini",
  "cfg",
  "conf",
  "log",
  "sh",
  "bash",
  "zsh",
  "py",
  "java",
  "kt",
  "kts",
  "go",
  "rs",
  "rb",
  "php",
  "swift",
  "c",
  "cc",
  "cpp",
  "h",
  "hpp",
  "sql",
  "env",
  "properties",
  "gradle",
  "dockerignore",
  "gitignore",
  "gitattributes"
]);

const TEXT_LIKE_FILE_NAMES = new Set(["dockerfile", "makefile", "jenkinsfile", "readme", "license", "changelog"]);

function truncateForPrompt(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  return `${value.slice(0, maxChars)}\n...（内容过长，已截断）`;
}

function fileNameFromUnknown(value: unknown, fallback: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  return fallback;
}

function fileExtensionFromName(name: string): string {
  const idx = name.lastIndexOf(".");
  if (idx < 0 || idx === name.length - 1) return "";
  return name.slice(idx + 1).toLowerCase();
}

function isLikelyTextFile(file: File): boolean {
  const mime = (file.type || "").trim().toLowerCase();
  if (mime.startsWith("text/")) return true;
  if (TEXT_LIKE_MIME_TYPES.has(mime)) return true;

  const name = file.name.trim().toLowerCase();
  if (TEXT_LIKE_FILE_NAMES.has(name)) return true;

  const ext = fileExtensionFromName(name);
  if (!ext) return false;
  return TEXT_LIKE_EXTENSIONS.has(ext);
}

function guessAttachmentType(file: File): "image" | "document" | "file" {
  const mime = (file.type || "").toLowerCase();
  if (mime.startsWith("image/")) return "image";
  if (isLikelyTextFile(file)) return "document";
  return "file";
}

type UploadedAttachmentMeta = {
  name: string;
  path: string;
  relativePath: string;
  mimeType: string;
  size: number;
};

function decodeMaybeUri(value: string): string {
  if (!value.trim()) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uploadedMetaFromUnknown(value: unknown): UploadedAttachmentMeta {
  const obj = asRecord(value);
  if (!obj) {
    throw new Error("上传响应异常：缺少 attachment");
  }
  const name = fileNameFromUnknown(decodeMaybeUri(String(obj.name ?? "")), "未命名文件");
  const pathValue = String(obj.path ?? "").trim();
  if (!pathValue) {
    throw new Error("上传响应异常：缺少文件路径");
  }
  const relativePath = String(obj.relative_path ?? "").trim();
  const mimeType = fileNameFromUnknown(decodeMaybeUri(String(obj.mime_type ?? "")), "application/octet-stream");
  const sizeValue = Number(obj.bytes ?? 0);
  return {
    name,
    path: pathValue,
    relativePath: relativePath || pathValue,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0
  };
}

async function uploadThreadAttachment(threadId: string, file: File): Promise<UploadedAttachmentMeta> {
  const headers = new Headers({
    ...authHeaders(),
    "Content-Type": "application/octet-stream",
    "X-File-Name": encodeURIComponent(fileNameFromUnknown(file.name, "upload.bin")),
    "X-File-Type": encodeURIComponent(fileNameFromUnknown(file.type, "application/octet-stream")),
    "X-File-Size": String(file.size)
  });

  const res = await fetch(`${apiBase()}/api/threads/${encodeURIComponent(threadId)}/attachments`, {
    method: "POST",
    credentials: "include",
    headers,
    body: file
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    notifyAuthInvalidStatus(res.status);
    const msg = (data && typeof data.detail === "string" && data.detail) || `上传失败(${res.status})`;
    throw new Error(msg);
  }

  return uploadedMetaFromUnknown((data as { attachment?: unknown }).attachment);
}

function buildUploadedAttachmentHint(meta: UploadedAttachmentMeta): string {
  return [
    `<uploaded_file name=${JSON.stringify(meta.name)} path=${JSON.stringify(meta.path)} relativePath=${JSON.stringify(meta.relativePath)} mimeType=${JSON.stringify(meta.mimeType)} bytes=${meta.size}>`,
    "文件已上传到工作区。请使用文件系统工具读取该路径，而不是假设内容已在上下文中。",
    "</uploaded_file>"
  ].join("\n");
}

class WorkspaceFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  constructor(private readonly resolveThreadId: () => Promise<string>) {}

  public async add(state: { file: File }): Promise<PendingAttachment> {
    const name = fileNameFromUnknown(state.file.name, "未命名文件");
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${name}-${Date.now()}`;

    return {
      id,
      type: guessAttachmentType(state.file),
      name,
      contentType: state.file.type || "application/octet-stream",
      file: state.file,
      status: { type: "requires-action", reason: "composer-send" }
    };
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const file = attachment.file;
    const threadId = await this.resolveThreadId();
    if (!threadId) {
      throw new Error("当前会话初始化失败，请重试");
    }
    const uploaded = await uploadThreadAttachment(threadId, file);
    const content: ThreadUserMessagePart[] = [{ type: "text", text: buildUploadedAttachmentHint(uploaded) }];
    const type = guessAttachmentType(file);

    return {
      ...attachment,
      type,
      contentType: uploaded.mimeType,
      status: { type: "complete" },
      content
    };
  }

  public async remove() {
    // noop
  }
}

function buildCodexRunConfig(cfg: AppliedConfig, mode: string): Record<string, unknown> {
  return {
    mode
  };
}

function findRuntimeMode(options: PortalRuntimeOptions | null, modeId: string) {
  if (!options) return undefined;
  return options.modes.find((mode) => mode.id === modeId);
}

function normalizeRuntimeConfig(cfg: AppliedConfig): AppliedConfig {
  const model = cfg.model.trim() || DEFAULT_MODEL;
  const workspace = cfg.workspace.trim() || DEFAULT_WORKSPACE;
  return {
    ...cfg,
    model,
    reasoningEffort: normalizeReasoningEffortForModel(model, cfg.reasoningEffort),
    workspace
  };
}

function formatProcessStatus(status: string | undefined): string {
  if (!status) return "";
  if (status === "in_progress") return "进行中";
  if (status === "completed") return "已完成";
  if (status === "failed") return "失败";
  return status;
}

function normalizeProcessTime(value: string | undefined): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(at);
}

function timelineKindLabel(kind: TimelineRow["kind"]): string {
  if (kind === "reasoning") return "思考";
  if (kind === "tool") return "工具";
  if (kind === "source") return "来源";
  if (kind === "meta") return "准备";
  if (kind === "done") return "完成";
  if (kind === "error") return "错误";
  if (kind === "debug") return "调试";
  return "步骤";
}

function toTokenCount(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.round(n);
}

function parseTurnUsage(value: unknown): TurnUsage | null {
  const usage = asRecord(value);
  if (!usage) return null;
  const inputTokens = toTokenCount(usage.input_tokens);
  const cachedInputTokens = toTokenCount(usage.cached_input_tokens);
  const outputTokens = toTokenCount(usage.output_tokens);
  if (inputTokens === null || cachedInputTokens === null || outputTokens === null) return null;
  return {
    inputTokens,
    cachedInputTokens,
    outputTokens
  };
}

function formatCompactTokens(tokens: number): string {
  if (tokens >= 1_000_000) {
    const inM = tokens / 1_000_000;
    return `${inM.toFixed(inM < 10 ? 1 : 0).replace(/\.0$/, "")}m`;
  }
  if (tokens >= 1_000) {
    const inK = tokens / 1_000;
    return `${inK.toFixed(inK < 10 ? 1 : 0).replace(/\.0$/, "")}k`;
  }
  return String(tokens);
}

function ellipsizeSingleLine(value: string, max = 32): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}...`;
}

function stageTextForCodexItem(
  itemType: string,
  lifecycle: "started" | "completed",
  item: Record<string, unknown> | null
): string {
  if (lifecycle === "started") {
    if (itemType === "reasoning") return "正在思考解决方案";
    if (itemType === "command_execution") {
      const command = typeof item?.command === "string" ? ellipsizeSingleLine(item.command, 28) : "";
      return command ? `正在执行命令：${command}` : "正在执行命令";
    }
    if (itemType === "mcp_tool_call") {
      const server = typeof item?.server === "string" ? item.server.trim() : "";
      const tool = typeof item?.tool === "string" ? item.tool.trim() : "";
      const toolName = [server, tool].filter(Boolean).join(".");
      return toolName ? `正在调用工具：${ellipsizeSingleLine(toolName, 30)}` : "正在调用工具";
    }
    if (itemType === "web_search") {
      const query = typeof item?.query === "string" ? ellipsizeSingleLine(item.query, 20) : "";
      return query ? `正在检索资料：${query}` : "正在检索资料";
    }
    if (itemType === "todo_list") return "正在更新执行计划";
    if (itemType === "file_change") return "正在写入文件变更";
    if (itemType === "agent_message") return "正在生成回复";
    if (itemType === "error") return "正在处理异常信息";
    return "正在执行步骤";
  }

  if (itemType === "reasoning") return "思考完成，继续处理中";
  if (itemType === "command_execution") return "命令执行完成";
  if (itemType === "mcp_tool_call") return "工具调用完成";
  if (itemType === "web_search") return "检索完成，整理结果";
  if (itemType === "todo_list") return "执行计划已更新";
  if (itemType === "file_change") return "文件变更已写入";
  if (itemType === "agent_message") return "正在生成回复";
  if (itemType === "error") return "检测到执行错误";
  return "步骤完成，继续处理中";
}

function messageTextForTitle(messages: readonly ThreadMessage[]): string {
  for (let i = 0; i < messages.length; i += 1) {
    const msg = messages[i];
    if (!msg || msg.role !== "user") continue;
    const text = msg.content
      .map((part) => {
        if (!part || typeof part !== "object") return "";
        if (part.type !== "text") return "";
        return typeof part.text === "string" ? part.text : "";
      })
      .filter(Boolean)
      .join(" ")
      .trim();
    if (text) return text;
  }
  return "";
}

function guessThreadTitle(messages: readonly ThreadMessage[]): string {
  const text = messageTextForTitle(messages)
    .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, "上传文件")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "新对话";
  return text.length <= 22 ? text : `${text.slice(0, 22)}...`;
}

function userTextFromUnknownMessage(message: unknown): string {
  const obj = asRecord(message);
  if (!obj) return "";
  if (obj.role !== "user") return "";

  const content = Array.isArray(obj.content) ? obj.content : [];
  const text = content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if ((part as { type?: unknown }).type !== "text") return "";
      return typeof (part as { text?: unknown }).text === "string" ? ((part as { text?: string }).text ?? "") : "";
    })
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  return text;
}

function isLikelyHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function extractSources(value: unknown): Array<{ id: string; url: string; title?: string }> {
  const results: Array<{ id: string; url: string; title?: string }> = [];
  const seen = new Set<string>();

  const push = (url: string, title?: string) => {
    const normalized = url.trim();
    if (!normalized || !isLikelyHttpUrl(normalized)) return;
    if (seen.has(normalized)) return;
    seen.add(normalized);
    results.push({
      id: `src-${results.length + 1}-${Math.random().toString(36).slice(2, 8)}`,
      url: normalized,
      title: title?.trim() || undefined
    });
  };

  const walk = (input: unknown, depth = 0) => {
    if (depth > 4 || results.length >= 8) return;
    if (Array.isArray(input)) {
      for (const item of input) walk(item, depth + 1);
      return;
    }
    if (!input || typeof input !== "object") return;
    const obj = input as Record<string, unknown>;
    const url =
      (typeof obj.url === "string" && obj.url) ||
      (typeof obj.link === "string" && obj.link) ||
      (typeof obj.href === "string" && obj.href) ||
      "";
    const title = typeof obj.title === "string" ? obj.title : typeof obj.name === "string" ? obj.name : undefined;
    if (url) push(url, title);

    for (const key of ["results", "sources", "items", "references", "data", "content", "value"]) {
      if (key in obj) walk(obj[key], depth + 1);
    }
  };

  walk(value);
  return results;
}

type PromptBucket = {
  textParts: string[];
  imageNames: Set<string>;
  fileNames: Set<string>;
};

function pushPromptText(bucket: PromptBucket, value: unknown) {
  if (typeof value !== "string") return;
  const trimmed = value.trim();
  if (!trimmed) return;
  bucket.textParts.push(truncateForPrompt(trimmed, PROMPT_TEXT_MAX_CHARS));
}

function pushPromptImageName(bucket: PromptBucket, value: unknown, fallback = "未命名图片") {
  bucket.imageNames.add(fileNameFromUnknown(value, fallback));
}

function pushPromptFileName(bucket: PromptBucket, value: unknown, fallback = "未命名文件") {
  bucket.fileNames.add(fileNameFromUnknown(value, fallback));
}

function pushPromptFilePart(
  bucket: PromptBucket,
  filePart: { filename?: unknown; mimeType?: unknown; data?: unknown },
  fallbackName: string
) {
  const name = fileNameFromUnknown(filePart.filename, fallbackName);
  pushPromptFileName(bucket, name);
}

function collectPromptPart(bucket: PromptBucket, part: unknown, fallbackName = "未命名文件") {
  if (!part || typeof part !== "object") return;
  const type = (part as { type?: unknown }).type;
  if (type === "text") {
    pushPromptText(bucket, (part as { text?: unknown }).text);
    return;
  }
  if (type === "image") {
    pushPromptImageName(bucket, (part as { filename?: unknown }).filename, fallbackName);
    return;
  }
  if (type === "file") {
    pushPromptFilePart(bucket, part as { filename?: unknown; mimeType?: unknown; data?: unknown }, fallbackName);
  }
}

function collectPromptAttachment(bucket: PromptBucket, attachment: unknown) {
  if (!attachment || typeof attachment !== "object") return;
  const att = attachment as { type?: unknown; name?: unknown; content?: unknown };
  const attachmentName = fileNameFromUnknown(att.name, "未命名文件");
  if (att.type === "image") {
    pushPromptImageName(bucket, attachmentName, "未命名图片");
  } else {
    pushPromptFileName(bucket, attachmentName, "未命名文件");
  }

  if (!Array.isArray(att.content)) return;
  for (const part of att.content) {
    collectPromptPart(bucket, part, attachmentName);
  }
}

function extractLatestPrompt(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const msg = messages[i];
    if (!msg || typeof msg !== "object") continue;
    const role = (msg as { role?: unknown }).role;
    if (role !== "user") continue;

    const bucket: PromptBucket = {
      textParts: [],
      imageNames: new Set<string>(),
      fileNames: new Set<string>()
    };

    const content = (msg as { content?: unknown }).content;
    if (Array.isArray(content)) {
      for (const part of content) {
        collectPromptPart(bucket, part);
      }
    }

    const attachments = (msg as { attachments?: unknown }).attachments;
    if (Array.isArray(attachments)) {
      for (const attachment of attachments) {
        collectPromptAttachment(bucket, attachment);
      }
    }

    const mainText = bucket.textParts.join("\n").trim();
    const attachmentHints: string[] = [];
    if (bucket.imageNames.size > 0) {
      attachmentHints.push(`用户上传了图片：${Array.from(bucket.imageNames).join("、")}`);
    }
    if (bucket.fileNames.size > 0) {
      attachmentHints.push(`用户上传了文件：${Array.from(bucket.fileNames).join("、")}`);
    }
    const combined = [mainText, attachmentHints.join("\n")].filter(Boolean).join("\n\n").trim();
    if (combined) return combined;
  }
  return "";
}

function isBlobFile(value: unknown): value is Blob {
  if (typeof Blob === "undefined") return false;
  return value instanceof Blob;
}

function sanitizeUserAttachments(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((attachment) => {
      const obj = asRecord(attachment);
      if (!obj) return null;

      const cleaned: Record<string, unknown> = { ...obj };
      if (!isBlobFile(cleaned.file)) {
        delete cleaned.file;
      }

      if (!Array.isArray(cleaned.content)) {
        cleaned.content = [];
      }

      return cleaned;
    })
    .filter((attachment): attachment is Record<string, unknown> => !!attachment);
}

function sanitizeMessageForPersistence(message: unknown): unknown {
  const obj = asRecord(message);
  if (!obj) return message;

  if (obj.role !== "user") {
    return message;
  }

  return {
    ...obj,
    attachments: sanitizeUserAttachments(obj.attachments)
  };
}

function reviveMessage(message: unknown): unknown {
  const obj = asRecord(message);
  if (!obj) return message;

  const role = typeof obj.role === "string" ? obj.role : "";
  const revived: Record<string, unknown> = { ...obj };

  if (typeof revived.createdAt === "string" || typeof revived.createdAt === "number") {
    revived.createdAt = new Date(revived.createdAt);
  } else if (!(revived.createdAt instanceof Date)) {
    revived.createdAt = new Date();
  }

  if (!Array.isArray(revived.content)) {
    if (typeof revived.content === "string" && revived.content.trim()) {
      revived.content = [{ type: "text", text: revived.content }];
    } else {
      revived.content = [];
    }
  }

  const metadata = asRecord(revived.metadata) || {};
  const custom = asRecord(metadata.custom) || {};
  const fixedMetadata: Record<string, unknown> = {
    ...metadata,
    custom
  };

  if (role === "assistant") {
    if (!("unstable_state" in fixedMetadata)) fixedMetadata.unstable_state = {};
    if (!Array.isArray(fixedMetadata.unstable_annotations)) fixedMetadata.unstable_annotations = [];
    if (!Array.isArray(fixedMetadata.unstable_data)) fixedMetadata.unstable_data = [];
    if (!Array.isArray(fixedMetadata.steps)) fixedMetadata.steps = [];

    const status = asRecord(revived.status);
    if (!status || typeof status.type !== "string") {
      revived.status = { type: "complete", reason: "unknown" };
    }
  }

  if (role === "user") {
    revived.attachments = sanitizeUserAttachments(revived.attachments);
  }

  revived.metadata = fixedMetadata;
  return revived;
}

function messageTextForSuggestions(message: ThreadMessage): string {
  return message.content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      if (part.type === "text" && typeof part.text === "string") return part.text;
      if (part.type === "reasoning" && typeof part.text === "string") return part.text;
      return "";
    })
    .filter(Boolean)
    .join("\n")
    .trim();
}

const ReasoningPart: FC<any> = ({ text }) => {
  const value = typeof text === "string" ? text.trim() : "";
  if (!value) return null;
  return (
    <details className="process-block process-reasoning" open={false}>
      <summary>思考摘要</summary>
      <pre>{value}</pre>
    </details>
  );
};

const SourcePart: FC<any> = ({ url, title }) => {
  const link = typeof url === "string" ? url.trim() : "";
  if (!link) return null;
  const label = typeof title === "string" && title.trim() ? title.trim() : link;
  return (
    <p className="process-source">
      <a href={link} target="_blank" rel="noreferrer">
        来源：{label}
      </a>
    </p>
  );
};

const HiddenToolFallback: FC<any> = () => null;

const RunningMessagePlaceholder: FC<EmptyMessagePartProps> = ({ status }) => {
  const runningStageText = useContext(RunningStageTextContext);
  if (status.type !== "running") return null;

  return (
    <div
      className="assistant-running-card"
      role="status"
      aria-live="polite"
      aria-label={`助手正在处理中：${runningStageText}`}
    >
      <div className="assistant-running-head">
        <span className="assistant-running-spinner" aria-hidden="true" />
        <span className="assistant-running-title">正在处理请求</span>
        <span className="assistant-running-chip">实时</span>
      </div>
      <p className="assistant-running-phase">{runningStageText}</p>
      <div className="assistant-running-track" aria-hidden="true">
        <span className="assistant-running-track-bar" />
      </div>
    </div>
  );
};

const ProcessDataFallback: FC<any> = ({
  name,
  data
}: {
  name?: string;
  data?: ProcessData | unknown;
}) => {
  if (name === "codex_trace_batch") {
    const payload = asRecord(data) || {};
    const batchId = typeof payload.batch_id === "number" ? payload.batch_id : 0;
    const batchOpen = payload.open !== false;
    const activeRowId =
      typeof payload.active_row_id === "string" && payload.active_row_id.trim()
        ? payload.active_row_id.trim()
        : "";
    const rowsInput = Array.isArray(payload.rows) ? payload.rows : [];
    const rows: TimelineRow[] = rowsInput
      .map((item, index) => {
        const obj = asRecord(item);
        if (!obj) return null;
        const kindRaw = typeof obj.kind === "string" ? obj.kind : "process";
        const kind = ["reasoning", "tool", "source", "meta", "process", "done", "error", "debug"].includes(kindRaw)
          ? (kindRaw as TimelineRow["kind"])
          : "process";
        const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "过程事件";
        const detail = typeof obj.detail === "string" ? obj.detail.trim() : "";
        const at = typeof obj.at === "string" ? normalizeProcessTime(obj.at) : "";
        return {
          id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `trace-batch-${index + 1}`,
          kind,
          title,
          detail: detail || undefined,
          at: at || undefined
        } satisfies TimelineRow;
      })
      .filter(Boolean) as TimelineRow[];

    if (rows.length === 0) return null;

    const reasoningCount = rows.filter((row) => row.kind === "reasoning").length;
    const toolCount = rows.filter((row) => row.kind === "tool").length;
    const stepCount = rows.filter((row) => row.kind !== "reasoning" && row.kind !== "tool").length;
    const resolvedActiveId = activeRowId || rows[rows.length - 1]?.id || "";

    return (
      <details className="trace-panel trace-panel-inline" open={batchOpen}>
        <summary className="trace-summary">{`过程轨迹 ${rows.length} 条（思考 ${reasoningCount} / 工具 ${toolCount} / 步骤 ${stepCount}）`}</summary>
        <ol className="trace-timeline">
          {rows.map((row, index) => {
            const isActiveStep = row.id === resolvedActiveId || (!resolvedActiveId && index === rows.length - 1);
            const rowKey = `${batchId}-${row.id}-${resolvedActiveId || "none"}`;
            return (
              <li key={rowKey} className="trace-line">
                <span className={`trace-node trace-node-${row.kind} ${isActiveStep ? "trace-node-active" : ""}`} />
                <details className={`trace-card trace-step ${isActiveStep ? "trace-step-active" : ""}`} open={isActiveStep}>
                  <summary className="trace-card-head trace-step-summary">
                    <span className={`trace-pill trace-pill-${row.kind}`}>{timelineKindLabel(row.kind)}</span>
                    <span className="trace-item-title">{row.title}</span>
                    {row.at ? <span className="trace-item-time">{row.at}</span> : null}
                  </summary>
                  {row.detail ? <pre className="trace-item-detail">{row.detail}</pre> : null}
                </details>
              </li>
            );
          })}
        </ol>
      </details>
    );
  }

  if (name !== "codex_process") {
    return (
      <details className="process-block process-data" open={false}>
        <summary>数据事件</summary>
        <pre>{shorten(detailFromUnknown(data), 1200)}</pre>
      </details>
    );
  }
  const row = (data && typeof data === "object" ? data : {}) as ProcessData;
  const title = typeof row.title === "string" ? row.title : "过程事件";
  const detail = typeof row.detail === "string" ? row.detail : "";
  const kind = typeof row.kind === "string" ? row.kind : "process";
  const at = typeof row.at === "string" ? row.at.replace("T", " ").replace("Z", "").slice(0, 19) : "";
  return (
    <details className={`process-block process-data process-${kind}`} open={kind === "error"}>
      <summary>{title}</summary>
      {at ? <p className="process-time">{at}</p> : null}
      {detail ? <pre>{shorten(detail, 1600)}</pre> : null}
    </details>
  );
};

function extractTimelineRows(content: unknown): TimelineRow[] {
  if (!Array.isArray(content)) return [];
  const rows: TimelineRow[] = [];
  let seq = 0;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const p = part as Record<string, unknown>;
    const type = typeof p.type === "string" ? p.type : "";

    if (type === "text" || type === "image" || type === "file") continue;

    if (type === "reasoning") {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) continue;
      rows.push({
        id: `timeline-${++seq}`,
        kind: "reasoning",
        title: "思考摘要",
        detail: shorten(text, 1200)
      });
      continue;
    }

    if (type === "tool-call") {
      const toolName = typeof p.toolName === "string" ? p.toolName : "unknown";
      const argsText = typeof p.argsText === "string" ? p.argsText : detailFromUnknown(p.args);
      const resultText = p.result === undefined ? "" : detailFromUnknown(p.result);
      rows.push({
        id: `timeline-${++seq}`,
        kind: "tool",
        title: `工具调用 · ${toolName}`,
        detail: [shorten(argsText, 800), shorten(resultText, 1000)].filter(Boolean).join("\n\n")
      });
      continue;
    }

    if (type === "source") {
      const url = typeof p.url === "string" ? p.url.trim() : "";
      if (!url) continue;
      const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : "来源链接";
      rows.push({
        id: `timeline-${++seq}`,
        kind: "source",
        title,
        detail: url
      });
      continue;
    }

    if (type === "data" && p.name === "codex_process" && p.data && typeof p.data === "object") {
      const data = p.data as Record<string, unknown>;
      const kindRaw = typeof data.kind === "string" ? data.kind : "process";
      const kind = ["meta", "process", "done", "error", "debug"].includes(kindRaw) ? (kindRaw as TimelineRow["kind"]) : "process";
      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "过程事件";
      const detail = typeof data.detail === "string" ? data.detail.trim() : "";
      const at = typeof data.at === "string" ? normalizeProcessTime(data.at) : "";
      rows.push({
        id: `timeline-${++seq}`,
        kind,
        title,
        detail: detail ? shorten(detail, 1400) : undefined,
        at
      });
      continue;
    }

    if (type === "data") {
      rows.push({
        id: `timeline-${++seq}`,
        kind: "process",
        title: "数据事件",
        detail: shorten(detailFromUnknown(p), 1200)
      });
    }
  }

  return rows;
}

const AgentAssistantMessage: FC = () => {
  return (
    <AssistantMessage.Root>
      <AssistantMessage.Avatar />
      <AssistantMessage.Content
        components={{
          Text: AssistantMarkdownText,
          Empty: RunningMessagePlaceholder as any,
          Reasoning: ReasoningPart as any,
          Source: SourcePart as any,
          data: { Fallback: ProcessDataFallback as any }
        }}
      />
      <BranchPicker />
      <AssistantActionBar />
    </AssistantMessage.Root>
  );
};

const AgentThreadListItem: FC = () => {
  const aui = useAui();
  const threadItemId = useAuiState((s) => s.threadListItem.id);
  const threadTitle = useAuiState((s) => (typeof s.threadListItem.title === "string" ? s.threadListItem.title : ""));
  const sessionSearchQuery = useContext(SessionSearchContext).trim().toLowerCase();
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const threadTitleForFilter = threadTitle.trim() || "新对话";

  useEffect(() => {
    setIsRenaming(false);
    setRenameSaving(false);
  }, [threadItemId]);

  useEffect(() => {
    if (!isRenaming) {
      setRenameDraft(threadTitle.trim());
    }
  }, [isRenaming, threadTitle]);

  useEffect(() => {
    if (!isRenaming) return;
    const input = renameInputRef.current;
    if (!input) return;
    input.focus();
    input.select();
  }, [isRenaming]);

  const beginRename = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (renameSaving) return;
    setRenameDraft(threadTitle.trim());
    setIsRenaming(true);
  };

  const cancelRename = (event?: ReactMouseEvent<HTMLElement>) => {
    event?.preventDefault();
    event?.stopPropagation();
    if (renameSaving) return;
    setRenameDraft(threadTitle.trim());
    setIsRenaming(false);
  };

  const submitRename = async () => {
    if (renameSaving) return;
    setRenameSaving(true);
    try {
      await aui.threadListItem().rename(renameDraft.trim());
      setIsRenaming(false);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "会话重命名失败";
      window.alert(detail);
    } finally {
      setRenameSaving(false);
    }
  };

  const onRenameInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      void submitRename();
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelRename();
    }
  };

  if (sessionSearchQuery && !threadTitleForFilter.toLowerCase().includes(sessionSearchQuery)) {
    return null;
  }

  return (
    <ThreadListItemPrimitive.Root className="aui-thread-list-item agent-thread-list-item">
      {isRenaming ? (
        <div className="thread-title-edit-wrap" onClick={(event) => event.stopPropagation()}>
          <input
            ref={renameInputRef}
            className="thread-title-edit-input"
            value={renameDraft}
            onChange={(event) => setRenameDraft(event.target.value)}
            onKeyDown={onRenameInputKeyDown}
            placeholder="输入会话名称"
            disabled={renameSaving}
          />
        </div>
      ) : (
        <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger">
          <p className="aui-thread-list-item-title">
            <ThreadListItemPrimitive.Title fallback="新对话" />
          </p>
        </ThreadListItemPrimitive.Trigger>
      )}
      <div className="agent-thread-item-actions">
        {isRenaming ? (
          <>
            <button
              type="button"
              className="thread-item-action-btn thread-item-save-btn"
              title="保存会话名称"
              aria-label="保存会话名称"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                void submitRename();
              }}
              disabled={renameSaving}
            >
              <CheckIcon size={14} />
            </button>
            <button
              type="button"
              className="thread-item-action-btn"
              title="取消修改"
              aria-label="取消修改"
              onClick={cancelRename}
              disabled={renameSaving}
            >
              <XIcon size={14} />
            </button>
          </>
        ) : (
          <button
            type="button"
            className="thread-item-action-btn"
            title="重命名会话"
            aria-label="重命名会话"
            onClick={beginRename}
          >
            <PencilIcon size={14} />
          </button>
        )}
        <ThreadListItemPrimitive.Delete
          className="thread-item-action-btn thread-item-delete-btn"
          title="删除会话"
          aria-label="删除会话"
          disabled={isRenaming}
          onClick={(e) => {
            const confirmed = window.confirm("确认永久删除该会话吗？该操作不可恢复。");
            if (!confirmed) {
              e.preventDefault();
              e.stopPropagation();
            }
          }}
        >
          <Trash2Icon size={14} />
        </ThreadListItemPrimitive.Delete>
      </div>
    </ThreadListItemPrimitive.Root>
  );
};

const ComposerActivationGuard: FC = () => {
  const aui = useAui();
  const threadItemId = useAuiState((s) => s.threadListItem.id);
  const isComposerEditing = useAuiState((s) => s.composer.isEditing);
  const composerType = useAuiState((s) => s.composer.type);
  const threadLoading = useAuiState((s) => s.thread.isLoading);
  const recoveredThreadIdRef = useRef("");

  const ensureComposerReady = useCallback(() => {
    if (threadLoading || isComposerEditing) {
      recoveredThreadIdRef.current = "";
      return;
    }

    const normalizedThreadId = String(threadItemId || "").trim();
    if (!normalizedThreadId) return;
    if (recoveredThreadIdRef.current === normalizedThreadId) return;
    recoveredThreadIdRef.current = normalizedThreadId;

    if (composerType === "edit") {
      try {
        aui.composer().beginEdit();
      } catch {
        // ignore, runtime may not expose beginEdit yet
      }
      return;
    }

    try {
      // Re-select active thread to recover from stale no-op composer bindings.
      aui.threadListItem().switchTo();
    } catch {
      // ignore switch failures; next thread event will retry
    }
  }, [aui, composerType, isComposerEditing, threadItemId, threadLoading]);

  useEffect(() => {
    ensureComposerReady();
  }, [ensureComposerReady]);

  useAuiEvent("thread.initialize", ensureComposerReady);
  useAuiEvent("threadListItem.switchedTo", ensureComposerReady);

  return null;
};

const AgentRuntimeAdapterProvider: FC<
  PropsWithChildren<{
    onThreadIdentityChange?: (identity: ThreadIdentity) => void;
    canUpload?: boolean;
  }>
> = ({ children, onThreadIdentityChange, canUpload = true }) => {
  const aui = useAui();
  const activeRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const activeLocalId = useAuiState((s) => s.threadListItem.id);
  const autoTitleTriggeredRemoteIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    onThreadIdentityChange?.({
      remoteId: typeof activeRemoteId === "string" ? activeRemoteId : undefined,
      localId: typeof activeLocalId === "string" ? activeLocalId : undefined
    });
  }, [activeLocalId, activeRemoteId, onThreadIdentityChange]);

  const history = useMemo<ThreadHistoryAdapter>(
    () => ({
      async load() {
        const remoteId = aui.threadListItem().getState().remoteId;
        if (!remoteId) return { messages: [] };
        const out = await api<ThreadMessagesOut>(`/api/threads/${encodeURIComponent(remoteId)}/messages`);
        const repository: ExportedMessageRepository = {
          headId: out.head_id ?? null,
          messages: (out.messages || []).map((item) => ({
            parentId: item.parent_id ?? null,
            message: reviveMessage(item.message) as any,
            ...(item.run_config ? { runConfig: item.run_config } : undefined)
          }))
        };
        return repository;
      },
      async append(item: ExportedMessageRepositoryItem) {
        const init = await aui.threadListItem().initialize();
        const remoteId = init.remoteId;
        const state = aui.threadListItem().getState();
        const messageForPersistence = sanitizeMessageForPersistence(item.message);
        const hasTitle =
          state.remoteId === remoteId && typeof state.title === "string" && state.title.trim().length > 0;
        await api(`/api/threads/${encodeURIComponent(remoteId)}/messages`, {
          method: "POST",
          json: {
            parent_id: item.parentId ?? null,
            message: messageForPersistence,
            run_config: item.runConfig
          }
        });

        const firstUserText = userTextFromUnknownMessage(messageForPersistence);
        const shouldGenerateTitle =
          !hasTitle &&
          !!firstUserText &&
          state.remoteId === remoteId &&
          !autoTitleTriggeredRemoteIdsRef.current.has(remoteId);
        if (shouldGenerateTitle) {
          autoTitleTriggeredRemoteIdsRef.current.add(remoteId);
          Promise.resolve()
            .then(() => aui.threadListItem().generateTitle())
            .catch(() => {
              autoTitleTriggeredRemoteIdsRef.current.delete(remoteId);
            });
        }
      }
    }),
    [aui]
  );

  const feedback = useMemo(
    () => ({
      submit(payload: { message: ThreadMessage; type: "positive" | "negative" }) {
        const remoteId = aui.threadListItem().getState().remoteId;
        if (!remoteId) return;
        const preview = messageTextForSuggestions(payload.message);
        void api(`/api/threads/${encodeURIComponent(remoteId)}/feedback`, {
          method: "POST",
          json: {
            type: payload.type,
            message_id: payload.message.id,
            content_preview: preview
          }
        }).catch(() => {});
      }
    }),
    [aui]
  );

  const attachments = useMemo(
    () =>
      canUpload
        ? new CompositeAttachmentAdapter([
            new WorkspaceFileAttachmentAdapter(async () => {
              const item = aui.threadListItem();
              const current = String(item.getState().remoteId || "").trim();
              if (current) return current;
              const initialized = await item.initialize();
              return String(initialized.remoteId || item.getState().remoteId || "").trim();
            })
          ])
        : undefined,
    [aui, canUpload]
  );

  const adapters = useMemo(
    () => ({
      history,
      feedback,
      ...(attachments ? { attachments } : {})
    }),
    [attachments, feedback, history]
  );

  return <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>;
};

export function PortalShell(props: { currentUser?: AuthUser; onOpenAdmin?: () => void; onSignOut?: () => void }) {
  const [appliedConfig, setAppliedConfig] = useState<AppliedConfig>({
    workspace: DEFAULT_WORKSPACE,
    model: DEFAULT_MODEL,
    reasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "disabled",
    additionalDirectoriesRaw: ""
  });
  const [runtimeOptions, setRuntimeOptions] = useState<PortalRuntimeOptions | null>(null);
  const [portalResources, setPortalResources] = useState<PortalResourcesResponse | null>(null);
  const [runtimeMode, setRuntimeMode] = useState("standard");
  const [layoutState, setLayoutState] = useState(createInitialLayoutState());
  const [sessionSearchValue, setSessionSearchValue] = useState("");
  const [activeThreadIdentity, setActiveThreadIdentity] = useState<ThreadIdentity>({});
  const [threadCollaboration, setThreadCollaboration] = useState<ThreadCollaborationView | null>(null);
  const [threadCollaborationLoading, setThreadCollaborationLoading] = useState(false);
  const [threadCollaborationErrorText, setThreadCollaborationErrorText] = useState("");

  const [statusText, setStatusText] = useState("就绪");
  const [runningStageText, setRunningStageText] = useState(DEFAULT_RUNNING_STAGE_TEXT);
  const [errorText, setErrorText] = useState("");
  const [resourceErrorText, setResourceErrorText] = useState("");
  const [showProcessTrace, setShowProcessTrace] = useState(true);
  const [collapseFinalTraceOnDone, setCollapseFinalTraceOnDone] = useState(true);
  const [contextUsage, setContextUsage] = useState<ContextUsageSnapshot | null>(null);
  const [selectedKnowledgeSetIds, setSelectedKnowledgeSetIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<DirectoryPickerTarget>("workspace");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerRoots, setPickerRoots] = useState<string[]>([]);
  const [pickerCwd, setPickerCwd] = useState("");
  const [pickerPathInput, setPickerPathInput] = useState("");
  const [pickerParent, setPickerParent] = useState<string | null>(null);
  const [pickerDirectories, setPickerDirectories] = useState<Array<{ name: string; path: string }>>([]);

  const appliedConfigRef = useRef(appliedConfig);
  const runtimeOptionsRef = useRef(runtimeOptions);
  const runtimeModeRef = useRef(runtimeMode);
  const showProcessTraceRef = useRef(showProcessTrace);
  const collapseFinalTraceOnDoneRef = useRef(collapseFinalTraceOnDone);
  const activeRemoteThreadIdRef = useRef("");
  const activeLocalThreadIdRef = useRef("");
  const usageByThreadRef = useRef<Record<string, ContextUsageSnapshot>>({});
  const runningStageTextRef = useRef(runningStageText);
  const selectedKnowledgeSetIdsRef = useRef(selectedKnowledgeSetIds);
  const activeThreadIdentityRef = useRef<ThreadIdentity>({});
  const threadCollaborationRef = useRef<ThreadCollaborationView | null>(null);
  const threadCollaborationLoadingRef = useRef(false);
  const pickerRequestSeqRef = useRef(0);
  const pickerAutoJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  appliedConfigRef.current = appliedConfig;
  runtimeOptionsRef.current = runtimeOptions;
  runtimeModeRef.current = runtimeMode;
  showProcessTraceRef.current = showProcessTrace;
  collapseFinalTraceOnDoneRef.current = collapseFinalTraceOnDone;
  runningStageTextRef.current = runningStageText;
  selectedKnowledgeSetIdsRef.current = selectedKnowledgeSetIds;
  activeThreadIdentityRef.current = activeThreadIdentity;
  threadCollaborationRef.current = threadCollaboration;
  threadCollaborationLoadingRef.current = threadCollaborationLoading;

  useEffect(() => {
    let active = true;

    async function loadRuntimeOptions() {
      try {
        const next = await api<PortalRuntimeOptions>("/api/portal/runtime-options");
        if (!active) return;
        setRuntimeOptions(next);
        setRuntimeMode((prev) =>
          next.modes.some((item) => item.id === prev) ? prev : next.defaults.mode || next.modes[0]?.id || ""
        );
        setAppliedConfig((prev) => {
          const nextMode = findRuntimeMode(next, next.defaults.mode || next.modes[0]?.id || "");
          const runtimeProfile = nextMode?.runtimeProfile;
          return {
            ...prev,
            model: runtimeProfile?.defaultModel || prev.model,
            reasoningEffort: normalizeReasoningEffortForModel(
              runtimeProfile?.defaultModel || prev.model,
              (runtimeProfile?.defaultReasoningEffort as ReasoningEffort | undefined) || prev.reasoningEffort
            ),
            sandboxMode: (runtimeProfile?.sandboxMode as SandboxMode | undefined) || prev.sandboxMode,
            approvalPolicy: (runtimeProfile?.approvalPolicy as ApprovalPolicy | undefined) || prev.approvalPolicy,
            networkAccessEnabled: runtimeProfile?.networkAccessEnabled ?? prev.networkAccessEnabled,
            webSearchMode: (runtimeProfile?.webSearchMode as WebSearchMode | undefined) || prev.webSearchMode
          };
        });
      } catch (error) {
        if (!active) return;
        setErrorText(error instanceof Error ? error.message : "加载运行策略失败");
      }
    }

    void loadRuntimeOptions();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const remoteThreadId = String(activeThreadIdentity.remoteId || "").trim();
    if (!remoteThreadId) {
      setThreadCollaboration(null);
      setThreadCollaborationLoading(false);
      setThreadCollaborationErrorText("");
      return;
    }

    let cancelled = false;
    setThreadCollaborationLoading(true);
    setThreadCollaborationErrorText("");

    void fetchThreadCollaboration(remoteThreadId)
      .then((next) => {
        if (cancelled) return;
        setThreadCollaboration(next);
      })
      .catch((error) => {
        if (cancelled) return;
        setThreadCollaboration(null);
        setThreadCollaborationErrorText(error instanceof Error ? error.message : "加载协作状态失败");
      })
      .finally(() => {
        if (!cancelled) setThreadCollaborationLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [activeThreadIdentity.remoteId]);

  useEffect(() => {
    const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
    if (!selectedMode) return;
    setAppliedConfig((prev) => {
      return {
        ...prev,
        model: selectedMode.runtimeProfile.defaultModel,
        reasoningEffort: normalizeReasoningEffortForModel(
          selectedMode.runtimeProfile.defaultModel,
          selectedMode.runtimeProfile.defaultReasoningEffort as ReasoningEffort
        ),
        sandboxMode: selectedMode.runtimeProfile.sandboxMode as SandboxMode,
        approvalPolicy: selectedMode.runtimeProfile.approvalPolicy as ApprovalPolicy,
        networkAccessEnabled: selectedMode.runtimeProfile.networkAccessEnabled,
        webSearchMode: selectedMode.runtimeProfile.webSearchMode as WebSearchMode
      };
    });
  }, [runtimeMode, runtimeOptions]);

  useEffect(() => {
    let active = true;

    async function loadPortalResources() {
      try {
        const next = await fetchPortalResources();
        if (!active) return;
        setResourceErrorText("");
        setPortalResources(next);
        const allowedIds = new Set((next.knowledgeSets || []).map((item) => item.id));
        setSelectedKnowledgeSetIds((prev) => prev.filter((id) => allowedIds.has(id)));
      } catch (error) {
        if (!active) return;
        setResourceErrorText(error instanceof Error ? error.message : "加载知识集资源失败");
      }
    }

    void loadPortalResources();
    return () => {
      active = false;
    };
  }, []);

  const updateRunningStage = (next: string) => {
    if (!next || runningStageTextRef.current === next) return;
    runningStageTextRef.current = next;
    setRunningStageText(next);
  };

  const additionalDirectoriesList = useMemo(
    () => parseDirectories(appliedConfig.additionalDirectoriesRaw) || [],
    [appliedConfig.additionalDirectoriesRaw]
  );

  const contextUsageView = useMemo(() => {
    if (!contextUsage) {
      return {
        usedPercent: 0,
        tone: "idle" as ContextUsageTone,
        summaryLine: "Context usage unavailable",
        detailLine: "Send a message to collect usage",
        ariaLabel: "Context usage unavailable. Send a message to collect usage."
      };
    }

    const nonCachedInputTokens = Math.max(0, contextUsage.inputTokens - contextUsage.cachedInputTokens);
    const usedTokens = nonCachedInputTokens;
    const safeLimit = Math.max(1, contextUsage.contextLimit);
    const usedPercent = Math.min(100, Math.max(0, Math.round((usedTokens / safeLimit) * 100)));
    const leftPercent = Math.max(0, 100 - usedPercent);
    const tone: ContextUsageTone = usedPercent >= 90 ? "critical" : usedPercent >= 75 ? "warn" : "ok";
    const summaryLine = `${usedPercent}% used (${leftPercent}% left)`;
    const detailLine = `${formatCompactTokens(usedTokens)} / ${formatCompactTokens(safeLimit)} tokens used`;
    const ariaLabel = [
      summaryLine,
      detailLine,
      `input ${contextUsage.inputTokens}`,
      `cached ${contextUsage.cachedInputTokens}`,
      `output ${contextUsage.outputTokens}`
    ].join(". ");
    return { usedPercent, tone, summaryLine, detailLine, ariaLabel };
  }, [contextUsage]);

  const cancelPickerAutoJump = () => {
    if (pickerAutoJumpTimerRef.current !== null) {
      clearTimeout(pickerAutoJumpTimerRef.current);
      pickerAutoJumpTimerRef.current = null;
    }
  };

  const loadDirectoryTree = async (candidatePath?: string, options: DirectoryLoadOptions = {}) => {
    const requestSeq = ++pickerRequestSeqRef.current;
    const normalizedCandidatePath = String(candidatePath || "").trim();
    setPickerLoading(true);
    setPickerError("");
    try {
      const query = new URLSearchParams();
      if (normalizedCandidatePath) {
        query.set("path", normalizedCandidatePath);
      }
      const suffix = query.toString() ? `?${query.toString()}` : "";
      const out = await api<DirectoryBrowseOut>(`/api/fs/directories${suffix}`);
      if (requestSeq !== pickerRequestSeqRef.current) return;
      setPickerRoots(Array.isArray(out.roots) ? out.roots : []);
      setPickerCwd(String(out.cwd || ""));
      if (options.syncInput !== false) {
        setPickerPathInput(String(out.cwd || normalizedCandidatePath || ""));
      }
      setPickerParent(typeof out.parent === "string" ? out.parent : null);
      setPickerDirectories(Array.isArray(out.directories) ? out.directories : []);
    } catch (error) {
      if (requestSeq !== pickerRequestSeqRef.current) return;
      const detail = error instanceof Error ? error.message : "读取目录失败";
      setPickerError(detail);
      if (!options.keepDirectoriesOnError) {
        setPickerDirectories([]);
      }
    } finally {
      if (requestSeq === pickerRequestSeqRef.current) {
        setPickerLoading(false);
      }
    }
  };

  const openDirectoryPicker = (target: DirectoryPickerTarget) => {
    setPickerTarget(target);
    setPickerOpen(true);
    const firstAdditional = parseDirectories(appliedConfig.additionalDirectoriesRaw)?.[0];
    const initialPath =
      target === "workspace" ? appliedConfig.workspace.trim() : (firstAdditional || appliedConfig.workspace).trim();
    setPickerPathInput(initialPath);
    cancelPickerAutoJump();
    void loadDirectoryTree(initialPath || undefined, { syncInput: true });
  };

  const jumpToDirectoryFromInput = () => {
    const candidate = pickerPathInput.trim();
    cancelPickerAutoJump();
    if (!candidate) {
      setPickerError("请输入目录路径");
      return;
    }
    void loadDirectoryTree(candidate, { syncInput: true, keepDirectoriesOnError: true });
  };

  const onPickerPathInputChange = (rawValue: string) => {
    setPickerPathInput(rawValue);
    const candidate = rawValue.trim();
    cancelPickerAutoJump();
    if (!candidate) {
      setPickerError("");
      return;
    }
    pickerAutoJumpTimerRef.current = setTimeout(() => {
      void loadDirectoryTree(candidate, {
        syncInput: false,
        keepDirectoriesOnError: true
      });
    }, 280);
  };

  const onPickerPathInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    event.stopPropagation();
    jumpToDirectoryFromInput();
  };

  useEffect(() => {
    if (pickerOpen) return;
    cancelPickerAutoJump();
  }, [pickerOpen]);

  useEffect(() => {
    return () => {
      cancelPickerAutoJump();
    };
  }, []);

  const selectDirectory = (selectedPath: string) => {
    const normalized = selectedPath.trim();
    if (!normalized) return;
    if (pickerTarget === "workspace") {
      setAppliedConfig((prev) => ({ ...prev, workspace: normalized }));
      setPickerOpen(false);
      return;
    }
    setAppliedConfig((prev) => {
      const list = parseDirectories(prev.additionalDirectoriesRaw) || [];
      return {
        ...prev,
        additionalDirectoriesRaw: formatDirectories([...list, normalized])
      };
    });
    setStatusText(`已添加附加目录：${normalized}`);
  };

  const removeAdditionalDirectory = (pathToRemove: string) => {
    setAppliedConfig((prev) => {
      const list = parseDirectories(prev.additionalDirectoriesRaw) || [];
      return {
        ...prev,
        additionalDirectoriesRaw: formatDirectories(list.filter((item) => item !== pathToRemove))
      };
    });
  };

  const threadListAdapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const out = await api<ThreadListOut>("/api/threads");
        return {
          threads: (out.threads || []).map((thread) => ({
            status: thread.status,
            remoteId: thread.id,
            externalId: thread.external_id,
            title: thread.title
          }))
        };
      },
      async initialize(threadId: string) {
        const cfg = normalizeRuntimeConfig(appliedConfigRef.current);
        const knowledgeSetIds = normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current);
        const created = await api<ThreadCreateOut>("/api/threads", {
          method: "POST",
          json: {
            external_id: threadId,
            model: cfg.model,
            reasoning_effort: cfg.reasoningEffort,
            knowledge_set_ids: knowledgeSetIds,
            codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current)
          }
        });
        setActiveThreadIdentity({
          remoteId: created.thread.id,
          localId: threadId || undefined
        });
        return {
          remoteId: created.thread.id,
          externalId: created.thread.external_id
        };
      },
      async rename(remoteId: string, newTitle: string) {
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { title: newTitle }
        });
      },
      async archive(remoteId: string) {
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { status: "archived" }
        });
      },
      async unarchive(remoteId: string) {
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { status: "regular" }
        });
      },
      async delete(remoteId: string) {
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "DELETE"
        });
      },
      async fetch(threadId: string) {
        const out = await api<ThreadOneOut>(`/api/threads/${encodeURIComponent(threadId)}`);
        return {
          status: out.thread.status,
          remoteId: out.thread.id,
          externalId: out.thread.external_id,
          title: out.thread.title
        };
      },
      async generateTitle(remoteId: string, messages: readonly ThreadMessage[]): Promise<AssistantStream> {
        let existingTitle = "";
        try {
          const current = await api<ThreadOneOut>(`/api/threads/${encodeURIComponent(remoteId)}`);
          existingTitle = typeof current.thread.title === "string" ? current.thread.title.trim() : "";
        } catch {
          // ignore fetch errors and continue with local generation
        }

        const title = existingTitle || guessThreadTitle(messages);
        const shouldPersist = !existingTitle && title.trim() && title !== "新对话";
        if (shouldPersist) {
          await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
            method: "PATCH",
            json: { title }
          });
        }
        return createAssistantStream((controller) => {
          controller.appendText(title || "新对话");
          controller.close();
        });
      },
      unstable_Provider: ({ children }: PropsWithChildren) => (
        <AgentRuntimeAdapterProvider
          canUpload={runtimeOptions?.canUpload ?? false}
          onThreadIdentityChange={({ remoteId, localId }) => {
            const normalizedRemoteId = String(remoteId || "").trim();
            activeRemoteThreadIdRef.current = normalizedRemoteId;
            activeLocalThreadIdRef.current = String(localId || "").trim();
            setActiveThreadIdentity({
              remoteId: normalizedRemoteId || undefined,
              localId: String(localId || "").trim() || undefined
            });
            if (!normalizedRemoteId) {
              setContextUsage(null);
              return;
            }
            setContextUsage(usageByThreadRef.current[normalizedRemoteId] ?? null);
          }}
        >
          {children}
        </AgentRuntimeAdapterProvider>
      )
    }),
    [runtimeOptions?.canUpload]
  );

  const reasoningOptions = useMemo(() => reasoningOptionsForModel(appliedConfig.model), [appliedConfig.model]);
  const canUpload = runtimeOptions?.canUpload ?? false;
  const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
  const modeOptions = resolveModeOptions(runtimeOptions?.modes ?? [], runtimeMode);
  const selectedModeLabel = resolveModeLabel(runtimeOptions?.modes ?? [], runtimeMode);
  const selectedKnowledgeSetIdsNormalized = selectedKnowledgeSetIds;
  const activeRemoteThreadId = String(activeThreadIdentity.remoteId || "").trim();
  const activeThreadCollaboration =
    threadCollaboration && threadCollaboration.threadId === activeRemoteThreadId ? threadCollaboration : null;
  const sharedThreadReadonly = Boolean(
    activeThreadCollaboration && activeThreadCollaboration.access.canRead && !activeThreadCollaboration.access.canRun
  );
  const selectedModelLabel = MODEL_OPTIONS.find((item) => item.value === appliedConfig.model)?.label || appliedConfig.model;
  const selectedReasoningLabel =
    reasoningOptions.find((level) => level.value === appliedConfig.reasoningEffort)?.label || appliedConfig.reasoningEffort;
  const currentUserName = props.currentUser?.displayName || props.currentUser?.email || "当前用户";
  const runtimeSummaryText = `${appliedConfig.model} · ${appliedConfig.reasoningEffort} · ${selectedModeLabel} · 上下文 ${contextUsageView.usedPercent}%`;

  const chatAdapter = useMemo<ChatModelAdapter>(
    () => ({
      run: async function* (options) {
        const prompt = extractLatestPrompt(options.messages);
        if (!prompt) {
          throw new Error("未识别到用户输入文本");
        }

        const threadId = await resolveRunThreadId({
          unstableThreadId: String(options.unstable_threadId || "").trim(),
          getActiveRemoteThreadId: () => String(activeRemoteThreadIdRef.current || "").trim(),
          getActiveLocalThreadId: () => String(activeLocalThreadIdRef.current || "").trim(),
          listThreads: async () => {
            const out = await api<ThreadListOut>("/api/threads");
            return out.threads || [];
          },
          attempts: 8,
          waitMs: 80
        });
        if (!threadId) {
          throw new Error("无法识别当前线程 ID（线程可能仍在初始化，请稍后重试）");
        }
        activeRemoteThreadIdRef.current = threadId;
        const activeCollaboration =
          threadCollaborationRef.current && threadCollaborationRef.current.threadId === threadId
            ? threadCollaborationRef.current
            : null;
        const collaborationLoadingForThread =
          threadCollaborationLoadingRef.current &&
          String(activeThreadIdentityRef.current.remoteId || "").trim() === threadId &&
          !activeCollaboration;
        if (collaborationLoadingForThread) {
          throw new Error("当前线程协作权限加载中，请稍后再试。");
        }
        if (activeCollaboration && !activeCollaboration.access.canRun) {
          throw new Error("当前共享线程为只读模式，不能继续运行。");
        }

        const cfg = normalizeRuntimeConfig(appliedConfigRef.current);
        const knowledgeSetIds = normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current);
        const ensured = await api<ThreadSessionOut>(`/api/threads/${encodeURIComponent(threadId)}/session`, {
          method: "POST",
          json: {
            model: cfg.model,
            reasoning_effort: cfg.reasoningEffort,
            knowledge_set_ids: knowledgeSetIds,
            codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current)
          }
        });
        const session = ensured.session;

        setErrorText("");
        setStatusText("生成中...");
        updateRunningStage("请求已提交，等待模型响应");

        let hasTextUpdate = false;
        let doneAnswer = "";
        const orderedParts: any[] = [];
        let activeTextPart: { type: "text"; text: string } | null = null;
        let traceBatchSeq = 0;
        let seq = 0;

        const processEnabled = showProcessTraceRef.current;
        const collapseFinalTraceOnDoneEnabled = collapseFinalTraceOnDoneRef.current;

        const appendTextPart = (chunk: string): boolean => {
          if (!chunk) return false;
          if (!activeTextPart) {
            activeTextPart = { type: "text", text: "" };
            orderedParts.push(activeTextPart);
          }
          activeTextPart.text += chunk;
          hasTextUpdate = true;
          return true;
        };

        const appendTraceBatch = (parts: any[]): boolean => {
          if (parts.length === 0) return false;
          const rows = extractTimelineRows(parts);
          if (rows.length === 0) return false;
          activeTextPart = null;
          for (const part of orderedParts) {
            const item = part as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_trace_batch") continue;
            const payload = asRecord(item.data);
            if (!payload) continue;
            payload.open = false;
          }
          traceBatchSeq += 1;
          const activeRowId = rows[rows.length - 1]?.id || "";
          orderedParts.push({
            type: "data",
            name: "codex_trace_batch",
            data: {
              batch_id: traceBatchSeq,
              open: true,
              active_row_id: activeRowId,
              rows
            }
          });
          return true;
        };

        const collapseLatestTraceBatch = (): boolean => {
          for (let i = orderedParts.length - 1; i >= 0; i -= 1) {
            const item = orderedParts[i] as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_trace_batch") continue;
            const payload = asRecord(item.data);
            if (!payload) continue;
            payload.open = false;
            payload.active_row_id = "";
            return true;
          }
          return false;
        };

        const snapshotContent = (): any[] => {
          return orderedParts.map((part) => ({ ...part }));
        };

        try {
          for await (const { event, data } of iterateSSE(`${apiBase()}/api/chat/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders()
            },
            body: JSON.stringify({
              session_id: session.session_id,
              thread_id: threadId,
              message: prompt
            }),
            signal: options.abortSignal
          })) {
            const updates: any[] = [];
            let textChanged = false;
            const payload = asRecord(data);

            if (event === "error") {
              const detail =
                (payload && typeof payload.detail === "string" ? payload.detail : "") || "请求失败";
              setErrorText(detail);
              updateRunningStage("执行失败");
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "error",
                    at: new Date().toISOString(),
                    title: "执行失败",
                    detail: shorten(detail, 1400)
                  } satisfies ProcessData
                });
              }
              const traceChanged = appendTraceBatch(updates);
              if (traceChanged || textChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              throw new Error(detail);
            }

            if (event === "done") {
              doneAnswer =
                payload && typeof payload.answer === "string" ? payload.answer : "";
              updateRunningStage("回复生成完成");
              if (!hasTextUpdate && doneAnswer.trim()) {
                textChanged = appendTextPart(doneAnswer);
              }
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "done",
                    at: new Date().toISOString(),
                    title: "回答完成"
                  } satisfies ProcessData
                });
              }
              const traceChanged = appendTraceBatch(updates);
              if (traceChanged && collapseFinalTraceOnDoneEnabled) {
                collapseLatestTraceBatch();
              }
              if (traceChanged || textChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event === "meta") {
              updateRunningStage("会话已建立，开始执行");
              if (processEnabled) {
                const model = payload && typeof payload.model === "string" ? payload.model : "";
                const reasoning =
                  payload && typeof payload.reasoning_effort === "string" ? payload.reasoning_effort : "";
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "meta",
                    at: new Date().toISOString(),
                    title: "会话已开始",
                    detail: [model, reasoning].filter(Boolean).join(" / ")
                  } satisfies ProcessData
                });
              }
              const traceChanged = appendTraceBatch(updates);
              if (traceChanged || textChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event !== "codex") continue;

            const eventType = typeof payload?.type === "string" ? payload.type : "unknown";
            const delta = typeof payload?.delta === "string" ? payload.delta : "";
            const text = typeof payload?.text === "string" ? payload.text : "";
            const append = delta || text;
            const raw = asRecord(payload?.raw);
            const item = asRecord(raw?.item);
            const itemType = typeof item?.type === "string" ? item.type : "";

            if (eventType === "turn.completed") {
              const usage = parseTurnUsage(raw?.usage ?? payload?.usage);
              if (usage) {
                const usageModel = String(session.model || cfg.model || "").trim();
                const snapshot: ContextUsageSnapshot = {
                  threadId,
                  model: usageModel || "unknown",
                  contextLimit: contextLimitForModel(usageModel),
                  inputTokens: usage.inputTokens,
                  cachedInputTokens: usage.cachedInputTokens,
                  outputTokens: usage.outputTokens,
                  updatedAt: new Date().toISOString()
                };
                usageByThreadRef.current[threadId] = snapshot;
                setContextUsage(snapshot);
              }
            }

            const shouldAppendAgentText =
              !!append &&
              eventType.startsWith("item.") &&
              itemType === "agent_message";

            if (shouldAppendAgentText) {
              textChanged = appendTextPart(append) || textChanged;
            }

            const isStarted = eventType === "item.started";
            const isCompleted = eventType === "item.completed";
            if (itemType && (isStarted || isCompleted)) {
              updateRunningStage(stageTextForCodexItem(itemType, isStarted ? "started" : "completed", item));
            }

            if (itemType === "reasoning" && isCompleted && processEnabled) {
              const reasoningText =
                (typeof item?.text === "string" ? item.text : "") ||
                (typeof payload?.text === "string" ? payload.text : "");
              if (reasoningText.trim()) {
                updates.push({
                  type: "reasoning",
                  text: shorten(reasoningText, 1800)
                });
              }
            }

            if (itemType === "command_execution" && isCompleted && processEnabled) {
              const command = typeof item?.command === "string" ? item.command : "";
              const output = typeof item?.aggregated_output === "string" ? item.aggregated_output : "";
              const exitCode = typeof item?.exit_code === "number" ? item.exit_code : undefined;
              const status = typeof item?.status === "string" ? item.status : undefined;
              const args = { command, status };
              const result = {
                output: shorten(output, 1800),
                ...(exitCode !== undefined ? { exit_code: exitCode } : {})
              };
              updates.push({
                type: "tool-call",
                toolCallId: String(item?.id || `command-${Date.now()}-${++seq}`),
                toolName: "command_execution",
                args,
                argsText: JSON.stringify(args),
                result
              });
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: `命令执行 ${formatProcessStatus(status)}`.trim(),
                  detail: [command ? `$ ${command}` : "", exitCode !== undefined ? `exit_code=${exitCode}` : ""]
                    .filter(Boolean)
                    .join("\n"),
                  event: eventType,
                  item_type: itemType,
                  status
                } satisfies ProcessData
              });
            }

            if (itemType === "mcp_tool_call" && isCompleted && processEnabled) {
              const server = typeof item?.server === "string" ? item.server : "";
              const tool = typeof item?.tool === "string" ? item.tool : "";
              const args = (item?.arguments && typeof item.arguments === "object" ? item.arguments : {}) as Record<
                string,
                unknown
              >;
              const error = asRecord(item?.error);
              const errMsg = typeof error?.message === "string" ? error.message : "";
              const result = item?.result;
              const toolName = [server, tool].filter(Boolean).join(".") || "mcp_tool_call";

              updates.push({
                type: "tool-call",
                toolCallId: String(item?.id || `mcp-${Date.now()}-${++seq}`),
                toolName,
                args,
                argsText: JSON.stringify(args),
                ...(result !== undefined ? { result } : {}),
                ...(errMsg ? { isError: true } : {})
              });
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: errMsg ? "error" : "process",
                  at: new Date().toISOString(),
                  title: `工具调用 ${errMsg ? "失败" : "已完成"}`,
                  detail: [
                    server ? `server: ${server}` : "",
                    tool ? `tool: ${tool}` : "",
                    errMsg ? `error: ${shorten(errMsg, 400)}` : ""
                  ]
                    .filter(Boolean)
                    .join("\n"),
                  event: eventType,
                  item_type: itemType
                } satisfies ProcessData
              });
            }

            if (itemType === "web_search" && isCompleted) {
              const query = typeof item?.query === "string" ? item.query : "";
              if (processEnabled) {
                updates.push({
                  type: "tool-call",
                  toolCallId: String(item?.id || `web-${Date.now()}-${++seq}`),
                  toolName: "web_search",
                  args: { query },
                  argsText: JSON.stringify({ query })
                });
              }
              const sources = extractSources(item?.result ?? item?.results ?? raw ?? payload);
              for (const source of sources) {
                updates.push({
                  type: "source",
                  sourceType: "url",
                  id: source.id,
                  url: source.url,
                  title: source.title
                });
              }
              if (processEnabled && query) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "process",
                    at: new Date().toISOString(),
                    title: "Web 检索",
                    detail: query,
                    event: eventType,
                    item_type: itemType
                  } satisfies ProcessData
                });
              }
            }

            if (itemType === "todo_list" && processEnabled) {
              const items = Array.isArray(item?.items) ? item.items : [];
              const lines = items
                .slice(0, 20)
                .map((it) => {
                  const obj = asRecord(it);
                  if (!obj) return "";
                  const text = typeof obj.text === "string" ? obj.text : "";
                  const completed = Boolean(obj.completed);
                  return `${completed ? "[x]" : "[ ]"} ${text}`;
                })
                .filter(Boolean)
                .join("\n");
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: "执行计划（Todo）",
                  detail: lines,
                  event: eventType,
                  item_type: itemType
                } satisfies ProcessData
              });
            }

            if (itemType === "file_change" && isCompleted && processEnabled) {
              const changes = Array.isArray(item?.changes) ? item.changes : [];
              const lines = changes
                .slice(0, 30)
                .map((it) => {
                  const obj = asRecord(it);
                  if (!obj) return "";
                  const path = typeof obj.path === "string" ? obj.path : "";
                  const kind = typeof obj.kind === "string" ? obj.kind : "update";
                  return `${kind}: ${path}`;
                })
                .filter(Boolean)
                .join("\n");
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: "文件变更",
                  detail: lines,
                  event: eventType,
                  item_type: itemType
                } satisfies ProcessData
              });
            }

            if (itemType === "error" && processEnabled) {
              const message = typeof item?.message === "string" ? item.message : "";
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "error",
                  at: new Date().toISOString(),
                  title: "执行错误",
                  detail: shorten(message, 1200),
                  event: eventType,
                  item_type: itemType
                } satisfies ProcessData
              });
            }

            if (
              processEnabled &&
              !shouldAppendAgentText &&
              itemType &&
              (isStarted || isCompleted) &&
              !["command_execution", "mcp_tool_call", "web_search", "todo_list", "file_change", "reasoning", "error"].includes(
                itemType
              )
            ) {
              const status = typeof item?.status === "string" ? item.status : undefined;
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: `过程事件 ${eventType}`,
                  detail: shorten(detailFromUnknown(item), 800),
                  event: eventType,
                  item_type: itemType,
                  status
                } satisfies ProcessData
              });
            }

            const traceChanged = appendTraceBatch(updates);
            if (traceChanged || textChanged) {
              const content = snapshotContent();
              if (content.length > 0) {
                yield {
                  content
                };
              }
            }
          }

          if (!hasTextUpdate && doneAnswer) {
            appendTextPart(doneAnswer);
            yield {
              content: snapshotContent()
            };
          }
        } finally {
          setStatusText("就绪");
          updateRunningStage(DEFAULT_RUNNING_STAGE_TEXT);
        }
      }
    }),
    []
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: function RuntimeHook() {
      return useLocalRuntime(chatAdapter);
    }
  });
  const threadContent = (
    <div
      className={sharedThreadReadonly ? "thread-dropzone thread-dropzone-readonly" : "thread-dropzone"}
      aria-disabled={sharedThreadReadonly}
    >
      {sharedThreadReadonly ? (
        <div className="thread-readonly-banner" role="status">
          <strong>共享只读线程</strong>
          <span>共享视图中可查看消息和附件，但不能继续运行该线程。</span>
        </div>
      ) : null}
      <Thread
        strings={{
          threadList: {
            new: { label: "新会话" },
            item: {
              title: { fallback: "新对话" }
            }
          },
          composer: {
            input: {
              placeholder: canUpload ? "直接输入问题，支持上传任意附件；可拖拽到对话窗口" : "直接输入问题"
            },
            send: { tooltip: "发送消息" },
            cancel: { tooltip: "停止生成" }
          }
        }}
        welcome={{
          message: "你好，我是 Agent Studio。请直接提问。",
          suggestions: PORTAL_STARTER_SUGGESTIONS
        }}
        components={{
          AssistantMessage: AgentAssistantMessage
        }}
        assistantMessage={{
          allowCopy: true,
          allowReload: true,
          allowFeedbackPositive: true,
          allowFeedbackNegative: true,
          components: {
            ToolFallback: HiddenToolFallback as any
          }
        }}
        userMessage={{ allowEdit: true }}
      />
      {sharedThreadReadonly ? (
        <div className="thread-readonly-shield" aria-hidden="true">
          <div className="thread-readonly-card">
            <p>共享线程已切换为只读模式。</p>
            <p>你仍可浏览消息、附件与右侧协作面板中的评论区。</p>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerActivationGuard />
      <RunningStageTextContext.Provider value={runningStageText}>
        <ConfigProvider theme={PORTAL_ANTD_THEME}>
          <div className="portal-workbench-root">
            <PortalTopBar
              sessionRailCollapsed={layoutState.isSessionRailCollapsed}
              onToggleRail={() => setLayoutState((prev) => toggleSessionRail(prev))}
              onOpenAdvancedSettings={() =>
                setLayoutState((prev) => ({
                  ...prev,
                  isAdvancedSettingsOpen: true
                }))
              }
              onOpenDrawer={() => setLayoutState((prev) => openWorkbenchDrawer(prev, "writing"))}
              runtimeSummary={runtimeSummaryText}
              drawerOpen={layoutState.isRightDrawerOpen}
              activeDrawerTab={layoutState.activeRightDrawerTab}
            />

            <div className="portal-workbench-body">
              <ThreadList.Root>
                <SessionRail
                  collapsed={layoutState.isSessionRailCollapsed}
                  userName={currentUserName}
                  searchValue={sessionSearchValue}
                  onSearchChange={setSessionSearchValue}
                  onCreateThread={() => undefined}
                  onToggleCollapsed={() => setLayoutState((prev) => toggleSessionRail(prev))}
                  newThreadSlot={<ThreadList.New aria-label="新会话" className="session-rail-new-btn" />}
                  footer={
                    <div className="session-rail-footer-stack">
                      {props.currentUser ? (
                        <UserIdentitySummary user={props.currentUser} compact onSignOut={props.onSignOut} />
                      ) : (
                        <p className="session-rail-user-fallback">{currentUserName}</p>
                      )}
                      {props.onOpenAdmin ? (
                        <button type="button" className="picker-btn shell-switch-btn" onClick={props.onOpenAdmin}>
                          进入管理台
                        </button>
                      ) : null}
                    </div>
                  }
                >
                  <SessionSearchContext.Provider value={sessionSearchValue}>
                    <ThreadList.Items
                      components={{
                        ThreadListItem: AgentThreadListItem as any
                      }}
                    />
                  </SessionSearchContext.Provider>
                </SessionRail>
              </ThreadList.Root>

              <main className="portal-workbench-chat">
                <div className="thread-wrap">
                  {canUpload && !sharedThreadReadonly ? (
                    <ComposerPrimitive.AttachmentDropzone asChild>{threadContent}</ComposerPrimitive.AttachmentDropzone>
                  ) : (
                    threadContent
                  )}
                </div>
              </main>
            </div>

            <RightWorkbenchDrawer
              open={layoutState.isRightDrawerOpen}
              activeTab={layoutState.activeRightDrawerTab}
              onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
              onTabChange={(tab) => setLayoutState((prev) => switchWorkbenchTab(prev, tab))}
              writingContent={
                <WritingWorkbenchPanel
                  onUsePrompt={(prompt) => {
                    const preview = prompt.length > 28 ? `${prompt.slice(0, 28)}...` : prompt;
                    setStatusText(`写作提示词已就绪：${preview}`);
                    setLayoutState((prev) => closeWorkbenchDrawer(prev));
                  }}
                />
              }
              collaborationContent={
                <div className="workbench-collaboration-content">
                  <section className="workbench-priority-card">
                    <h3>优先项 B：评论与 @ 提及</h3>
                    <p>先同步上下文和分歧，评论会实时留痕，便于后续追踪。</p>
                  </section>
                  <section className="workbench-priority-card">
                    <h3>优先项 D：负责人和跟进</h3>
                    <p>锁定 owner 与 followers，确保每个动作都能有人接住。</p>
                  </section>
                  <ThreadCollaborationPanel
                    threadId={String(activeThreadIdentity.remoteId || "").trim()}
                    collaboration={activeThreadCollaboration}
                    loading={threadCollaborationLoading}
                    errorText={threadCollaborationErrorText}
                    onCollaborationChange={(next) => {
                      const currentRemoteThreadId = String(activeThreadIdentityRef.current.remoteId || "").trim();
                      if (!currentRemoteThreadId || next.threadId !== currentRemoteThreadId) return;
                      setThreadCollaboration(next);
                    }}
                  />
                </div>
              }
            />

            <AdvancedSettingsPanel
              open={layoutState.isAdvancedSettingsOpen}
              onClose={() =>
                setLayoutState((prev) => ({
                  ...prev,
                  isAdvancedSettingsOpen: false
                }))
              }
              modelLabel={selectedModelLabel}
              reasoningLabel={selectedReasoningLabel}
            >
              <div className="advanced-settings-content">
                <div className="knowledge-set-shell">
                  {portalResources ? (
                    <KnowledgeSetPicker
                      knowledgeSets={portalResources.knowledgeSets ?? []}
                      selectedIds={selectedKnowledgeSetIdsNormalized}
                      onChange={setSelectedKnowledgeSetIds}
                    />
                  ) : (
                    <p className="field-help knowledge-set-loading">知识集资源加载中...</p>
                  )}
                  {resourceErrorText ? <p className="err-text knowledge-set-error">{resourceErrorText}</p> : null}
                </div>

                <label className="field checkbox-field">
                  <span className="field-label">显示过程轨迹</span>
                  <input
                    type="checkbox"
                    checked={showProcessTrace}
                    onChange={(e) => setShowProcessTrace(e.target.checked)}
                  />
                  <span className="field-help">在消息中显示思考摘要、工具调用与执行步骤。</span>
                </label>

                <label className="field checkbox-field">
                  <span className="field-label">完成后折叠最终步骤</span>
                  <input
                    type="checkbox"
                    checked={collapseFinalTraceOnDone}
                    onChange={(e) => setCollapseFinalTraceOnDone(e.target.checked)}
                    disabled={!showProcessTrace}
                  />
                  <span className="field-help">启用后，仅保留最终结论文本展开；完成轨迹默认收起。</span>
                </label>

                <label className="field">
                  <span className="field-label">策略模式</span>
                  <select
                    className="field-input"
                    value={runtimeMode}
                    onChange={(e) => setRuntimeMode(e.target.value)}
                    disabled={!runtimeOptions}
                  >
                    {modeOptions.map((mode) => (
                      <option key={mode.id} value={mode.id}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  <span className="field-help">由 `/api/portal/runtime-options` 提供，员工仅能选择允许的策略。</span>
                </label>

                {selectedMode ? (
                  <div className="field">
                    <span className="field-label">策略快照</span>
                    <RuntimeProfileView profile={selectedMode.runtimeProfile} />
                    <span className="field-help">以下运行参数由当前策略模式绑定的 run profile 决定。</span>
                  </div>
                ) : null}

                <div className="status-box">
                  <p>
                    <strong>状态：</strong>
                    {statusText}
                  </p>
                  <p>
                    <strong>附件策略：</strong>
                    {runtimeOptions?.canUpload ? "允许上传" : "当前禁止上传"}
                  </p>
                  <p className="field-help">运行配置修改后将自动在下一轮对话生效。</p>
                  {errorText ? <p className="err-text">{errorText}</p> : null}
                </div>

                <ZendeskIntegrationPanel />
              </div>
            </AdvancedSettingsPanel>
          </div>
        </ConfigProvider>
        {pickerOpen ? (
          <div className="dir-modal-mask" onClick={() => setPickerOpen(false)}>
            <div className="dir-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dir-modal-head">
              <h3>{pickerTarget === "workspace" ? "选择工作目录" : "选择附加目录"}</h3>
              <button type="button" className="picker-btn" onClick={() => setPickerOpen(false)}>
                关闭
              </button>
            </div>
            <div className="dir-path-input-row">
              <input
                className="field-input dir-path-input"
                value={pickerPathInput}
                onChange={(e) => onPickerPathInputChange(e.target.value)}
                onKeyDown={onPickerPathInputKeyDown}
                placeholder="输入目录路径，实时跳转并加载子目录"
              />
              <button
                type="button"
                className="picker-btn"
                onClick={jumpToDirectoryFromInput}
                disabled={pickerLoading}
              >
                跳转
              </button>
            </div>
            <p className="dir-modal-current">当前目录：{pickerCwd || "..."}</p>
            <div className="dir-modal-toolbar">
              <button
                type="button"
                className="picker-btn"
                onClick={() => {
                  cancelPickerAutoJump();
                  void loadDirectoryTree(pickerParent || undefined, { syncInput: true });
                }}
                disabled={!pickerParent || pickerLoading}
              >
                上一级
              </button>
              <button
                type="button"
                className="picker-btn"
                onClick={() => selectDirectory(pickerCwd)}
                disabled={!pickerCwd || pickerLoading}
              >
                {pickerTarget === "workspace" ? "设为工作目录" : "添加当前目录"}
              </button>
            </div>
            <div className="dir-root-list">
              {pickerRoots.map((root) => (
                <button
                  key={root}
                  type="button"
                  className="dir-root-btn"
                  onClick={() => {
                    cancelPickerAutoJump();
                    void loadDirectoryTree(root, { syncInput: true });
                  }}
                  title={root}
                >
                  {root}
                </button>
              ))}
            </div>
            {pickerError ? <p className="err-text">{pickerError}</p> : null}
            <div className="dir-modal-list">
              {pickerLoading ? <p className="trace-empty">目录加载中...</p> : null}
              {!pickerLoading && pickerDirectories.length === 0 ? (
                <p className="trace-empty">当前目录没有可进入的子目录。</p>
              ) : null}
              {!pickerLoading && pickerDirectories.length > 0 ? (
                <ul className="dir-list">
                  {pickerDirectories.map((item) => (
                    <li key={item.path} className="dir-item">
                      <button
                        type="button"
                        className="dir-enter-btn"
                        onClick={() => {
                          cancelPickerAutoJump();
                          void loadDirectoryTree(item.path, { syncInput: true });
                        }}
                        title={item.path}
                      >
                        {item.name}
                      </button>
                      <button
                        type="button"
                        className="picker-btn"
                        onClick={() => selectDirectory(item.path)}
                      >
                        选择
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            </div>
          </div>
        ) : null}
      </RunningStageTextContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export default PortalShell;
