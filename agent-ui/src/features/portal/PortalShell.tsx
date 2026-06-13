import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useContext,
  type FC,
  type MutableRefObject,
  type ReactNode,
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type FormEvent as ReactFormEvent,
  type PropsWithChildren
} from "react";
import { createPortal } from "react-dom";
import {
  AttachmentPrimitive,
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  RuntimeAdapterProvider,
  ThreadPrimitive,
  ThreadListPrimitive,
  ThreadListItemPrimitive,
  useAui,
  useAttachment,
  useMessagePartText,
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
  Composer,
  Thread,
  UserMessage,
  ThreadWelcome,
  ThreadList,
  makeMarkdownText
} from "@assistant-ui/react-ui";
import {
  AlertCircleIcon,
  CheckIcon,
  FileIcon,
  ImageIcon,
  Loader2Icon,
  PencilIcon,
  PlusIcon,
  RefreshCwIcon,
  SendHorizontalIcon,
  Share2Icon,
  SquareIcon,
  ThumbsDownIcon,
  Trash2Icon,
  XIcon,
  DownloadIcon,
  MoreHorizontalIcon,
  PackageIcon,
  ClipboardListIcon,
  BotIcon,
  ZapIcon,
  CreditCardIcon
} from "lucide-react";
import { createAssistantStream, type AssistantStream } from "assistant-stream";
import {
  type Attachment,
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
import { AuiProvider, Derived, useAuiState } from "@assistant-ui/store";
import { Button, ConfigProvider, Dropdown, Input, Modal, Drawer } from "antd";
import type { MenuProps } from "antd";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

import { ApiError, api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
import { reportAutoRefreshActivityState } from "../../lib/build-version-refresh";
import {
  DEFAULT_MODEL,
  contextLimitForModel,
  normalizeReasoningEffortForModel,
  type ReasoningEffort
} from "../../lib/model-config";
import { iterateSSE } from "../../lib/sse";
import { resolveRunThreadId } from "../../lib/thread-id-resolver";
import { RuntimeProfileView } from "../modes/runtime-profile-view";
import type { PortalRuntimeOptions } from "../modes/types";
import { fetchThreadCollaboration } from "../collaboration/api";
import type { ThreadCollaborationView } from "../collaboration/types";
import { fetchPortalResources } from "../resources/api";
import { KnowledgeSetPicker } from "../resources/KnowledgeSetPicker";
import type { PortalResourcesResponse } from "../resources/types";
import { resolveModeLabel, resolveModeOptions } from "./runtime-labels";
import type { AuthUser } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { UserIdentitySummary } from "../auth/UserIdentitySummary";
import { createThreadPublicShare, resolveThreadPublicShareUrl } from "../public-share/api";
import { groupThreadMessagesIntoPublicShareTurns } from "../public-share/turns";
import {
  MARKDOWN_COMPONENTS_BY_LANGUAGE,
  MARKDOWN_REHYPE_PLUGINS,
  MARKDOWN_REMARK_PLUGINS,
  MarkdownTable
} from "../markdown/markdown-rendering";
import { PortalTopBar } from "./workbench/PortalTopBar";
import { PortalBillingPanel } from "./PortalBillingPanel";
import { fetchPortalSubscriptionStatus, type PortalSubscriptionStatus } from "./api";
import {
  createPortalSkillDraftNewVersion,
  fetchPortalManagedSkills,
  fetchPortalSkillDraft,
  installPortalSkillFromThreadPath,
  revisePortalSkillDraft,
  uninstallPortalManagedSkill
} from "../skills/api";
import type { CodexManagedSkill, CodexSkillDraft } from "../skills/types";
import { getBrandInitials } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import { SessionRail } from "./workbench/SessionRail";
import { RightWorkbenchDrawer } from "./workbench/RightWorkbenchDrawer";
import { PreviewWorkbenchPanel } from "./workbench/PreviewWorkbenchPanel";
import { AdvancedSettingsPanel } from "./workbench/AdvancedSettingsPanel";
import {
  closeWorkbenchDrawer,
  createInitialLayoutState,
  openWorkbenchDrawer,
  switchWorkbenchTab,
  toggleSessionRail
} from "./workbench/layout-state";
import { PORTAL_ANTD_THEME } from "./workbench/theme";
import { isNarrowScreen, useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
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
  enabled_skills?: Array<{
    id: string;
    name: string;
    managed_skill_id?: string | null;
  }>;
  enabled_skill_names?: string[];
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
    created_at?: string;
    updated_at?: string;
  }>;
  feedback?: ThreadFeedbackOut[];
};

type ThreadFeedbackOut = {
  id: string;
  type: "positive" | "negative";
  message_id: string | null;
  content_preview: string | null;
  comment: string | null;
  user_id: string | null;
  created_at: string;
  updated_at: string | null;
};

type ProductFeedbackType = "bug" | "feature_request" | "usability_issue" | "other";
type ProductFeedbackSeverity = "blocking" | "high" | "medium" | "low";
type ProductFeedbackImageDraft = {
  id: string;
  file: File;
  previewUrl: string;
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

type RuntimeSkillOption = PortalRuntimeOptions["modes"][number]["availableSkills"][number];

type ProcessData = {
  kind: "debug" | "meta" | "process" | "done" | "error";
  at: string;
  title: string;
  detail?: string;
  rawDetail?: string;
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
  rawDetail?: string;
  at?: string;
};

type TraceBatchPartData = {
  batch_id: number;
  open?: boolean;
  active_row_id?: string;
  rows: TimelineRow[];
};

type TraceBatchPart = {
  type: "data";
  name: "codex_trace_batch";
  data: TraceBatchPartData;
};

type CommentaryEntryData = {
  id: string;
  text: string;
  lines: string[];
  last_event_at?: number;
  status: "streaming" | "completed";
};

type CommentaryPartData = {
  id: string;
  text: string;
  lines: string[];
  entries?: CommentaryEntryData[];
  open?: boolean;
  last_event_at?: number;
  status: "streaming" | "completed";
};

type SkillDraftStatusPartData = {
  draftId: string;
  status?: string;
  skillName?: string;
};

type SessionGroupLabelContextValue = {
  groupHeaderByRemoteId: Record<string, string>;
};

type RunningThreadIdsContextValue = Record<string, boolean>;

type ThreadCompletionNoticeContextValue = {
  completedThreadIds: RunningThreadIdsContextValue;
  clearCompletedThreadNotice: (...threadIds: Array<string | undefined | null>) => void;
};

const DEFAULT_WORKSPACE = ".";

function resolveShowProcessTracePreference(user?: AuthUser | null): boolean {
  return user?.portalPreferences?.showProcessTrace ?? false;
}

function resolveCollapseFinalTraceOnDonePreference(user?: AuthUser | null): boolean {
  return user?.portalPreferences?.collapseFinalTraceOnDone ?? true;
}

const SANDBOX_OPTIONS: Array<{ value: SandboxMode; label: string }> = [
  { value: "workspace-write", label: "workspace-write (Recommended: read/write workspace)" },
  { value: "read-only", label: "read-only (Read-only)" },
  { value: "danger-full-access", label: "danger-full-access (Full access)" }
];

const APPROVAL_OPTIONS: Array<{ value: ApprovalPolicy; label: string }> = [
  { value: "never", label: "never (No approval)" },
  { value: "on-request", label: "on-request (Ask when needed)" },
  { value: "on-failure", label: "on-failure (Ask on failure)" },
  { value: "untrusted", label: "untrusted (Approval for untrusted actions)" }
];

const WEB_SEARCH_OPTIONS: Array<{ value: WebSearchMode; label: string }> = [
  { value: "disabled", label: "disabled (Off)" },
  { value: "cached", label: "cached (Cached search)" },
  { value: "live", label: "live (Live search)" }
];
const PRODUCT_FEEDBACK_TYPE_OPTIONS: Array<{ value: ProductFeedbackType; label: string }> = [
  { value: "usability_issue", label: "Improvement suggestion" },
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature request" },
  { value: "other", label: "Other" }
];
const PRODUCT_FEEDBACK_SEVERITY_OPTIONS: Array<{ value: ProductFeedbackSeverity; label: string }> = [
  { value: "blocking", label: "Blocking" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];
const PRODUCT_FEEDBACK_MAX_IMAGES = 3;
const PRODUCT_FEEDBACK_MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const PRODUCT_FEEDBACK_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const RUNNING_STAGE_CONNECTING_TEXT = "Connecting to the assistant";
const RUNNING_STAGE_WORKING_TEXT = "Working on your request";
const RUNNING_STAGE_NO_VISIBLE_UPDATE_TEXT = "Still working. I'm thinking through the request and planning the next steps.";
const RUNNING_STAGE_CONNECTING_FALLBACK_MS = 1800;
const RUNNING_STAGE_VISIBLE_UPDATE_FALLBACK_MS = 8000;
const DEFAULT_RUNNING_STAGE_TEXT = RUNNING_STAGE_CONNECTING_TEXT;
const PORTAL_RUNNING_LEAVE_WARNING = "There are still running sessions. If you leave, you may lose visibility into their output.";
const RunningStageTextContext = createContext(DEFAULT_RUNNING_STAGE_TEXT);
const SessionSearchContext = createContext("");
const MobileWorkbenchContext = createContext(false);
const SkillComposerContext = createContext<{
  availableSkills: RuntimeSkillOption[];
  enabledSkillIds: string[];
  toggleSkill: (skillId: string) => void;
}>({
  availableSkills: [],
  enabledSkillIds: [],
  toggleSkill: () => undefined
});
const SkillDraftActionContext = createContext<{
  openNewSessionWithSkill: (input: { skillName: string; managedSkillId?: string }) => Promise<void> | void;
  refreshRuntimeOptions: () => Promise<PortalRuntimeOptions | null>;
  installSkillFromPath: (input: {
    threadId: string;
    path: string;
    prompt?: string;
  }) => Promise<CodexManagedSkill | null>;
  uninstallSkill: (input: { skillId: string }) => Promise<CodexManagedSkill | null>;
}>({
  openNewSessionWithSkill: async () => undefined,
  refreshRuntimeOptions: async () => null,
  installSkillFromPath: async () => null,
  uninstallSkill: async () => null
});
const SessionGroupLabelContext = createContext<SessionGroupLabelContextValue>({
  groupHeaderByRemoteId: {}
});
const RunningThreadIdsContext = createContext<RunningThreadIdsContextValue>({});
const ThreadCompletionNoticeContext = createContext<ThreadCompletionNoticeContextValue>({
  completedThreadIds: {},
  clearCompletedThreadNotice: () => undefined
});
const ActiveThreadIdContext = createContext("");
type AnswerFeedbackUiConfig = {
  enabled: boolean;
  prompt: string;
};
const AnswerFeedbackConfigContext = createContext<AnswerFeedbackUiConfig>({
  enabled: false,
  prompt: "Was this answer helpful?"
});
const PreviewRequestContext = createContext<(filePath: string) => void>(() => undefined);
const ExternalPortalUserContext = createContext(false);
const PortalSubscriptionAccessContext = createContext<{
  status: PortalSubscriptionStatus | null;
  loading: boolean;
  errorText: string;
}>({
  status: null,
  loading: false,
  errorText: ""
});
type FeedbackCommentDraftStore = {
  commentsByMessageId: Map<string, string>;
  skipNextSubmit?: {
    messageId: string;
    type: "positive" | "negative";
  };
};
const FeedbackCommentDraftContext = createContext<MutableRefObject<FeedbackCommentDraftStore> | null>(null);
const feedbackCommentMemory = new Map<string, string>();
const PORTAL_THREAD_SEARCH_PARAM = "thread";

function feedbackCommentKey(threadId: string, messageId: string): string {
  return `${threadId}::${messageId}`;
}
type ThreadPublicShareSelectionContextValue = {
  selectionMode: boolean;
  leadTurnIdByMessageId: Record<string, string>;
  selectedTurnIds: Set<string>;
  toggleTurnSelection: (turnId: string) => void;
};
const ThreadPublicShareSelectionContext = createContext<ThreadPublicShareSelectionContextValue>({
  selectionMode: false,
  leadTurnIdByMessageId: {},
  selectedTurnIds: new Set<string>(),
  toggleTurnSelection: () => undefined
});

type MessageEntryAnimationContextValue = {
  enteringMessageIds: Set<string>;
};

const MessageEntryAnimationContext = createContext<MessageEntryAnimationContextValue>({
  enteringMessageIds: new Set<string>()
});

async function copyTextToClipboard(value: string): Promise<void> {
  const text = value.trim();
  if (!text) {
    throw new Error("Nothing to copy");
  }
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "absolute";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  document.body.removeChild(textarea);
  if (!copied) {
    throw new Error("Your browser does not support automatic copy. Please copy the link manually.");
  }
}

function flattenNodeText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => flattenNodeText(item)).join("");
  }
  if (typeof value === "object") {
    const props = (value as { props?: { children?: unknown } }).props;
    if (props && "children" in props) {
      return flattenNodeText(props.children);
    }
  }
  return "";
}

const ASSISTANT_MARKDOWN_LINK_PATTERN = /(!?\[[^\]]*]\()([^)\n]+)(\))/g;
const RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN =
  /(!?\[[^\]\n]*\]\()(?!(?:<|https?:|data:|blob:))(\/usr\/local\/agent-studio\/data\/knowledge-sets\/Docs\/.*?\.(?:md|markdown|txt|json|pdf|html|htm|xml|ya?ml|png|jpe?g|gif|webp|bmp|svg|avif))(\))/giu;
const IMAGE_FILE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg", "avif"]);
const ASSISTANT_MARKDOWN_BASE_FILE_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "doc",
  "docx",
  "pdf",
  "html",
  "htm",
  "json",
  "yaml",
  "yml",
  "xml"
]);

function normalizeMarkdownAssetTarget(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  const unwrapped =
    trimmed.startsWith("<") && trimmed.endsWith(">") && trimmed.length > 1 ? trimmed.slice(1, -1).trim() : trimmed;
  return decodeMaybeUri(unwrapped);
}

function preprocessAssistantMarkdown(text: string): string {
  return text.replace(RAW_KNOWLEDGE_SET_MARKDOWN_DESTINATION_PATTERN, (_match, prefix, destination, suffix) => {
    return `${prefix}<${destination}>${suffix}`;
  });
}

function normalizeUrlPathParam(value: string | null): string {
  return value ? normalizePreviewFilePath(decodeMaybeUri(value)) : "";
}

function fileExtensionFromPreviewPath(filePath: string): string {
  const fileName = fileNameFromPreviewPath(filePath).trim().toLowerCase();
  const dotIndex = fileName.lastIndexOf(".");
  if (dotIndex < 0 || dotIndex === fileName.length - 1) return "";
  return fileName.slice(dotIndex + 1);
}

function isRelativeMarkdownAssetTarget(target: string): boolean {
  const normalized = normalizeMarkdownAssetTarget(target);
  if (!normalized) return false;
  if (normalized.startsWith("#")) return false;
  if (normalized.startsWith("/")) return false;
  if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(normalized)) return false;
  return true;
}

function resolvePreviewPathFromFileContentHref(href: string): string | null {
  const rawHref = href.trim();
  if (!rawHref) return null;

  try {
    const parsed = new URL(rawHref, window.location.href);
    if (parsed.origin !== window.location.origin) return null;
    if (parsed.pathname === "/api/portal/resources/files/content") {
      const resolved = normalizeUrlPathParam(parsed.searchParams.get("path"));
      return resolved ? `${resolved}${parsed.hash || ""}` : null;
    }
    if (/^\/api\/threads\/[^/]+\/files\/content$/.test(parsed.pathname)) {
      const absolutePath = normalizeUrlPathParam(parsed.searchParams.get("path"));
      return absolutePath ? `${absolutePath}${parsed.hash || ""}` : null;
    }
  } catch {
    return null;
  }

  return null;
}

function resolvePreviewPathFromMarkdownTarget(target: string): string | null {
  const normalized = normalizeMarkdownAssetTarget(target);
  if (!normalized) return null;
  if (normalized.startsWith("#")) return null;
  if (/^(mailto|tel|javascript|data|blob):/i.test(normalized)) return null;

  const fromFileContentHref = resolvePreviewPathFromFileContentHref(normalized);
  if (fromFileContentHref) return fromFileContentHref;

  if (isLikelyHttpUrl(normalized)) {
    try {
      const parsed = new URL(normalized, window.location.href);
      if (parsed.origin !== window.location.origin) return null;
      const pathname = normalizePreviewFilePath(decodeMaybeUri(parsed.pathname || ""));
      if (!pathname || pathname.startsWith("/api/")) return null;
      return `${pathname}${parsed.hash || ""}`;
    } catch {
      return null;
    }
  }

  if (normalized.startsWith("/")) {
    if (normalized.startsWith("/api/")) return null;
    return normalizePreviewFilePath(normalized);
  }

  return null;
}

function isLikelyBaseDocumentPreviewPath(previewPath: string): boolean {
  const extension = fileExtensionFromPreviewPath(splitPreviewPathAnchor(previewPath).filePath);
  if (!extension) return false;
  if (IMAGE_FILE_EXTENSIONS.has(extension)) return false;
  return ASSISTANT_MARKDOWN_BASE_FILE_EXTENSIONS.has(extension);
}

function dirnameFromPreviewPath(filePath: string): string {
  const normalized = splitPreviewPathAnchor(filePath).filePath;
  if (!normalized || normalized === "/") return "/";
  const segments = normalized.split("/").filter(Boolean);
  if (segments.length <= 1) return normalized.startsWith("/") ? "/" : "";
  return `${normalized.startsWith("/") ? "/" : ""}${segments.slice(0, -1).join("/")}`;
}

function resolveRelativePreviewPath(baseFilePath: string, relativeTarget: string): string | null {
  const normalizedTarget = normalizeMarkdownAssetTarget(relativeTarget);
  if (!normalizedTarget || !isRelativeMarkdownAssetTarget(normalizedTarget)) return null;

  const baseDir = dirnameFromPreviewPath(baseFilePath);
  if (!baseDir) return null;

  const baseSegments = normalizePreviewFilePath(baseDir).split("/").filter(Boolean);
  const relativeSegments = normalizedTarget
    .split(/[\\/]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const resolvedSegments = [...baseSegments];

  for (const segment of relativeSegments) {
    if (segment === ".") continue;
    if (segment === "..") {
      if (resolvedSegments.length === 0) return null;
      resolvedSegments.pop();
      continue;
    }
    resolvedSegments.push(segment);
  }

  return `${baseDir.startsWith("/") ? "/" : ""}${resolvedSegments.join("/")}`;
}

function buildAssistantContentFileUrl(previewPath: string, activeThreadId: string): string | null {
  const normalizedPreviewPath = splitPreviewPathAnchor(previewPath).filePath;
  if (!normalizedPreviewPath || normalizedPreviewPath.startsWith("/thread-")) return null;

  const query = new URLSearchParams({ path: normalizedPreviewPath });
  if (isKnowledgeSetPreviewPath(normalizedPreviewPath)) {
    return `${apiBase()}/api/portal/resources/files/content?${query.toString()}`;
  }
  if (!activeThreadId.trim()) return null;
  return `${apiBase()}/api/threads/${encodeURIComponent(activeThreadId.trim())}/files/content?${query.toString()}`;
}

function derivePreviewPathWithLabelAnchor(previewPath: string, label: string): string {
  const { filePath, anchor } = splitPreviewPathAnchor(previewPath);
  if (!filePath || anchor) return previewPath;
  const extension = fileExtensionFromPreviewPath(filePath);
  if (extension !== "md" && extension !== "markdown") return previewPath;

  const segments = label
    .split("/")
    .map((item) => item.trim())
    .filter(Boolean);
  const dashSegments = label
    .split(/\s+[–—-]\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
  const sectionLabel = segments.length >= 2 ? segments[segments.length - 1] || "" : dashSegments[dashSegments.length - 1] || "";
  if (!sectionLabel || sectionLabel === label.trim()) return previewPath;
  const sectionAnchor = slugifyPreviewAnchorText(sectionLabel);
  return sectionAnchor ? `${filePath}#${encodeURIComponent(sectionAnchor)}` : previewPath;
}

function resolveAssistantMarkdownImagePreviewPath(input: {
  src: string;
  messageText: string;
}): string | null {
  const normalizedSrc = normalizeMarkdownAssetTarget(input.src);
  if (!normalizedSrc) return null;

  const directPreviewPath = resolvePreviewPathFromMarkdownTarget(normalizedSrc);
  if (directPreviewPath) return directPreviewPath;
  if (!isRelativeMarkdownAssetTarget(normalizedSrc)) return null;

  let currentBaseDocumentPath: string | null = null;
  let sawMatchingImage = false;
  ASSISTANT_MARKDOWN_LINK_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = ASSISTANT_MARKDOWN_LINK_PATTERN.exec(input.messageText)) !== null) {
    const fullMatch = match[0] || "";
    const matchTarget = normalizeMarkdownAssetTarget(match[2] || "");
    const previewPath = resolvePreviewPathFromMarkdownTarget(matchTarget);

    if (previewPath && isLikelyBaseDocumentPreviewPath(previewPath)) {
      currentBaseDocumentPath = previewPath;
    }

    if (!fullMatch.startsWith("!")) continue;
    if (matchTarget !== normalizedSrc) continue;
    sawMatchingImage = true;

    if (previewPath) return previewPath;
    if (currentBaseDocumentPath) {
      return resolveRelativePreviewPath(currentBaseDocumentPath, matchTarget);
    }
  }

  if (!currentBaseDocumentPath || !sawMatchingImage) return null;
  return resolveRelativePreviewPath(currentBaseDocumentPath, normalizedSrc);
}

function AssistantMarkdownImage(props: {
  src?: string;
  alt?: string;
  className?: string;
  title?: string;
  [key: string]: unknown;
}) {
  const { src, alt, className, title, ...rest } = props;
  const activeThreadId = useContext(ActiveThreadIdContext);
  const messagePart = useMessagePartText();
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const previewPath = useMemo(() => {
    if (typeof src !== "string" || !src.trim()) return null;
    return resolveAssistantMarkdownImagePreviewPath({
      src,
      messageText: messagePart.text
    });
  }, [messagePart.text, src]);

  const resolvedSrc = useMemo(() => {
    const normalizedSrc = typeof src === "string" ? normalizeMarkdownAssetTarget(src) : "";
    if (!normalizedSrc) return "";
    if (/^(data|blob):/i.test(normalizedSrc) || isLikelyHttpUrl(normalizedSrc)) return normalizedSrc;
    if (!previewPath) return "";
    return buildAssistantContentFileUrl(previewPath, activeThreadId) ?? "";
  }, [activeThreadId, previewPath, src]);

  const caption = typeof alt === "string" ? alt.trim() : "";
  const imageTitle = typeof title === "string" ? title.trim() : "";
  const ariaLabel = caption || imageTitle || "Open image detail";

  useEffect(() => {
    if (!lightboxOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setLightboxOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [lightboxOpen]);

  if (!resolvedSrc) {
    return (
      <span className="assistant-inline-image-unresolved" title={typeof src === "string" ? src : undefined}>
        Image reference could not be resolved
      </span>
    );
  }

  const image = (
    <img
      {...rest}
      className={className ? `assistant-inline-image-element ${className}` : "assistant-inline-image-element"}
      src={resolvedSrc}
      alt={caption}
      title={imageTitle || undefined}
      loading="lazy"
    />
  );

  return (
    <span className="assistant-inline-image-card">
      <button
        type="button"
        className="assistant-inline-image-trigger"
        aria-label={ariaLabel}
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setLightboxOpen(true);
        }}
      >
        {image}
      </button>
      {caption ? <span className="assistant-inline-image-caption">{caption}</span> : null}
      {lightboxOpen && typeof document !== "undefined"
        ? createPortal(
            <div
              className="assistant-image-lightbox"
              role="dialog"
              aria-modal="true"
              aria-label={ariaLabel}
              onClick={() => setLightboxOpen(false)}
            >
              <button
                type="button"
                className="assistant-image-lightbox-close"
                aria-label="Close image detail"
                onClick={() => setLightboxOpen(false)}
              >
                ×
              </button>
              <figure className="assistant-image-lightbox-figure" onClick={(event) => event.stopPropagation()}>
                <img className="assistant-image-lightbox-image" src={resolvedSrc} alt={caption} />
                {caption || imageTitle ? (
                  <figcaption className="assistant-image-lightbox-caption">{caption || imageTitle}</figcaption>
                ) : null}
              </figure>
            </div>,
            document.body
          )
        : null}
    </span>
  );
}

function AssistantMarkdownLink(props: {
  href?: string;
  className?: string;
  children?: ReactNode;
  [key: string]: unknown;
}) {
  const { href, className, children, ...rest } = props;
  const requestPreview = useContext(PreviewRequestContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const previewPath = typeof href === "string" ? resolveThreadPreviewPathFromHref(href, activeThreadId) : null;
  if (!previewPath) {
    return (
      <a className={className} href={href} {...rest}>
        {children}
      </a>
    );
  }
  const linkLabel = flattenNodeText(children).trim();
  const previewPathForRequest = derivePreviewPathWithLabelAnchor(previewPath, linkLabel);
  const displayName =
    linkLabel && linkLabel !== href && !isLikelyHttpUrl(linkLabel) ? linkLabel : fileNameFromPreviewPath(previewPath);
  return (
    <span className="assistant-inline-file-link-card" role="group" aria-label={`File ${displayName}`}>
      <span className="assistant-inline-file-link-meta">
        <span className="assistant-inline-file-link-tag">File</span>
        <span className="assistant-inline-file-link-name">{displayName}</span>
      </span>
      <button
        type="button"
        className="assistant-inline-file-link-btn"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          requestPreview(previewPathForRequest);
        }}
      >
        Preview
      </button>
    </span>
  );
}

const AssistantMarkdownText = makeMarkdownText({
  preprocess: preprocessAssistantMarkdown,
  rehypePlugins: MARKDOWN_REHYPE_PLUGINS,
  remarkPlugins: MARKDOWN_REMARK_PLUGINS,
  componentsByLanguage: MARKDOWN_COMPONENTS_BY_LANGUAGE,
  components: {
    table: MarkdownTable as any,
    a: AssistantMarkdownLink as any,
    img: AssistantMarkdownImage as any
  }
});

const DraftOnlyWelcomeSuggestions: FC = () => {
  const { behavior } = useBranding();

  if (behavior.portalWelcomeSuggestions.length === 0) {
    return null;
  }

  const icons = [PackageIcon, ClipboardListIcon, BotIcon, ZapIcon];
  const classes = ["icon-green", "icon-blue", "icon-orange", "icon-purple"];

  return (
    <div className="bailey-suggestion-grid">
      {behavior.portalWelcomeSuggestions.map((suggestion, index) => {
        const Icon = icons[index % icons.length];
        const iconClass = classes[index % classes.length];
        return (
          <ThreadPrimitive.Suggestion
            key={`${suggestion.label}-${index}`}
            className="bailey-suggestion-card"
            prompt={suggestion.prompt}
            send={false}
            clearComposer
          >
            <div className={`bailey-suggestion-icon-wrap ${iconClass}`}>
              <Icon size={20} strokeWidth={2.5} />
            </div>
            <span className="bailey-suggestion-text">{suggestion.label}</span>
          </ThreadPrimitive.Suggestion>
        );
      })}
    </div>
  );
};

const DraftOnlyThreadWelcome: FC = () => {
  const { branding, behavior } = useBranding();
  const portalWelcomeIllustrationUrl = branding.portalWelcomeIllustrationUrl.trim();
  const assistantDisplayName = branding.assistantName.trim() || "Bailey";

  return (
    <ThreadPrimitive.Empty>
      <div className="bailey-welcome-container">
        {portalWelcomeIllustrationUrl ? (
          <div className="bailey-illustration-shell">
            <img
              className="bailey-illustration"
              src={portalWelcomeIllustrationUrl}
              alt={assistantDisplayName}
              loading="eager"
            />
          </div>
        ) : null}
        <h1 className="bailey-welcome-greeting">
          Hello, I'm <span>{assistantDisplayName}</span>.
        </h1>
        <p className="bailey-welcome-subtitle">
          Ask about products, versions, deployment, alarms, or troubleshooting.
        </p>
        <DraftOnlyWelcomeSuggestions />
      </div>
    </ThreadPrimitive.Empty>
  );
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function applyPortalWelcomeTemplate(
  template: string,
  replacements: {
    assistantName: string;
    platformName: string;
  }
): string {
  return template
    .replace(/\{\{\s*assistantName\s*\}\}/gi, replacements.assistantName)
    .replace(/\{\{\s*platformName\s*\}\}/gi, replacements.platformName)
    .trim();
}

function shorten(text: string, max = 1000): string {
  const normalized = text.trim();
  if (!normalized) return "";
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max)}\n... (truncated)`;
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

function detailFromError(error: unknown, fallback: string): string {
  if (error instanceof ApiError) return error.detail || error.message || fallback;
  if (error instanceof Error) return error.message || fallback;
  const detail = detailFromUnknown(error).trim();
  return detail || fallback;
}

function errorCodeFromUnknown(error: unknown): string | undefined {
  return error instanceof ApiError ? error.code || error.reasonCode : undefined;
}

const GENERIC_ASSISTANT_ERROR_NOTICE =
  "I couldn't complete this response. Please try again. If the issue continues, contact your workspace admin.";
const GENERIC_PROCESS_ERROR_DETAIL =
  "The request could not be completed. Please try again. If the issue continues, contact your workspace admin.";
const GENERIC_TOOL_ERROR_DETAIL = "A background tool step failed. Please try again or contact your workspace admin.";
const GENERIC_EXECUTION_ERROR_DETAIL = "A background execution step failed. Please try again or contact your workspace admin.";

function formatAssistantErrorNotice(detail: string, code?: string): string {
  const normalizedCode = (code || "").trim().toUpperCase();
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (normalizedCode === "AI_REQUEST_LIMIT_REACHED" || normalizedCode.endsWith("_TURN_LIMIT_EXCEEDED")) {
    return "AI request limit reached. Please wait for the next reset or contact your workspace admin.";
  }
  if (normalizedCode === "SUBSCRIPTION_REQUIRED" || normalizedCode === "EXTERNAL_SUBSCRIPTION_REQUIRED") {
    return "Access is not enabled yet. Please contact your workspace admin to enable a plan.";
  }
  if (normalizedCode === "SUBSCRIPTION_EXPIRED" || normalizedCode.endsWith("_SUBSCRIPTION_EXPIRED")) {
    return "Your access has ended. Please contact your workspace admin to renew it.";
  }
  if (normalizedCode === "SUBSCRIPTION_PAUSED" || normalizedCode.endsWith("_SUBSCRIPTION_PAUSED")) {
    return "Access is paused. Please contact your workspace admin to resume it.";
  }
  if (normalizedCode === "AI_TOKEN_LIMIT_REACHED" || normalizedCode.endsWith("_TOKEN_LIMIT_EXCEEDED")) {
    return "This workspace is temporarily unavailable. Please try again after the next reset or contact your workspace admin.";
  }
  if (!normalized) return GENERIC_ASSISTANT_ERROR_NOTICE;

  if (/ai request limit reached|conversation limit reached/i.test(normalized)) {
    return "AI request limit reached. Please wait for the next reset or contact your workspace admin.";
  }
  if (/a plan is required|workspace has not enabled access|has not enabled access/i.test(normalized)) {
    return "Access is not enabled yet. Please contact your workspace admin to enable a plan.";
  }
  if (/access has ended|no longer active|subscription_expired/i.test(normalized)) {
    return "Your access has ended. Please contact your workspace admin to renew it.";
  }
  if (/access is paused|currently paused|subscription_paused/i.test(normalized)) {
    return "Access is paused. Please contact your workspace admin to resume it.";
  }
  if (/system is updating|agent studio is deploying|currently deploying|deployment drain/i.test(normalized)) {
    return "System is updating. Please retry in a few minutes.";
  }
  if (/service capacity|token limit|temporarily unavailable/i.test(normalized)) {
    return "This workspace is temporarily unavailable. Please try again after the next reset or contact your workspace admin.";
  }

  return GENERIC_ASSISTANT_ERROR_NOTICE;
}

function formatAssistantErrorNoticeFromError(error: unknown, fallback: string): string {
  return formatAssistantErrorNotice(detailFromError(error, fallback), errorCodeFromUnknown(error));
}

function formatUserLocalDateTime(value?: string | null): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(parsed);
}

function coerceDate(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function isSameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function formatPortalMessageTime(value: unknown, referenceDate = new Date()): { label: string; fullLabel: string; iso: string } | null {
  const date = coerceDate(value);
  if (!date) return null;

  const label = new Intl.DateTimeFormat(undefined, {
    ...(isSameLocalDate(date, referenceDate) ? {} : { dateStyle: "medium" as const }),
    timeStyle: "short"
  }).format(date);
  const fullLabel = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short"
  }).format(date);

  return {
    label,
    fullLabel,
    iso: date.toISOString()
  };
}

function isSubscriptionAccessBlocked(status: PortalSubscriptionStatus | null | undefined): status is PortalSubscriptionStatus {
  return status?.accessState === "blocked";
}

function buildSubscriptionResetLine(status: PortalSubscriptionStatus): string {
  const resetAt = formatUserLocalDateTime(status.cycleEndsAt);
  return resetAt ? `Next reset: ${resetAt}.` : "";
}

function buildSubscriptionAccessNotice(status: PortalSubscriptionStatus | null | undefined): string {
  if (!status) return "AI request limit reached. Please wait for the next reset or contact your workspace admin.";
  const title = status.title ? (/[.!?。！？]$/.test(status.title) ? status.title : `${status.title}.`) : "";
  return [title, status.detail, buildSubscriptionResetLine(status), status.actionLabel]
    .map((item) => String(item || "").trim())
    .filter(Boolean)
    .join(" ");
}

function userSafeProcessDetail(detail: string, fallback = GENERIC_PROCESS_ERROR_DETAIL): string {
  return detail.trim() ? fallback : "";
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
  return `${value.slice(0, maxChars)}\n... (content truncated)`;
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
  id: string;
  name: string;
  path: string;
  relativePath: string;
  mimeType: string;
  size: number;
};

type UploadedAttachmentDownloadMeta = Omit<UploadedAttachmentMeta, "path">;

type WorkspacePendingAttachment = PendingAttachment & {
  uploadError?: string;
  uploadedMeta?: UploadedAttachmentMeta;
};

const THREAD_ATTACHMENT_MAX_BYTES = 128 * 1024 * 1024;

function decodeMaybeUri(value: string): string {
  if (!value.trim()) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function uploadAttachmentIdFromRelativePath(value: string): string {
  const fileName = value.trim().replace(/\\/g, "/").split("/").filter(Boolean).pop() || "";
  const match = fileName.match(/^\d+-([a-f0-9]{12})-/i);
  return match?.[1]?.toLowerCase() ?? "";
}

function uploadedMetaFromUnknown(value: unknown): UploadedAttachmentMeta {
  const obj = asRecord(value);
  if (!obj) {
    throw new Error("Invalid upload response: missing attachment");
  }
  const name = fileNameFromUnknown(decodeMaybeUri(String(obj.name ?? "")), "Untitled file");
  const pathValue = String(obj.path ?? "").trim();
  if (!pathValue) {
    throw new Error("Invalid upload response: missing file path");
  }
  const relativePath = String(obj.relative_path ?? "").trim();
  const mimeType = fileNameFromUnknown(decodeMaybeUri(String(obj.mime_type ?? "")), "application/octet-stream");
  const sizeValue = Number(obj.bytes ?? 0);
  const id =
    String(obj.id ?? "").trim().toLowerCase() ||
    uploadAttachmentIdFromRelativePath(relativePath) ||
    uploadAttachmentIdFromRelativePath(pathValue);
  return {
    id,
    name,
    path: pathValue,
    relativePath: relativePath || pathValue,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0
  };
}

function formatFileSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function clampUploadProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function createUploadProgressQueue() {
  let closed = false;
  let latest: number | null = null;
  let resolveNext: ((value: number | null) => void) | null = null;

  return {
    push(value: number) {
      if (closed) return;
      const progress = clampUploadProgress(value);
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve(progress);
        return;
      }
      latest = progress;
    },
    close() {
      if (closed) return;
      closed = true;
      if (resolveNext) {
        const resolve = resolveNext;
        resolveNext = null;
        resolve(null);
      }
    },
    next(): Promise<number | null> {
      if (latest !== null) {
        const progress = latest;
        latest = null;
        return Promise.resolve(progress);
      }
      if (closed) return Promise.resolve(null);
      return new Promise((resolve) => {
        resolveNext = resolve;
      });
    }
  };
}

function parseUploadResponse(rawText: string): Record<string, unknown> {
  if (!rawText.trim()) return {};
  try {
    const parsed = JSON.parse(rawText);
    return asRecord(parsed) ?? {};
  } catch {
    return {};
  }
}

function uploadErrorMessageFromResponse(status: number, rawText: string): string {
  const data = parseUploadResponse(rawText);
  const detail = typeof data.detail === "string" ? data.detail.trim() : "";
  if (detail) return detail;
  if (status === 413) return `File is larger than the ${formatFileSize(THREAD_ATTACHMENT_MAX_BYTES)} upload limit.`;
  return `Upload failed (${status})`;
}

function uploadThreadAttachment(
  threadId: string,
  file: File,
  options?: {
    onProgress?: (progress: number) => void;
    onRequestStart?: (request: XMLHttpRequest) => void;
  }
): Promise<UploadedAttachmentMeta> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    options?.onRequestStart?.(request);

    request.open("POST", `${apiBase()}/api/threads/${encodeURIComponent(threadId)}/attachments`);
    request.withCredentials = true;
    request.setRequestHeader("Content-Type", "application/octet-stream");
    request.setRequestHeader("X-File-Name", encodeURIComponent(fileNameFromUnknown(file.name, "upload.bin")));
    request.setRequestHeader("X-File-Type", encodeURIComponent(fileNameFromUnknown(file.type, "application/octet-stream")));
    request.setRequestHeader("X-File-Size", String(file.size));
    for (const [key, value] of Object.entries(authHeaders())) {
      request.setRequestHeader(key, value);
    }

    request.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        options?.onProgress?.(Math.min(event.loaded / event.total, 0.99));
      }
    };
    request.onerror = () => reject(new Error("Network error while uploading attachment. Check the connection and try again."));
    request.ontimeout = () => reject(new Error("Attachment upload timed out. Check the connection and try again."));
    request.onabort = () => reject(new Error("Attachment upload was cancelled."));
    request.onload = () => {
      const rawText = typeof request.responseText === "string" ? request.responseText : "";
      if (request.status < 200 || request.status >= 300) {
        notifyAuthInvalidStatus(request.status);
        reject(new Error(uploadErrorMessageFromResponse(request.status, rawText)));
        return;
      }

      try {
        options?.onProgress?.(1);
        const data = parseUploadResponse(rawText);
        resolve(uploadedMetaFromUnknown(data.attachment));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("Invalid upload response"));
      }
    };

    request.send(file);
  });
}

function buildUploadedAttachmentHint(meta: UploadedAttachmentMeta): string {
  return [
    `<uploaded_file id=${JSON.stringify(meta.id)} name=${JSON.stringify(meta.name)} path=${JSON.stringify(meta.path)} relativePath=${JSON.stringify(meta.relativePath)} mimeType=${JSON.stringify(meta.mimeType)} bytes=${meta.size}>`,
    "The file has been uploaded to the workspace. Use filesystem tools to read this path instead of assuming the content is already in context.",
    "</uploaded_file>"
  ].join("\n");
}

const UPLOADED_FILE_ATTR_PATTERN = /([A-Za-z_][A-Za-z0-9_]*)=("(?:\\.|[^"\\])*"|[^\s>]+)/g;

function extractUploadedFileHintAttrs(text: string): string {
  const tagStart = text.search(/<uploaded_file\b/i);
  if (tagStart < 0) return "";
  const tagMatch = text.slice(tagStart).match(/^<uploaded_file\b/i);
  if (!tagMatch) return "";
  const attrsStart = tagStart + tagMatch[0].length;
  let inQuote = false;
  let escaped = false;
  for (let index = attrsStart; index < text.length; index += 1) {
    const char = text[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && inQuote) {
      escaped = true;
      continue;
    }
    if (char === '"') {
      inQuote = !inQuote;
      continue;
    }
    if (char === ">" && !inQuote) {
      return text.slice(attrsStart, index).trim();
    }
  }
  return "";
}

function parseUploadedFileAttrValue(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (value.startsWith('"') && value.endsWith('"')) {
    try {
      const parsed = JSON.parse(value);
      return typeof parsed === "string" ? parsed : String(parsed ?? "");
    } catch {
      return value.slice(1, -1);
    }
  }
  return value;
}

function parseUploadedFileHint(text: string): Record<string, string> | null {
  const rawAttrs = extractUploadedFileHintAttrs(text);
  if (!rawAttrs) return null;
  const attrs: Record<string, string> = {};
  for (const attrMatch of rawAttrs.matchAll(UPLOADED_FILE_ATTR_PATTERN)) {
    const key = attrMatch[1];
    const value = attrMatch[2];
    if (!key || value === undefined) continue;
    attrs[key] = parseUploadedFileAttrValue(value);
  }
  return attrs;
}

function normalizeUploadedAttachmentDownloadMeta(
  value: unknown,
  fallback?: { name?: unknown; mimeType?: unknown }
): UploadedAttachmentDownloadMeta | null {
  const obj = asRecord(value);
  if (!obj) return null;
  const relativePath = String(obj.relativePath ?? obj.relative_path ?? "").trim();
  if (!relativePath) return null;
  const id = String(obj.id ?? "").trim().toLowerCase() || uploadAttachmentIdFromRelativePath(relativePath);
  if (!id) return null;
  const name = fileNameFromUnknown(obj.name ?? fallback?.name, "Uploaded file");
  const mimeType = fileNameFromUnknown(obj.mimeType ?? obj.mime_type ?? fallback?.mimeType, "application/octet-stream");
  const sizeValue = Number(obj.size ?? obj.bytes ?? 0);
  return {
    id,
    name,
    relativePath,
    mimeType,
    size: Number.isFinite(sizeValue) && sizeValue >= 0 ? sizeValue : 0
  };
}

function uploadedAttachmentDownloadMetaFromAttachment(attachment: unknown): UploadedAttachmentDownloadMeta | null {
  const obj = asRecord(attachment);
  if (!obj) return null;

  const content = Array.isArray(obj.content) ? obj.content : [];
  for (const part of content) {
    const partObj = asRecord(part);
    if (!partObj || partObj.type !== "text" || typeof partObj.text !== "string") continue;
    const hint = parseUploadedFileHint(partObj.text);
    const parsed = normalizeUploadedAttachmentDownloadMeta(hint, {
      name: obj.name,
      mimeType: obj.contentType
    });
    if (parsed) return parsed;
  }

  return null;
}

function buildUploadedAttachmentDownloadHref(threadId: string, meta: UploadedAttachmentDownloadMeta | null): string {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId || !meta?.id || !meta.relativePath) return "";
  const query = new URLSearchParams({ relative_path: meta.relativePath });
  return `${apiBase()}/api/threads/${encodeURIComponent(normalizedThreadId)}/attachments/${encodeURIComponent(meta.id)}/content?${query.toString()}`;
}

class WorkspaceFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  private readonly uploadedByAttachmentId = new Map<string, UploadedAttachmentMeta>();
  private readonly abortUploadByAttachmentId = new Map<string, () => void>();
  private readonly cancelledAttachmentIds = new Set<string>();

  constructor(private readonly resolveThreadId: () => Promise<string>) {}

  public async *add(state: { file: File }): AsyncGenerator<PendingAttachment, void> {
    const name = fileNameFromUnknown(state.file.name, "Untitled file");
    const id =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `${name}-${Date.now()}`;
    const baseAttachment: WorkspacePendingAttachment = {
      id,
      type: guessAttachmentType(state.file),
      name,
      contentType: state.file.type || "application/octet-stream",
      file: state.file,
      status: { type: "running", reason: "uploading", progress: 0 }
    };

    if (state.file.size > THREAD_ATTACHMENT_MAX_BYTES) {
      yield {
        ...baseAttachment,
        uploadError: `File is larger than the ${formatFileSize(THREAD_ATTACHMENT_MAX_BYTES)} upload limit.`,
        status: { type: "incomplete", reason: "error" }
      } as WorkspacePendingAttachment;
      return;
    }

    yield baseAttachment;

    const progressQueue = createUploadProgressQueue();
    const uploadPromise = (async () => {
      const threadId = await this.resolveThreadId();
      if (!threadId) {
        throw new Error("Failed to initialize the current session. Please try again.");
      }
      if (this.cancelledAttachmentIds.has(id)) {
        throw new Error("Attachment upload was cancelled.");
      }
      return uploadThreadAttachment(threadId, state.file, {
        onProgress: (progress) => progressQueue.push(progress),
        onRequestStart: (request) => {
          this.abortUploadByAttachmentId.set(id, () => request.abort());
        }
      });
    })().finally(() => {
      progressQueue.close();
      this.abortUploadByAttachmentId.delete(id);
    });

    let lastProgress = 0;
    while (true) {
      const progress = await progressQueue.next();
      if (progress === null) break;
      if (this.cancelledAttachmentIds.has(id)) {
        await uploadPromise.catch(() => undefined);
        this.cancelledAttachmentIds.delete(id);
        return;
      }
      if (progress < 1 && progress - lastProgress < 0.01) continue;
      lastProgress = progress;
      yield {
        ...baseAttachment,
        status: { type: "running", reason: "uploading", progress }
      };
    }

    try {
      const uploaded = await uploadPromise;
      if (this.cancelledAttachmentIds.has(id)) return;
      this.uploadedByAttachmentId.set(id, uploaded);
      yield {
        ...baseAttachment,
        uploadedMeta: uploaded,
        contentType: uploaded.mimeType,
        status: { type: "requires-action", reason: "composer-send" }
      } as WorkspacePendingAttachment;
    } catch (error) {
      if (this.cancelledAttachmentIds.has(id)) return;
      yield {
        ...baseAttachment,
        uploadError: error instanceof Error ? error.message : "Failed to upload attachment.",
        status: { type: "incomplete", reason: "error" }
      } as WorkspacePendingAttachment;
    } finally {
      this.cancelledAttachmentIds.delete(id);
    }
  }

  public async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const workspaceAttachment = attachment as WorkspacePendingAttachment;
    if (workspaceAttachment.status.type === "running") {
      throw new Error("Attachment is still uploading. Wait for it to finish before sending.");
    }
    if (workspaceAttachment.status.type === "incomplete") {
      throw new Error(workspaceAttachment.uploadError || "Attachment upload failed. Retry or remove the file before sending.");
    }

    const uploaded = workspaceAttachment.uploadedMeta ?? this.uploadedByAttachmentId.get(attachment.id);
    if (!uploaded) {
      throw new Error("Attachment is not ready. Retry or remove the file before sending.");
    }
    this.uploadedByAttachmentId.delete(attachment.id);

    const content: ThreadUserMessagePart[] = [{ type: "text", text: buildUploadedAttachmentHint(uploaded) }];
    const cleanAttachment = { ...workspaceAttachment };
    delete cleanAttachment.uploadError;
    delete cleanAttachment.uploadedMeta;

    return {
      ...cleanAttachment,
      contentType: uploaded.mimeType,
      status: { type: "complete" },
      content
    };
  }

  public async remove(attachment: Attachment) {
    if (attachment.status.type === "running") {
      this.cancelledAttachmentIds.add(attachment.id);
    }
    this.abortUploadByAttachmentId.get(attachment.id)?.();
    this.abortUploadByAttachmentId.delete(attachment.id);
    this.uploadedByAttachmentId.delete(attachment.id);
  }
}

function attachmentTypeLabel(type: string): string {
  if (type === "image") return "Image";
  if (type === "document") return "Document";
  return "File";
}

function uploadStatusLabel(attachment: Attachment & { uploadError?: string }): string {
  const status = attachment.status;
  if (status.type === "running") {
    const percent = Math.round(clampUploadProgress(status.progress) * 100);
    return percent >= 100 ? "Finalizing upload..." : `Uploading ${percent}%`;
  }
  if (status.type === "incomplete") {
    return attachment.uploadError || "Upload failed. Retry or remove this file.";
  }
  if (status.type === "requires-action") return "Ready to send";
  return "Uploaded";
}

const UploadAwareAttachment: FC = () => {
  const aui = useAui();
  const activeThreadId = useContext(ActiveThreadIdContext);
  const isExternalPortalUser = useContext(ExternalPortalUserContext);
  const attachment = useAttachment((item) => item as Attachment & { source?: string; uploadError?: string });
  const status = attachment.status;
  const progress = status.type === "running" ? clampUploadProgress(status.progress) : 0;
  const isUploading = status.type === "running";
  const isFailed = status.type === "incomplete";
  const isImage = attachment.type === "image";
  const canRetry = isFailed && attachment.source !== "message" && attachment.file instanceof File;
  const downloadMeta = useMemo(() => uploadedAttachmentDownloadMetaFromAttachment(attachment), [attachment]);
  const downloadHref =
    attachment.source === "message" && !isExternalPortalUser
      ? buildUploadedAttachmentDownloadHref(activeThreadId, downloadMeta)
      : "";

  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage || !(attachment.file instanceof File)) {
      setPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachment.file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [isImage, attachment.file]);

  const retryUpload = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const file = attachment.file;
    if (!(file instanceof File)) return;
    void aui
      .composer()
      .attachment({ id: attachment.id })
      .remove()
      .then(() => aui.composer().addAttachment(file))
      .catch(() => {
        // The failed attachment remains visible; the user can remove it manually.
      });
  };

  return (
    <div className="portal-upload-attachment" data-upload-status={status.type}>
      <div className="portal-upload-card-preview">
        {isImage && previewUrl ? (
          <>
            <img className="portal-upload-card-img" src={previewUrl} alt={attachment.name} />
            {isUploading ? (
              <div className="portal-upload-card-loading">
                <Loader2Icon className="portal-upload-spinner" size={16} />
              </div>
            ) : null}
          </>
        ) : (
          <div className="portal-upload-card-icon">
            {isUploading ? (
              <Loader2Icon className="portal-upload-spinner" size={20} />
            ) : isFailed ? (
              <AlertCircleIcon size={20} />
            ) : isImage ? (
              <ImageIcon size={20} />
            ) : (
              <FileIcon size={20} />
            )}
          </div>
        )}
      </div>
      <div className="portal-upload-card-info">
        <p className="portal-upload-attachment-name">
          <AttachmentPrimitive.Name />
        </p>
        {isUploading ? (
          <div className="portal-upload-progress">
            <span style={{ width: `${Math.max(4, Math.round(progress * 100))}%` }} />
          </div>
        ) : (
          <span className={`portal-upload-status-badge${isFailed ? " portal-upload-status-error" : ""}`}>
            {isFailed ? "Failed" : attachmentTypeLabel(attachment.type)}
          </span>
        )}
      </div>
      {canRetry ? (
        <button type="button" className="portal-upload-retry-overlay" onClick={retryUpload}>
          Retry
        </button>
      ) : null}
      {downloadHref && downloadMeta ? (
        <a
          className="portal-upload-download"
          href={downloadHref}
          download={downloadMeta.name}
          title={`Download ${downloadMeta.name}${downloadMeta.size ? ` (${formatFileSize(downloadMeta.size)})` : ""}`}
          aria-label={`Download ${downloadMeta.name}`}
          onClick={(event) => event.stopPropagation()}
        >
          <DownloadIcon size={12} strokeWidth={2.2} />
        </a>
      ) : null}
      {attachment.source !== "message" ? (
        <AttachmentPrimitive.Remove asChild>
          <button type="button" className="portal-upload-remove" aria-label={`Remove ${attachment.name}`}>
            <XIcon size={11} />
          </button>
        </AttachmentPrimitive.Remove>
      ) : null}
    </div>
  );
};

const UPLOAD_AWARE_ATTACHMENT_COMPONENTS = { Attachment: UploadAwareAttachment };

function composerUploadBlockReason(attachments: readonly Attachment[]): "uploading" | "failed" | "" {
  let hasUploading = false;
  for (const attachment of attachments) {
    if (attachment.status.type === "incomplete") return "failed";
    if (attachment.status.type === "running") hasUploading = true;
  }
  return hasUploading ? "uploading" : "";
}

function useComposerMultilineRef(composerText: string) {
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const composerTextRef = useRef(composerText);
  composerTextRef.current = composerText;

  const syncMultilineState = useCallback(() => {
    const wrap = composerWrapRef.current;
    if (!wrap) return;
    const textarea = wrap.querySelector("textarea");
    if (!textarea) return;
    const hasMultipleLines = composerTextRef.current.includes("\n") || textarea.scrollHeight > 44;
    wrap.dataset.multiline = String(hasMultipleLines);
  }, []);

  useEffect(() => {
    const wrap = composerWrapRef.current;
    if (!wrap) return;
    const textarea = wrap.querySelector("textarea");
    if (!textarea) return;

    let animationFrame: number | null = null;
    const update = () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        syncMultilineState();
      });
    };

    const ro = new ResizeObserver(update);
    ro.observe(textarea);
    textarea.addEventListener("input", update);
    update();

    return () => {
      if (animationFrame !== null) {
        window.cancelAnimationFrame(animationFrame);
      }
      ro.disconnect();
      textarea.removeEventListener("input", update);
    };
  }, [syncMultilineState]);

  useEffect(() => {
    const animationFrame = window.requestAnimationFrame(syncMultilineState);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [composerText, syncMultilineState]);

  return composerWrapRef;
}

function skillUsesImageIcon(skill: RuntimeSkillOption): boolean {
  const haystack = `${skill.name} ${skill.label} ${skill.description ?? ""}`.toLowerCase();
  return haystack.includes("image") || haystack.includes("图片") || haystack.includes("图像");
}

const SKILL_ICON_TONES = ["blue", "violet", "emerald", "amber", "rose", "cyan"] as const;

function skillIconTone(skill: RuntimeSkillOption): (typeof SKILL_ICON_TONES)[number] {
  const key = `${skill.name}:${skill.label ?? ""}:${skill.description ?? ""}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) {
    hash = (hash * 31 + key.charCodeAt(index)) % SKILL_ICON_TONES.length;
  }
  return SKILL_ICON_TONES[hash] ?? "blue";
}

const SkillComposerIcon: FC<{ skill: RuntimeSkillOption; size?: number }> = ({ skill, size = 16 }) =>
  skillUsesImageIcon(skill) ? <ImageIcon size={size} /> : <ZapIcon size={size} />;

const SkillComposerControls: FC = () => {
  const { availableSkills, enabledSkillIds, toggleSkill } = useContext(SkillComposerContext);
  const enabledSkillSet = useMemo(() => new Set(enabledSkillIds), [enabledSkillIds]);
  const selectedSkills = useMemo(
    () => availableSkills.filter((skill) => enabledSkillSet.has(skill.id)),
    [availableSkills, enabledSkillSet]
  );

  if (availableSkills.length === 0) return null;

  const menuItems: MenuProps["items"] = availableSkills.map((skill) => {
    const enabled = enabledSkillSet.has(skill.id);
    return {
      key: skill.id,
      className: `portal-composer-skill-menu-entry${enabled ? " is-selected" : ""}`,
      label: (
        <span className={`portal-composer-skill-menu-item${enabled ? " is-selected" : ""}`}>
          <span className="portal-composer-skill-menu-check" aria-hidden="true">
            {enabled ? <CheckIcon size={15} strokeWidth={2.8} /> : null}
          </span>
          <span className="portal-composer-skill-menu-glyph" data-tone={skillIconTone(skill)} aria-hidden="true">
            <SkillComposerIcon skill={skill} size={17} />
          </span>
          <span className="portal-composer-skill-menu-title">{skill.label || skill.name}</span>
        </span>
      )
    };
  });

  const handleMenuClick: MenuProps["onClick"] = ({ key, domEvent }) => {
    domEvent.preventDefault();
    domEvent.stopPropagation();
    toggleSkill(String(key));
  };

  return (
    <>
      <Dropdown
        trigger={["click"]}
        placement="topLeft"
        menu={{ items: menuItems, onClick: handleMenuClick }}
        overlayClassName="portal-composer-skill-dropdown"
      >
        <button
          type="button"
          className={`portal-composer-skill-trigger${selectedSkills.length > 0 ? " is-active" : ""}`}
          aria-label="Choose skills"
          title="Choose skills"
        >
          <PackageIcon size={16} />
          <span className="portal-composer-skill-trigger-text">Skills</span>
        </button>
      </Dropdown>
      {selectedSkills.map((skill) => (
        <button
          key={skill.id}
          type="button"
          className="portal-composer-skill-chip"
          title={`Disable ${skill.label || skill.name}`}
          aria-label={`Disable ${skill.label || skill.name}`}
          onClick={() => toggleSkill(skill.id)}
        >
          <SkillComposerIcon skill={skill} size={16} />
          <span>{skill.label || skill.name}</span>
          <XIcon size={13} />
        </button>
      ))}
    </>
  );
};

const UploadAwareComposer: FC = () => {
  const aui = useAui();
  const isMobileWorkbench = useContext(MobileWorkbenchContext);
  const accessBlock = useSubscriptionAccessBlock();
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const composerText = useAuiState((state) => (state.composer.isEditing ? state.composer.text : ""));
  const composerEmpty = useAuiState((state) => state.composer.isEmpty);
  const composerEditing = useAuiState((state) => state.composer.isEditing);
  const uploadBlockReason = useAuiState((state) => composerUploadBlockReason(state.composer.attachments));
  const sendBlockedByUpload = uploadBlockReason !== "";
  const sendDisabled = threadRunning || !composerEditing || composerEmpty || sendBlockedByUpload || accessBlock.blocked;
  const sendTitle =
    accessBlock.blocked
      ? accessBlock.notice
      : uploadBlockReason === "uploading"
      ? "Wait for attachments to finish uploading"
      : uploadBlockReason === "failed"
        ? "Retry or remove failed uploads before sending"
        : "Send message";
  const [composerSending, setComposerSending] = useState(false);
  const composerSendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerWrapRef = useComposerMultilineRef(composerText);

  useEffect(() => {
    return () => {
      if (composerSendingTimerRef.current !== null) {
        clearTimeout(composerSendingTimerRef.current);
      }
    };
  }, []);

  const triggerComposerSendAnimation = useCallback(() => {
    if (composerSendingTimerRef.current !== null) {
      clearTimeout(composerSendingTimerRef.current);
      composerSendingTimerRef.current = null;
    }
    setComposerSending(false);
    window.requestAnimationFrame(() => {
      setComposerSending(true);
      composerSendingTimerRef.current = setTimeout(() => {
        setComposerSending(false);
        composerSendingTimerRef.current = null;
      }, 720);
    });
  }, []);

  const preventBlockedSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    if (sendBlockedByUpload || accessBlock.blocked) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!sendDisabled) {
      triggerComposerSendAnimation();
    }
  };

  const sendCurrentMessage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (sendDisabled) return;
    triggerComposerSendAnimation();
    aui.composer().send();
  };

  return (
    <div ref={composerWrapRef} className={composerSending ? "portal-composer-wrap is-sending" : "portal-composer-wrap"}>
      <Composer.Root onSubmit={preventBlockedSubmit}>
        <Composer.Attachments components={UPLOAD_AWARE_ATTACHMENT_COMPONENTS} />
        {accessBlock.blocked ? (
          <p className="portal-upload-composer-hint portal-access-composer-hint" role="alert">
            {accessBlock.notice}
          </p>
        ) : sendBlockedByUpload ? (
          <p className="portal-upload-composer-hint" role="status">
            {uploadBlockReason === "uploading"
              ? "Uploading attachments. You can keep typing; sending unlocks when ready."
              : "An attachment failed to upload. Retry or remove it before sending."}
          </p>
        ) : null}
        <div className="portal-composer-input-row">
          <Composer.Input
            autoFocus={!isMobileWorkbench}
            unstable_focusOnRunStart={!isMobileWorkbench}
            unstable_focusOnScrollToBottom={!isMobileWorkbench}
            unstable_focusOnThreadSwitched={!isMobileWorkbench}
          />
        </div>
        <div className="portal-composer-tools-row">
          <div className="portal-composer-tools-left">
            <Composer.AddAttachment />
            <SkillComposerControls />
          </div>
          {threadRunning ? (
            <Composer.Cancel className="portal-stop-btn">
              <SquareIcon size={13} />
            </Composer.Cancel>
          ) : (
            <button
              type="submit"
              className="aui-button aui-button-primary aui-button-icon aui-composer-send portal-upload-send"
              disabled={sendDisabled}
              title={sendTitle}
              aria-label={sendTitle}
              onClick={sendCurrentMessage}
            >
              <SendHorizontalIcon size={17} />
            </button>
          )}
        </div>
      </Composer.Root>
    </div>
  );
};

const MobileAwareComposer: FC = () => {
  const aui = useAui();
  const isMobileWorkbench = useContext(MobileWorkbenchContext);
  const accessBlock = useSubscriptionAccessBlock();
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const composerText = useAuiState((state) => (state.composer.isEditing ? state.composer.text : ""));
  const composerEmpty = useAuiState((state) => state.composer.isEmpty);
  const composerEditing = useAuiState((state) => state.composer.isEditing);
  const sendDisabled = threadRunning || !composerEditing || composerEmpty || accessBlock.blocked;
  const sendTitle = accessBlock.blocked ? accessBlock.notice : "Send message";
  const composerWrapRef = useComposerMultilineRef(composerText);

  const preventBlockedSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    if (accessBlock.blocked) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  const sendCurrentMessage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (sendDisabled) return;
    aui.composer().send();
  };

  return (
    <div ref={composerWrapRef} className="portal-composer-wrap">
      <Composer.Root onSubmit={preventBlockedSubmit}>
        {accessBlock.blocked ? (
          <p className="portal-upload-composer-hint portal-access-composer-hint" role="alert">
            {accessBlock.notice}
          </p>
        ) : null}
        <div className="portal-composer-input-row">
          <Composer.Input
            autoFocus={!isMobileWorkbench}
            unstable_focusOnRunStart={!isMobileWorkbench}
            unstable_focusOnScrollToBottom={!isMobileWorkbench}
            unstable_focusOnThreadSwitched={!isMobileWorkbench}
          />
        </div>
        <div className="portal-composer-tools-row">
          <div className="portal-composer-tools-left">
            <SkillComposerControls />
          </div>
          {threadRunning ? (
            <Composer.Cancel className="portal-stop-btn">
              <SquareIcon size={13} />
            </Composer.Cancel>
          ) : (
            <button
              type="submit"
              className="aui-button aui-button-primary aui-button-icon aui-composer-send portal-upload-send"
              disabled={sendDisabled}
              title={sendTitle}
              aria-label={sendTitle}
              onClick={sendCurrentMessage}
            >
              <SendHorizontalIcon size={17} />
            </button>
          )}
        </div>
      </Composer.Root>
    </div>
  );
};

const SessionRailNewThreadButton: FC<{ label?: string }> = ({ label = "New session" }) => (
  <ThreadListPrimitive.New asChild>
    <button type="button" className="session-rail-new-btn" aria-label={label}>
      <PlusIcon size={16} />
      <span>{label}</span>
    </button>
  </ThreadListPrimitive.New>
);

function buildCodexRunConfig(cfg: AppliedConfig, mode: string, enabledSkills: RuntimeSkillOption[]): Record<string, unknown> {
  const runConfig: Record<string, unknown> = {
    sandboxMode: cfg.sandboxMode,
    approvalPolicy: cfg.approvalPolicy,
    networkAccessEnabled: cfg.networkAccessEnabled,
    webSearchMode: cfg.webSearchMode,
    mode,
    enabledSkills: enabledSkills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      ...(skill.managedSkillId ? { managedSkillId: skill.managedSkillId } : {}),
      ...(skill.sourcePath ? { sourcePath: skill.sourcePath } : {})
    }))
  };

  const additionalDirectories = parseDirectories(cfg.additionalDirectoriesRaw);
  if (additionalDirectories && additionalDirectories.length > 0) {
    runConfig.additionalDirectories = additionalDirectories;
  }

  return runConfig;
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
  if (status === "in_progress") return "In progress";
  if (status === "completed") return "Completed";
  if (status === "failed") return "Failed";
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

function formatThreadGroupLabel(value: string | undefined, referenceDate = new Date()): string {
  if (!value) return "";
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return "";
  const dayMs = 24 * 60 * 60 * 1000;
  const currentDay = new Date(referenceDate);
  currentDay.setHours(0, 0, 0, 0);
  const targetDay = new Date(at);
  targetDay.setHours(0, 0, 0, 0);
  let diffDays = Math.floor((currentDay.getTime() - targetDay.getTime()) / dayMs);
  if (diffDays < 0) diffDays = 0;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Yesterday";
  if (diffDays <= 7) return "Last 7 days";
  if (diffDays <= 30) return "Last 30 days";
  const year = targetDay.getFullYear();
  const month = String(targetDay.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function rememberThreadGroupHeader(
  groupHeaderByRemoteId: Record<string, string>,
  thread: Pick<ThreadOut, "id" | "external_id">,
  groupLabel: string,
  localThreadId?: string
): void {
  if (!groupLabel) return;
  const keys = [thread.id, thread.external_id, localThreadId]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  for (const key of keys) {
    groupHeaderByRemoteId[key] = groupLabel;
  }
}

function resolveThreadGroupHeader(
  groupHeaderByRemoteId: Record<string, string>,
  remoteId: string,
  externalId: string,
  localId: string
): string {
  return groupHeaderByRemoteId[remoteId] || groupHeaderByRemoteId[externalId] || groupHeaderByRemoteId[localId] || "";
}

function clearThreadGroupHeaderLabel(groupHeaderByRemoteId: Record<string, string>, groupLabel: string): void {
  if (!groupLabel) return;
  for (const [key, label] of Object.entries(groupHeaderByRemoteId)) {
    if (label === groupLabel) {
      delete groupHeaderByRemoteId[key];
    }
  }
}

function timelineKindLabel(kind: TimelineRow["kind"]): string {
  if (kind === "reasoning") return "Reasoning";
  if (kind === "tool") return "Tool";
  if (kind === "source") return "Source";
  if (kind === "meta") return "Setup";
  if (kind === "done") return "Done";
  if (kind === "error") return "Error";
  if (kind === "debug") return "Debug";
  return "Step";
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

function normalizedToolIdentity(item: Record<string, unknown> | null): string {
  if (!item) return "";
  return [
    item.server,
    item.tool,
    item.name,
    item.model,
    item.title
  ]
    .filter((value): value is string => typeof value === "string")
    .join(" ")
    .toLowerCase();
}

function isImageGenerationItem(itemType: string, item: Record<string, unknown> | null): boolean {
  const identity = normalizedToolIdentity(item);
  if (!identity) return false;
  if (/\b(imagegen|image_gen|image-generation|image_generation|gpt-image|dall-e|dalle)\b/.test(identity)) {
    return true;
  }
  return (
    itemType === "mcp_tool_call" &&
    /\b(generate|create|render|edit)\b/.test(identity) &&
    /\b(image|picture|illustration|photo)\b/.test(identity)
  );
}

function stageTextForCodexItem(
  itemType: string,
  lifecycle: "started" | "completed",
  item: Record<string, unknown> | null
): string {
  if (lifecycle === "started") {
    if (itemType === "reasoning") return "Thinking through your request";
    if (itemType === "command_execution") return "Checking the information needed to answer";
    if (isImageGenerationItem(itemType, item)) return "Generating the image. This can take a little longer.";
    if (itemType === "mcp_tool_call") return "Gathering relevant details";
    if (itemType === "web_search") {
      const query = typeof item?.query === "string" ? ellipsizeSingleLine(item.query, 20) : "";
      return query ? `Looking up: ${query}` : "Looking up relevant information";
    }
    if (itemType === "todo_list") return "Organizing the next steps";
    if (itemType === "file_change") return "Applying the requested changes";
    if (itemType === "agent_message") return "Writing the answer";
    if (itemType === "error") return "Trying to recover";
    return "Working on your request";
  }

  if (itemType === "reasoning") return "Refining the answer";
  if (itemType === "command_execution") return "Reviewing the results";
  if (isImageGenerationItem(itemType, item)) return "Reviewing the generated image";
  if (itemType === "mcp_tool_call") return "Reviewing the details";
  if (itemType === "web_search") return "Reviewing what I found";
  if (itemType === "todo_list") return "Continuing with the plan";
  if (itemType === "file_change") return "Checking the changes";
  if (itemType === "agent_message") return "Writing the answer";
  if (itemType === "error") return "Something went wrong, checking it";
  return "Still working on your request";
}

function parseCrestActionResult(result: unknown): Record<string, unknown> | null {
  const direct = asRecord(result);
  const content = Array.isArray(direct?.content) ? direct.content : [];
  const firstText = content
    .map((item) => asRecord(item))
    .find((item) => item?.type === "text" && typeof item.text === "string")?.text;
  if (typeof firstText === "string") {
    try {
      return asRecord(JSON.parse(firstText));
    } catch {
      return null;
    }
  }
  return direct;
}

function crestActionTrace(
  toolName: string,
  args: Record<string, unknown>,
  result: unknown,
  errMsg: string
): { title: string; detail: string } | null {
  if (!toolName.includes("crest_crm.") && !toolName.includes("crest.actions.")) return null;
  const actionId = typeof args.actionId === "string" ? args.actionId : "";
  const payload = parseCrestActionResult(result);
  const title = typeof payload?.title === "string" ? payload.title : actionId || "Crest action";
  if (errMsg) {
    return {
      title: `Crest CRM · ${title} failed`,
      detail: `error: ${shorten(errMsg, 600)}`
    };
  }
  const summary = typeof payload?.summary === "string" ? payload.summary : "";
  const warnings = Array.isArray(payload?.warnings)
    ? payload.warnings.filter((item): item is string => typeof item === "string")
    : [];
  const requiresConfirmation = payload?.requiresConfirmation === true;
  const confirmationToken = typeof payload?.confirmationToken === "string" ? payload.confirmationToken : "";
  const idempotencyKey = typeof payload?.idempotencyKey === "string" ? payload.idempotencyKey : "";
  const auditId = typeof payload?.auditId === "string" ? payload.auditId : "";
  const affectedResources = Array.isArray(payload?.affectedResources)
    ? payload.affectedResources.map((item) => detailFromUnknown(item)).filter(Boolean)
    : [];
  const lines = [
    actionId ? `action: ${actionId}` : "",
    summary,
    affectedResources.length ? `affected:\n${affectedResources.map((item) => `- ${item}`).join("\n")}` : "",
    warnings.length ? `warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}` : "",
    confirmationToken ? "confirmation: required" : "",
    idempotencyKey ? "idempotency: ready" : "",
    auditId ? `audit: ${auditId}` : ""
  ].filter(Boolean);
  return {
    title: requiresConfirmation ? `Crest CRM · Preview ${title}` : `Crest CRM · ${title}`,
    detail: lines.join("\n")
  };
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

function guessThreadTitleFromText(value: string): string {
  const text = value
    .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, "uploaded file")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New conversation";
  return text.length <= 22 ? text : `${text.slice(0, 22)}...`;
}

function isPlaceholderThreadTitle(value: string | undefined): boolean {
  const title = String(value || "").trim();
  return !title || title === "New conversation";
}

function guessThreadTitle(messages: readonly ThreadMessage[]): string {
  return guessThreadTitleFromText(messageTextForTitle(messages));
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

function normalizePreviewFilePath(value: string): string {
  return String(value || "")
    .replace(/\\/g, "/")
    .trim();
}

function splitPreviewPathAnchor(value: string): { filePath: string; anchor: string } {
  const normalized = normalizePreviewFilePath(value);
  const hashIndex = normalized.indexOf("#");
  if (hashIndex < 0) return { filePath: normalized, anchor: "" };
  return {
    filePath: normalized.slice(0, hashIndex),
    anchor: decodeMaybeUri(normalized.slice(hashIndex + 1)).replace(/^#+/g, "").trim()
  };
}

function slugifyPreviewAnchorText(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[`~!@#$%^&*()+=[\]{}\\|;:'",.<>/?，。！？、（）【】《》]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function fileNameFromPreviewPath(filePath: string): string {
  const normalized = splitPreviewPathAnchor(filePath).filePath;
  if (!normalized) return "Untitled file";
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] || normalized;
}

function fileChangeKindLabel(kind: string): string {
  const normalized = kind.trim().toLowerCase();
  if (normalized === "artifact" || normalized === "available" || normalized === "ready") return "Ready";
  if (!normalized || normalized === "update" || normalized === "updated") return "Updated";
  if (normalized === "create" || normalized === "created" || normalized === "add" || normalized === "added") return "Added";
  if (normalized === "delete" || normalized === "deleted" || normalized === "remove" || normalized === "removed") return "Deleted";
  if (normalized === "rename" || normalized === "renamed" || normalized === "move" || normalized === "moved") return "Renamed";
  return kind.trim() || "Change";
}

type CodexFileChangeView = {
  path: string;
  kind: string;
  canPreview?: boolean;
  canDownload?: boolean;
  artifactId?: string;
  blockedReason?: string;
};

function collectCodexFileChanges(data: unknown): CodexFileChangeView[] {
  const payload = asRecord(data);
  if (!payload) return [];
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const dedup = new Set<string>();
  const out: CodexFileChangeView[] = [];

  for (const item of changes) {
    const obj = asRecord(item);
    if (!obj) continue;
    const path = normalizePreviewFilePath(asString(obj.path));
    if (!path) continue;
    const kind = asString(obj.kind) || "update";
    const previewStatus = asString(obj.preview_status ?? obj.previewStatus);
    const downloadStatus = asString(obj.download_status ?? obj.downloadStatus);
    const key = `${kind}::${path}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    out.push({
      path,
      kind,
      canPreview: obj.can_preview === true || obj.canPreview === true || previewStatus === "ready",
      canDownload: obj.can_download === true || obj.canDownload === true || downloadStatus === "ready",
      artifactId: asString(obj.artifact_id ?? obj.artifactId) || undefined,
      blockedReason: asString(obj.blocked_reason ?? obj.blockedReason) || undefined
    });
  }

  return out;
}

function collectSkillRootPathsFromChanges(changes: CodexFileChangeView[]): string[] {
  const roots = new Set<string>();
  for (const change of changes) {
    const normalizedPath = normalizePreviewFilePath(change.path);
    if (!normalizedPath) continue;
    const marker = "/SKILL.md";
    const root = normalizedPath === "SKILL.md"
      ? "."
      : normalizedPath.endsWith(marker)
        ? normalizedPath.slice(0, -marker.length) || "."
        : "";
    if (!root) continue;
    roots.add(root);
  }
  return [...roots];
}

function buildSkillCreatorReviewPrompt(prompt: string): string {
  return `${prompt}

Agent Studio skill install workflow:
- Use the normal skill-creator workflow to create or update a standard Codex Skill directory with a valid SKILL.md.
- Do not install or copy the skill into CODEX_HOME, ~/.codex, or any global Codex skills directory.
- Create the generated skill inside this thread workspace, preferably under ./skill-drafts/<skill-name>.
- When the skill files are ready, stop at the generated files. Agent Studio will offer an Install skill action that installs the skill through the backend and makes it available in new chats.`;
}

function isKnowledgeSetPreviewPath(pathname: string): boolean {
  const normalized = pathname.trim().replace(/\\/g, "/");
  return normalized.includes("/data/knowledge-sets/");
}

function resolveThreadPreviewPathFromHref(href: string, threadId: string): string | null {
  const rawHref = href.trim();
  const normalizedThreadId = threadId.trim();
  if (!rawHref) return null;
  if (rawHref.startsWith("#")) return null;
  if (/^(mailto|tel|javascript):/i.test(rawHref)) return null;

  const previewPathFromFileContentHref = resolvePreviewPathFromFileContentHref(rawHref);
  if (previewPathFromFileContentHref) return previewPathFromFileContentHref;

  const resolvePathname = (): string => {
    try {
      const parsed = new URL(rawHref, window.location.href);
      if (parsed.origin !== window.location.origin) return "";
      return `${parsed.pathname || ""}${parsed.hash || ""}`;
    } catch {
      return "";
    }
  };
  const pathnameWithHash = decodeURIComponent(resolvePathname());
  const { filePath: pathname } = splitPreviewPathAnchor(pathnameWithHash);
  if (!pathname || pathname.startsWith("/api/")) return null;
  if (isKnowledgeSetPreviewPath(pathname)) return pathnameWithHash;

  if (!normalizedThreadId) {
    return pathname.includes("/thread-") ? pathnameWithHash : null;
  }

  const threadSegment = `/thread-${normalizedThreadId}`;
  if (pathname !== threadSegment && !pathname.includes(`${threadSegment}/`)) {
    return null;
  }
  return pathnameWithHash;
}

function readPortalThreadIdFromLocation(search: string): string {
  const params = new URLSearchParams(search);
  return params.get(PORTAL_THREAD_SEARCH_PARAM)?.trim() || "";
}

function replacePortalThreadIdInLocation(threadId: string): void {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams(window.location.search);
  const normalizedThreadId = threadId.trim();
  if (normalizedThreadId) {
    params.set(PORTAL_THREAD_SEARCH_PARAM, normalizedThreadId);
  } else {
    params.delete(PORTAL_THREAD_SEARCH_PARAM);
  }
  const nextSearch = params.toString();
  const nextUrl = `${window.location.pathname}${nextSearch ? `?${nextSearch}` : ""}${window.location.hash}`;
  window.history.replaceState(window.history.state, document.title, nextUrl);
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

function pushPromptImageName(bucket: PromptBucket, value: unknown, fallback = "Untitled image") {
  bucket.imageNames.add(fileNameFromUnknown(value, fallback));
}

function pushPromptFileName(bucket: PromptBucket, value: unknown, fallback = "Untitled file") {
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

function collectPromptPart(bucket: PromptBucket, part: unknown, fallbackName = "Untitled file") {
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
  const attachmentName = fileNameFromUnknown(att.name, "Untitled file");
  if (att.type === "image") {
    pushPromptImageName(bucket, attachmentName, "Untitled image");
  } else {
    pushPromptFileName(bucket, attachmentName, "Untitled file");
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
      attachmentHints.push(`User uploaded images: ${Array.from(bucket.imageNames).join(", ")}`);
    }
    if (bucket.fileNames.size > 0) {
      attachmentHints.push(`User uploaded files: ${Array.from(bucket.fileNames).join(", ")}`);
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

function reviveMessage(message: unknown, persistedCreatedAt?: string | null): unknown {
  const obj = asRecord(message);
  if (!obj) return message;

  const role = typeof obj.role === "string" ? obj.role : "";
  const revived: Record<string, unknown> = { ...obj };

  revived.createdAt = coerceDate(persistedCreatedAt) ?? coerceDate(revived.createdAt) ?? new Date();

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

function applyStoredFeedback(message: unknown, feedback: ThreadFeedbackOut | undefined): unknown {
  const obj = asRecord(message);
  if (!obj || obj.role !== "assistant" || !feedback) return message;

  const metadata = asRecord(obj.metadata) || {};
  return {
    ...obj,
    metadata: {
      ...metadata,
      submittedFeedback: { type: feedback.type },
      custom: {
        ...(asRecord(metadata.custom) || {}),
        feedback: {
          id: feedback.id,
          type: feedback.type,
          comment: feedback.comment,
          createdAt: feedback.created_at,
          updatedAt: feedback.updated_at
        }
      }
    }
  };
}

function isThreadRuntimeRunning(value: unknown): boolean {
  const runtime = asRecord(value);
  if (runtime?.isRunning === true) return true;
  const messages = Array.isArray(runtime?.messages) ? runtime.messages : [];
  const lastMessage = messages[messages.length - 1];
  const message = asRecord(lastMessage);
  const status = asRecord(message?.status);
  return message?.role === "assistant" && status?.type === "running";
}

function areRunningThreadMapsEqual(
  left: RunningThreadIdsContextValue,
  right: RunningThreadIdsContextValue
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) return false;
  return leftKeys.every((key) => left[key] === right[key]);
}

function updateRunningThreadMap(
  current: RunningThreadIdsContextValue,
  threadId: string,
  isRunning: boolean
): RunningThreadIdsContextValue {
  const normalizedThreadId = threadId.trim();
  if (!normalizedThreadId) return current;

  if (isRunning) {
    return current[normalizedThreadId] ? current : { ...current, [normalizedThreadId]: true };
  }

  if (!current[normalizedThreadId]) return current;
  const next = { ...current };
  delete next[normalizedThreadId];
  return next;
}

function normalizeThreadIdentityKeys(...threadIds: Array<string | undefined | null>): string[] {
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const value of threadIds) {
    const key = String(value || "").trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    keys.push(key);
  }
  return keys;
}

function updateRunningThreadMapForKeys(
  current: RunningThreadIdsContextValue,
  threadIds: readonly string[],
  isRunning: boolean
): RunningThreadIdsContextValue {
  let next = current;
  for (const threadId of threadIds) {
    next = updateRunningThreadMap(next, threadId, isRunning);
  }
  return next;
}

function mergeRunningThreadMaps(
  first: RunningThreadIdsContextValue,
  second: RunningThreadIdsContextValue
): RunningThreadIdsContextValue {
  if (Object.keys(first).length === 0) return second;
  if (Object.keys(second).length === 0) return first;
  return { ...first, ...second };
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
      <summary>Reasoning summary</summary>
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
        Source: {label}
      </a>
    </p>
  );
};

function useSubscriptionAccessBlock() {
  const access = useContext(PortalSubscriptionAccessContext);
  const blocked = isSubscriptionAccessBlocked(access.status);
  return {
    blocked,
    status: access.status,
    notice: blocked ? buildSubscriptionAccessNotice(access.status) : ""
  };
}

const AssistantErrorNoticeCard: FC<{ notice: string; rawDetail?: string }> = ({ notice, rawDetail }) => (
  <div className="assistant-error-card" role="alert" aria-live="polite">
    <div className="assistant-error-card-head">
      <AlertCircleIcon size={16} aria-hidden="true" />
      <span>Request could not be completed</span>
    </div>
    <p>{notice || GENERIC_ASSISTANT_ERROR_NOTICE}</p>
    {rawDetail && rawDetail !== notice ? <span className="assistant-error-card-detail">{shorten(rawDetail, 260)}</span> : null}
  </div>
);

function daysUntilSubscriptionExpiry(status: PortalSubscriptionStatus | null): number | null {
  if (!status?.expiresAt) return null;
  const date = new Date(status.expiresAt);
  if (Number.isNaN(date.getTime())) return null;
  return Math.ceil((date.getTime() - Date.now()) / (24 * 60 * 60 * 1000));
}

function shouldShowPortalSubscriptionReminder(status: PortalSubscriptionStatus | null): boolean {
  if (!status) return false;
  if (status.accessState === "blocked") return true;
  const days = daysUntilSubscriptionExpiry(status);
  return days !== null && days >= 0 && days <= 14;
}

function portalSubscriptionReminderKey(status: PortalSubscriptionStatus | null): string {
  if (!shouldShowPortalSubscriptionReminder(status)) return "";
  return [status?.reasonCode ?? "expiring", status?.expiresAt ?? status?.title ?? "unknown"].join(":");
}

function formatPortalLocalTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString()} local time`;
}

const PortalAccessBlockedBanner: FC<{ status: PortalSubscriptionStatus; onOpenBilling?: () => void }> = ({ status, onOpenBilling }) => (
  <div className="thread-access-banner" role="alert" aria-live="polite">
    <div className="thread-access-banner-head">
      <AlertCircleIcon size={18} aria-hidden="true" />
      <strong>{status.title || "AI request limit reached"}</strong>
    </div>
    <p>{status.detail || "You can keep reading earlier chats, but new AI requests are blocked for now."}</p>
    {status.cycleEndsAt || status.actionLabel ? (
      <p className="thread-access-banner-meta">
        {[buildSubscriptionResetLine(status), status.actionLabel].filter(Boolean).join(" ")}
      </p>
    ) : null}
    {onOpenBilling ? (
      <Button size="small" type="primary" icon={<CreditCardIcon size={15} />} onClick={onOpenBilling}>
        Renew access
      </Button>
    ) : null}
  </div>
);

const PortalSubscriptionReminderBanner: FC<{ status: PortalSubscriptionStatus; onOpenBilling: () => void }> = ({ status, onOpenBilling }) => {
  const days = daysUntilSubscriptionExpiry(status);
  return (
    <div className="thread-access-banner thread-access-banner-subscription" role="status" aria-live="polite">
      <div className="thread-access-banner-head">
        <CreditCardIcon size={18} aria-hidden="true" />
        <strong>{days === null ? status.title : days <= 0 ? "Access expires today" : `Access expires in ${days} days`}</strong>
      </div>
      <p>{status.expiresAt ? `Your current access ends ${formatPortalLocalTime(status.expiresAt)}.` : status.summary}</p>
      <Button size="small" type="primary" icon={<CreditCardIcon size={15} />} onClick={onOpenBilling}>
        Choose renewal
      </Button>
    </div>
  );
};

const PortalInlineErrorBanner: FC<{ message: string }> = ({ message }) => {
  const normalized = message.trim();
  if (!normalized) return null;
  return (
    <div className="thread-access-banner thread-access-banner-secondary" role="alert" aria-live="polite">
      <div className="thread-access-banner-head">
        <AlertCircleIcon size={18} aria-hidden="true" />
        <strong>Request could not be sent</strong>
      </div>
      <p>{normalized}</p>
    </div>
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
      aria-label={`Assistant is processing: ${runningStageText}`}
    >
      <div className="assistant-running-head">
        <span className="assistant-running-spinner" aria-hidden="true" />
        <span className="assistant-running-title">Working on it</span>
        <span className="assistant-running-chip">Live</span>
      </div>
      <p className="assistant-running-phase">{runningStageText}</p>
      <div className="assistant-running-track" aria-hidden="true">
        <span className="assistant-running-track-bar" />
      </div>
    </div>
  );
};

const BuildVersionRefreshActivityBridge: FC<{ hasRunningSessions: boolean }> = ({ hasRunningSessions }) => {
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const composerHasDraft = useAuiState((state) => !state.composer.isEmpty || state.composer.attachments.length > 0);
  const uploadRunning = useAuiState((state) =>
    state.composer.attachments.some((attachment) => attachment.status.type === "running")
  );

  useEffect(() => {
    reportAutoRefreshActivityState({
      hasRunningTasks: hasRunningSessions || threadRunning || uploadRunning,
      hasUnsavedDraft: composerHasDraft
    });
  }, [composerHasDraft, hasRunningSessions, threadRunning, uploadRunning]);

  useEffect(() => {
    return () => {
      reportAutoRefreshActivityState({
        hasRunningTasks: false,
        hasUnsavedDraft: false
      });
    };
  }, []);

  return null;
};

const AssistantMessageEmpty: FC<EmptyMessagePartProps> = (props) => {
  if (props.status.type === "incomplete" && (props.status.reason === "error" || props.status.error !== undefined)) {
    const detail = detailFromUnknown(props.status.error);
    const notice = formatAssistantErrorNotice(detail);
    return <AssistantErrorNoticeCard notice={notice} rawDetail={detail} />;
  }
  return <RunningMessagePlaceholder {...props} />;
};

function isSkillCreationIntent(prompt: string): boolean {
  const normalized = prompt.trim().toLowerCase();
  if (!normalized) return false;
  const hasSkillWord = /\bskill\b|技能|能力/.test(normalized);
  const hasCreateWord = /创建|生成|做成|固化|保存|沉淀|封装|复用|create|make|build|turn.+into/.test(normalized);
  return hasSkillWord && hasCreateWord;
}

function skillDraftStatusLabel(status: string | undefined): string {
  if (status === "pending_review") return "Pending review";
  if (status === "changes_requested") return "Changes requested";
  if (status === "published") return "Published";
  if (status === "rejected") return "Rejected";
  if (status === "archived") return "Archived";
  return status || "Processing";
}

function skillDraftStatusTone(status: string | undefined): string {
  if (status === "published") return "published";
  if (status === "rejected") return "rejected";
  if (status === "changes_requested") return "changes";
  return "pending";
}

function managedSkillStatusLabel(status: string | undefined): string {
  if (status === "active") return "Installed";
  if (status === "disabled") return "Disabled";
  if (status === "archived") return "Archived";
  return status || "Installed";
}

function managedSkillStatusTone(status: string | undefined): string {
  if (status === "disabled") return "changes";
  if (status === "archived") return "rejected";
  return "published";
}

function metadataValueAsString(metadata: unknown, key: string): string {
  const payload = asRecord(metadata);
  const value = payload ? payload[key] : undefined;
  return typeof value === "string" ? value.trim() : "";
}

const SkillDraftStatusBlock: FC<{ data: SkillDraftStatusPartData | unknown }> = ({ data }) => {
  const payload = asRecord(data) || {};
  const draftId = typeof payload.draftId === "string" ? payload.draftId.trim() : "";
  const [draft, setDraft] = useState<CodexSkillDraft | null>(null);
  const [loading, setLoading] = useState(Boolean(draftId));
  const [errorText, setErrorText] = useState("");
  const actions = useContext(SkillDraftActionContext);

  const loadDraft = useCallback(async () => {
    if (!draftId) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await fetchPortalSkillDraft(draftId);
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to refresh skill draft");
    } finally {
      setLoading(false);
    }
  }, [draftId]);

  useEffect(() => {
    void loadDraft();
  }, [loadDraft]);

  useEffect(() => {
    if (!draftId) return undefined;
    const terminal = draft?.status === "published" || draft?.status === "rejected" || draft?.status === "archived";
    if (terminal) return undefined;
    const timer = window.setInterval(() => {
      void loadDraft();
    }, 7000);
    return () => window.clearInterval(timer);
  }, [draft?.status, draftId, loadDraft]);

  const status = draft?.status || (typeof payload.status === "string" ? payload.status : undefined);
  const skillName = draft?.skillName || (typeof payload.skillName === "string" ? payload.skillName : undefined);
  const validation = draft?.validation;
  const canRevise = draft && draft.status !== "published" && draft.status !== "archived";
  const canUse = draft?.status === "published" && skillName;
  const canCreateNewVersion = draft?.status === "published";

  const handleRevise = async () => {
    if (!draft) return;
    const instruction = window.prompt("Describe how you want to revise this skill:");
    if (!instruction?.trim()) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await revisePortalSkillDraft(draft.id, instruction.trim());
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to revise the skill draft");
    } finally {
      setLoading(false);
    }
  };

  const handleUseNewSession = async () => {
    if (!skillName) return;
    await actions.openNewSessionWithSkill({ skillName });
  };

  const handleCreateNewVersion = async () => {
    if (!draft) return;
    const instruction = window.prompt("Describe what should change in the next version of this skill:");
    if (!instruction?.trim()) return;
    setLoading(true);
    setErrorText("");
    try {
      const response = await createPortalSkillDraftNewVersion(draft.id, instruction.trim());
      setDraft(response.draft);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to create a new version draft");
    } finally {
      setLoading(false);
    }
  };

  if (!draftId) return null;

  return (
    <section className={`skill-draft-card skill-draft-${skillDraftStatusTone(status)}`} aria-label="Skill draft status">
      <div className="skill-draft-card-head">
        <div>
          <p className="skill-draft-eyebrow">Reusable Skill</p>
          <h4>{draft?.displayName || skillName || "Skill draft"}</h4>
        </div>
        <span className="skill-draft-status">{loading ? "Refreshing" : skillDraftStatusLabel(status)}</span>
      </div>
      <div className="skill-draft-meta-grid">
        <div>
          <span>Skill name</span>
          <strong>{skillName || "-"}</strong>
        </div>
        <div>
          <span>Author</span>
          <strong>{draft?.createdByDisplayName || draft?.createdByEmail || "You"}</strong>
        </div>
        <div>
          <span>Version</span>
          <strong>{draft?.version || "1.0.0"}</strong>
        </div>
      </div>
      {draft?.description ? <p className="skill-draft-description">{draft.description}</p> : null}
      {draft?.reviewNote ? <p className="skill-draft-note">Review note: {draft.reviewNote}</p> : null}
      {validation && (!validation.ok || validation.warnings.length > 0) ? (
        <div className="skill-draft-validation">
          {validation.errors.map((item) => (
            <p key={`error-${item}`}>Error: {item}</p>
          ))}
          {validation.warnings.map((item) => (
            <p key={`warning-${item}`}>Warning: {item}</p>
          ))}
        </div>
      ) : null}
      {errorText ? <p className="skill-draft-error">{errorText}</p> : null}
      <div className="skill-draft-actions">
        <button type="button" onClick={() => void loadDraft()} disabled={loading}>
          Refresh status
        </button>
        {canRevise ? (
          <button type="button" onClick={() => void handleRevise()} disabled={loading}>
            Revise draft
          </button>
        ) : null}
        {canCreateNewVersion ? (
          <button type="button" onClick={() => void handleCreateNewVersion()} disabled={loading}>
            Create new version
          </button>
        ) : null}
        {canUse ? (
          <button type="button" className="primary" onClick={() => void handleUseNewSession()} disabled={loading}>
            Use in new chat
          </button>
        ) : null}
      </div>
      {canUse ? (
        <p className="skill-draft-footnote">
          Published skills are loaded only in new chats. Future edits create a new draft for review.
        </p>
      ) : null}
    </section>
  );
};

const AssistantCommentaryBlock: FC<{
  row: CommentaryPartData;
  entries: CommentaryEntryData[];
}> = ({ row, entries }) => {
  const isStreaming = row.status === "streaming";
  const entryCount = entries.length;
  const updateCount = entries.reduce((count, entry) => count + Math.max(entry.lines.length, 1), 0);
  const [isOpen, setIsOpen] = useState(() => isStreaming || row.open !== false);

  useEffect(() => {
    if (isStreaming) {
      setIsOpen(true);
      return;
    }
    if (row.open === false) {
      setIsOpen(false);
    }
  }, [isStreaming, row.open]);

  return (
    <details
      className={`assistant-commentary-block ${isStreaming ? "is-streaming" : "is-complete"}`}
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="assistant-commentary-head">
        <span className="assistant-commentary-chip">{isStreaming ? "Thinking..." : "Thought"}</span>
        {!isStreaming && (
          <span className="assistant-commentary-count">
            {entryCount} {entryCount === 1 ? "thought" : "thoughts"} · {updateCount}{" "}
            {updateCount === 1 ? "update" : "updates"}
          </span>
        )}
      </summary>
      <div className="assistant-commentary-text">
        {entries.map((entry, entryIndex) => (
          <div key={entry.id || `${row.id}-${entryIndex}`} className="assistant-commentary-entry">
            {(entry.lines.length > 0 ? entry.lines : [entry.text]).map((line, lineIndex) => (
              <p key={`${entry.id}-${lineIndex}`} className="assistant-commentary-line">
                {line}
              </p>
            ))}
          </div>
        ))}
      </div>
    </details>
  );
};

const ProcessDataFallback: FC<any> = ({
  name,
  data
}: {
  name?: string;
  data?: ProcessData | unknown;
}) => {
  const requestPreview = useContext(PreviewRequestContext);
  const isExternalPortalUser = useContext(ExternalPortalUserContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const runningThreadIds = useContext(RunningThreadIdsContext);
  const skillDraftActions = useContext(SkillDraftActionContext);
  const [installingSkillPath, setInstallingSkillPath] = useState("");
  const [uninstallingSkillId, setUninstallingSkillId] = useState("");
  const [installedSkillsByPath, setInstalledSkillsByPath] = useState<Record<string, CodexManagedSkill>>({});
  const [skillInstallError, setSkillInstallError] = useState("");

  useEffect(() => {
    if (name !== "codex_file_change") return;
    if (isExternalPortalUser) return;
    const threadId = activeThreadId.trim();
    if (!threadId) return;
    let active = true;
    void fetchPortalManagedSkills()
      .then((response) => {
        if (!active) return;
        const next: Record<string, CodexManagedSkill> = {};
        for (const skill of response.skills || []) {
          const sourceThreadId = metadataValueAsString(skill.metadata, "sourceThreadId");
          const sourceDirectoryPath = normalizePreviewFilePath(
            metadataValueAsString(skill.metadata, "sourceThreadRelativePath") ||
              metadataValueAsString(skill.metadata, "sourceDirectoryPath")
          );
          if (!sourceDirectoryPath || sourceThreadId !== threadId) continue;
          next[sourceDirectoryPath] = skill;
        }
        setInstalledSkillsByPath(next);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [activeThreadId, isExternalPortalUser, name]);

  if (name === "codex_process_audit") return null;

  if (name === "skill_draft_status") {
    return <SkillDraftStatusBlock data={data} />;
  }

  if (name === "codex_commentary") {
    const row = (data && typeof data === "object" ? data : {}) as CommentaryPartData;
    const entries: CommentaryEntryData[] = Array.isArray(row.entries)
      ? row.entries
          .map((entry, index) => {
            const entryObj = asRecord(entry);
            const text = typeof entryObj?.text === "string" ? entryObj.text.trim() : "";
            const lines = Array.isArray(entryObj?.lines)
              ? entryObj.lines
                  .map((line) => (typeof line === "string" ? line.trim() : ""))
                  .filter(Boolean)
              : [];
            if (lines.length === 0 && !text) return null;
            return {
              id: typeof entryObj?.id === "string" && entryObj.id.trim() ? entryObj.id.trim() : `${row.id}-${index}`,
              text,
              lines,
              status: entryObj?.status === "streaming" ? "streaming" : "completed"
            } satisfies CommentaryEntryData;
          })
          .filter((entry): entry is CommentaryEntryData => Boolean(entry))
      : [];
    if (entries.length === 0) {
      const lines = Array.isArray(row.lines)
        ? row.lines
            .map((line) => (typeof line === "string" ? line.trim() : ""))
            .filter(Boolean)
        : [];
      const text = typeof row.text === "string" ? row.text.trim() : "";
      if (lines.length === 0 && !text) return null;
      entries.push({
        id: row.id || "thought",
        text,
        lines,
        status: row.status
      });
    }
    return <AssistantCommentaryBlock row={row} entries={entries} />;
  }

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
        const title = typeof obj.title === "string" && obj.title.trim() ? obj.title.trim() : "Process event";
        const detail = typeof obj.detail === "string" ? obj.detail.trim() : "";
        const rawDetail = typeof obj.rawDetail === "string" ? obj.rawDetail.trim() : "";
        const at = typeof obj.at === "string" ? normalizeProcessTime(obj.at) : "";
        return {
          id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : `trace-batch-${index + 1}`,
          kind,
          title,
          detail: detail || undefined,
          rawDetail: rawDetail || undefined,
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
        <summary className="trace-summary">{`Process trace ${rows.length} entries (reasoning ${reasoningCount} / tools ${toolCount} / steps ${stepCount})`}</summary>
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

  if (name === "codex_file_change") {
    const changes = collectCodexFileChanges(data);
    const visibleChanges = isExternalPortalUser
      ? changes.filter((item) => item.canPreview || item.canDownload)
      : changes;
    if (visibleChanges.length === 0) return null;
    const skillRootPaths = isExternalPortalUser ? [] : collectSkillRootPathsFromChanges(visibleChanges);
    const activeThreadRunning = Boolean(activeThreadId.trim() && runningThreadIds[activeThreadId.trim()]);
    const installSkillPath = async (skillPath: string) => {
      const threadId = activeThreadId.trim();
      if (!threadId) return;
      setInstallingSkillPath(skillPath);
      setSkillInstallError("");
      try {
        const skill = await skillDraftActions.installSkillFromPath({
          threadId,
          path: skillPath
        });
        if (skill) {
          setInstalledSkillsByPath((current) => ({
            ...current,
            [skillPath]: skill
          }));
          await skillDraftActions.refreshRuntimeOptions();
        }
      } catch (error) {
        setSkillInstallError(error instanceof Error ? error.message : "Failed to install skill");
      } finally {
        setInstallingSkillPath("");
      }
    };
    return (
      <section className="assistant-file-change-block" aria-label="File changes">
        <p className="assistant-file-change-title">Generated files</p>
        <ul className="assistant-file-change-list">
          {visibleChanges.map((item) => {
            const label = fileChangeKindLabel(item.kind);
            const canPreview = !isExternalPortalUser || item.canPreview;
            const canDownload = item.canDownload && activeThreadId.trim();
            const downloadHref = canDownload
              ? `${apiBase()}/api/threads/${encodeURIComponent(activeThreadId.trim())}/artifacts/content?${new URLSearchParams({
                  path: item.path,
                  disposition: "attachment"
                }).toString()}`
              : "";
            return (
              <li key={`${item.kind}-${item.path}`} className="assistant-file-change-item">
                <div className="assistant-file-change-meta">
                  <span className="assistant-file-change-kind">{label}</span>
                  <span className="assistant-file-change-name">{fileNameFromPreviewPath(item.path)}</span>
                </div>
                <div className="assistant-file-change-actions">
                  {canPreview ? (
                    <button type="button" className="assistant-file-change-btn" onClick={() => requestPreview(item.path)}>
                      Preview
                    </button>
                  ) : null}
                  {downloadHref ? (
                    <a className="assistant-file-change-btn" href={downloadHref}>
                      Download
                    </a>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
        {skillRootPaths.length > 0 ? (
          <div className="assistant-file-change-skill-submit">
            <p>
              {activeThreadRunning
                ? "Skill files detected. Installation will be available when generation finishes."
                : "Skill detected. Install it to make it available in new chats."}
            </p>
            {skillRootPaths.map((skillPath) => {
              const installedSkill = installedSkillsByPath[skillPath];
              const installLabel =
                installingSkillPath === skillPath
                  ? "Installing..."
                  : activeThreadRunning
                    ? "Waiting..."
                    : installedSkill
                      ? "Install update"
                      : "Install skill";
              return (
                <div key={skillPath} style={{ display: "grid", gap: 10 }}>
                  <div className="assistant-file-change-actions">
                    <button
                      type="button"
                      className="assistant-file-change-btn"
                      disabled={!activeThreadId || activeThreadRunning || installingSkillPath === skillPath}
                      onClick={() => void installSkillPath(skillPath)}
                    >
                      {installLabel}
                    </button>
                    <button
                      type="button"
                      className="assistant-file-change-btn"
                      onClick={() => requestPreview(skillPath === "." ? "SKILL.md" : `${skillPath}/SKILL.md`)}
                    >
                      Preview skill
                    </button>
                  </div>
                  {installedSkill ? (
                    <section
                      className={`skill-draft-card skill-draft-${managedSkillStatusTone(installedSkill.status)}`}
                      aria-label="Installed skill status"
                    >
                      <div className="skill-draft-card-head">
                        <div>
                          <p className="skill-draft-eyebrow">Reusable Skill</p>
                          <h4>{installedSkill.displayName || installedSkill.skillName}</h4>
                        </div>
                        <span className="skill-draft-status">{managedSkillStatusLabel(installedSkill.status)}</span>
                      </div>
                      <div className="skill-draft-meta-grid">
                        <div>
                          <span>Skill name</span>
                          <strong>{installedSkill.skillName}</strong>
                        </div>
                        <div>
                          <span>Version</span>
                          <strong>{installedSkill.version}</strong>
                        </div>
                        <div>
                          <span>Available in</span>
                          <strong>{installedSkill.status === "active" ? "New chats" : "Not available"}</strong>
                        </div>
                      </div>
                      {installedSkill.description ? <p className="skill-draft-description">{installedSkill.description}</p> : null}
                      <div className="skill-draft-actions">
                        {installedSkill.status === "active" ? (
                          <button
                            type="button"
                            className="primary"
                            onClick={() =>
                              void skillDraftActions.openNewSessionWithSkill({
                                skillName: installedSkill.skillName,
                                managedSkillId: installedSkill.id
                              })
                            }
                          >
                            Use in new chat
                          </button>
                        ) : null}
                        {installedSkill.scope === "private" && installedSkill.status === "active" ? (
                          <button
                            type="button"
                            disabled={uninstallingSkillId === installedSkill.id}
                            onClick={async () => {
                              const confirmed = window.confirm(
                                "Uninstall this skill? It will no longer be available in new chats."
                              );
                              if (!confirmed) return;
                              setUninstallingSkillId(installedSkill.id);
                              setSkillInstallError("");
                              try {
                                const removed = await skillDraftActions.uninstallSkill({ skillId: installedSkill.id });
                                if (removed) {
                                  setInstalledSkillsByPath((current) => ({
                                    ...current,
                                    [skillPath]: removed
                                  }));
                                }
                              } catch (error) {
                                setSkillInstallError(error instanceof Error ? error.message : "Failed to uninstall skill");
                              } finally {
                                setUninstallingSkillId("");
                              }
                            }}
                          >
                            {uninstallingSkillId === installedSkill.id ? "Uninstalling..." : "Uninstall"}
                          </button>
                        ) : null}
                        <button type="button" onClick={() => void skillDraftActions.refreshRuntimeOptions()}>
                          Refresh skills
                        </button>
                      </div>
                      <p className="skill-draft-footnote">
                        Installed skills load only when you start a new chat.
                      </p>
                    </section>
                  ) : null}
                </div>
              );
            })}
            {skillInstallError ? <p className="skill-draft-error">{skillInstallError}</p> : null}
          </div>
        ) : null}
      </section>
    );
  }

  if (name !== "codex_process") {
    return (
      <details className="process-block process-data" open={false}>
        <summary>Data event</summary>
        <pre>{shorten(detailFromUnknown(data), 1200)}</pre>
      </details>
    );
  }
  const row = (data && typeof data === "object" ? data : {}) as ProcessData;
  const title = typeof row.title === "string" ? row.title : "Process event";
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
        title: "Reasoning summary",
        detail: shorten(text, 1200)
      });
      continue;
    }

    if (type === "tool-call") {
      if (p.isError === true) {
        rows.push({
          id: `timeline-${++seq}`,
          kind: "tool",
          title: "Tool call · Failed",
          detail: GENERIC_TOOL_ERROR_DETAIL
        });
        continue;
      }
      const toolName = typeof p.toolName === "string" ? p.toolName : "unknown";
      const argsText = typeof p.argsText === "string" ? p.argsText : detailFromUnknown(p.args);
      const resultText = p.result === undefined ? "" : detailFromUnknown(p.result);
      rows.push({
        id: `timeline-${++seq}`,
        kind: "tool",
        title: `Tool call · ${toolName}`,
        detail: [shorten(argsText, 800), shorten(resultText, 1000)].filter(Boolean).join("\n\n")
      });
      continue;
    }

    if (type === "source") {
      const url = typeof p.url === "string" ? p.url.trim() : "";
      if (!url) continue;
      const title = typeof p.title === "string" && p.title.trim() ? p.title.trim() : "Source link";
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
      const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Process event";
      const detail = typeof data.detail === "string" ? data.detail.trim() : "";
      const rawDetail = typeof data.rawDetail === "string" ? data.rawDetail.trim() : "";
      const at = typeof data.at === "string" ? normalizeProcessTime(data.at) : "";
      rows.push({
        id: `timeline-${++seq}`,
        kind,
        title,
        detail: detail ? shorten(detail, 1400) : undefined,
        rawDetail: rawDetail ? shorten(rawDetail, 1400) : undefined,
        at
      });
      continue;
    }

    if (type === "data" && p.name === "codex_file_change") {
      continue;
    }

    if (type === "data" && p.name === "skill_draft_status") {
      continue;
    }

    if (type === "data" && p.name === "codex_process_audit") {
      continue;
    }

    if (type === "data") {
      rows.push({
        id: `timeline-${++seq}`,
        kind: "process",
        title: "Data event",
        detail: shorten(detailFromUnknown(p), 1200)
      });
    }
  }

  return rows;
}

const ThreadPublicShareTurnCheckbox: FC = () => {
  const messageId = useAuiState((s) => s.message.id);
  const selection = useContext(ThreadPublicShareSelectionContext);
  if (!selection.selectionMode) return null;

  const turnId = selection.leadTurnIdByMessageId[messageId];
  if (!turnId) return null;

  const checked = selection.selectedTurnIds.has(turnId);
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      className={checked ? "thread-public-share-turn-checkbox is-checked" : "thread-public-share-turn-checkbox"}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        selection.toggleTurnSelection(turnId);
      }}
    >
      <span className="thread-public-share-turn-checkbox-mark">{checked ? <CheckIcon size={14} /> : null}</span>
    </button>
  );
};

const MessageTimestamp: FC = () => {
  const createdAt = useAuiState((s) => (s.message as ThreadMessage & { createdAt?: unknown }).createdAt);
  const timestamp = useMemo(() => formatPortalMessageTime(createdAt), [createdAt]);

  if (!timestamp) return null;

  return (
    <time
      className="portal-message-timestamp"
      dateTime={timestamp.iso}
      title={timestamp.fullLabel}
      aria-label={`Sent ${timestamp.fullLabel}`}
    >
      {timestamp.label}
    </time>
  );
};

const ThreadPublicShareMessageShell: FC<{ tone: "user" | "assistant"; children: ReactNode }> = ({ tone, children }) => {
  const messageId = useAuiState((s) => s.message.id);
  const selection = useContext(ThreadPublicShareSelectionContext);
  const entryAnimation = useContext(MessageEntryAnimationContext);
  const selectable = selection.selectionMode && Boolean(selection.leadTurnIdByMessageId[messageId]);
  const entering = Boolean(messageId && entryAnimation.enteringMessageIds.has(messageId));
  const className = [
    "thread-public-share-message-shell",
    `thread-public-share-message-shell-${tone}`,
    selectable ? "is-selectable" : "",
    entering ? "is-message-entering" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <div
      className={className}
      data-thread-message-id={messageId}
      data-thread-message-role={tone}
      data-message-entering={entering ? "true" : undefined}
    >
      {selectable ? <ThreadPublicShareTurnCheckbox /> : null}
      {children}
      <MessageTimestamp />
    </div>
  );
};

const AgentUserMessage: FC = () => {
  return (
    <ThreadPublicShareMessageShell tone="user">
      <MessagePrimitive.If hasAttachments>
        <div className="aui-user-message-attachments portal-user-message-download-attachments">
          <MessagePrimitive.Attachments components={UPLOAD_AWARE_ATTACHMENT_COMPONENTS} />
        </div>
      </MessagePrimitive.If>
      <div className="portal-user-message-default-with-hidden-attachments">
        <UserMessage />
      </div>
    </ThreadPublicShareMessageShell>
  );
};

const AgentAssistantReloadButton: FC = () => {
  const aui = useAui();
  const disabled = useAuiState((s) => s.thread.isRunning || s.thread.isDisabled || s.message.role !== "assistant");
  const [open, setOpen] = useState(false);

  const confirmReload = () => {
    setOpen(false);
    aui.message().reload();
  };

  return (
    <>
      <button
        type="button"
        className="aui-button aui-button-ghost aui-button-icon assistant-reload-button"
        title="Refresh"
        aria-label="Refresh"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        <RefreshCwIcon size={16} strokeWidth={2} />
      </button>
      <Modal
        title="Regenerate this answer?"
        open={open}
        okText="Regenerate"
        cancelText="Cancel"
        onOk={confirmReload}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <p className="assistant-feedback-modal-help">The current answer will be replaced by a new response.</p>
      </Modal>
    </>
  );
};

const AgentAssistantFeedbackNegativeButton: FC = () => {
  const aui = useAui();
  const draftsRef = useContext(FeedbackCommentDraftContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const message = useAuiState((s) => s.message);
  const messageId = useAuiState((s) => s.message.id);
  const submittedType = useAuiState((s) => s.message.metadata.submittedFeedback?.type);
  const storedComment = useAuiState((s) => {
    const feedback = asRecord(asRecord(s.message.metadata.custom)?.feedback);
    return typeof feedback?.comment === "string" ? feedback.comment : "";
  });
  const [open, setOpen] = useState(false);
  const [comment, setComment] = useState("");

  const openFeedbackDialog = () => {
    const remoteId = String(activeThreadId || aui.threadListItem().getState().remoteId || "").trim();
    const cachedComment = remoteId && messageId ? feedbackCommentMemory.get(feedbackCommentKey(remoteId, messageId)) : undefined;
    setComment(cachedComment ?? draftsRef?.current.commentsByMessageId.get(messageId) ?? storedComment);
    setOpen(true);
  };

  const submitNegativeFeedback = () => {
    const normalizedComment = comment.trim();
    const remoteId = String(activeThreadId || aui.threadListItem().getState().remoteId || "").trim();
    if (!remoteId || !messageId) return;
    const cacheKey = feedbackCommentKey(remoteId, messageId);

    if (normalizedComment) {
      feedbackCommentMemory.set(cacheKey, normalizedComment);
      draftsRef?.current.commentsByMessageId.set(messageId, normalizedComment);
    } else {
      feedbackCommentMemory.delete(cacheKey);
      draftsRef?.current.commentsByMessageId.delete(messageId);
    }
    if (draftsRef) {
      draftsRef.current.skipNextSubmit = {
        messageId,
        type: "negative"
      };
    }
    void api<{ feedback: ThreadFeedbackOut }>(`/api/threads/${encodeURIComponent(remoteId)}/feedback`, {
      method: "POST",
      json: {
        type: "negative",
        message_id: messageId,
        content_preview: messageTextForSuggestions(message as ThreadMessage),
        comment: normalizedComment
      }
    })
      .then((response) => {
        const metadata = message.metadata as { custom?: Record<string, unknown> };
        const previousCustom = asRecord(metadata.custom) || {};
        metadata.custom = {
          ...previousCustom,
          feedback: {
            id: response.feedback.id,
            type: response.feedback.type,
            comment: response.feedback.comment,
            createdAt: response.feedback.created_at,
            updatedAt: response.feedback.updated_at
          }
        };
        aui.message().submitFeedback({ type: "negative" });
      })
      .catch(() => {
        if (normalizedComment) {
          feedbackCommentMemory.set(cacheKey, normalizedComment);
        } else {
          feedbackCommentMemory.delete(cacheKey);
        }
        if (
          draftsRef?.current.skipNextSubmit?.messageId === messageId &&
          draftsRef.current.skipNextSubmit.type === "negative"
        ) {
          draftsRef.current.skipNextSubmit = undefined;
        }
      });
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        className="aui-button aui-button-ghost aui-button-icon assistant-feedback-negative-button aui-assistant-action-bar-feedback-negative"
        data-submitted={submittedType === "negative" ? "true" : undefined}
        title="Bad response"
        aria-label="Bad response"
        onClick={openFeedbackDialog}
      >
        <ThumbsDownIcon size={16} strokeWidth={2} />
      </button>
      <Modal
        title="What should be improved?"
        open={open}
        className="assistant-feedback-modal"
        okText="Submit feedback"
        cancelText="Cancel"
        onOk={submitNegativeFeedback}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <p className="assistant-feedback-modal-help">
          This note will be saved with the answer so reviewers can understand the issue.
        </p>
        <div className="assistant-feedback-textarea-field">
          <Input.TextArea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 1000))}
            placeholder="For example: the answer is incomplete, a step is inaccurate, or it missed key details from an uploaded file..."
            autoSize={{ minRows: 4, maxRows: 7 }}
            maxLength={1000}
            showCount
          />
        </div>
      </Modal>
    </>
  );
};

const AgentAssistantAnswerFeedback: FC = () => {
  const aui = useAui();
  const config = useContext(AnswerFeedbackConfigContext);
  const draftsRef = useContext(FeedbackCommentDraftContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const message = useAuiState((s) => s.message);
  const messageId = useAuiState((s) => s.message.id);
  const submittedType = useAuiState((s) => s.message.metadata.submittedFeedback?.type);
  const hidden = useAuiState((s) => s.thread.isRunning || s.thread.isDisabled || s.message.role !== "assistant");
  const [pendingType, setPendingType] = useState<"positive" | "negative" | null>(null);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    setPendingType(null);
    setErrorText("");
  }, [messageId]);

  if (!config.enabled || hidden) {
    return null;
  }

  const submitAnswerFeedback = async (type: "positive" | "negative") => {
    const remoteId = String(activeThreadId || aui.threadListItem().getState().remoteId || "").trim();
    if (!remoteId || !messageId || pendingType) return;

    const cacheKey = feedbackCommentKey(remoteId, messageId);
    if (type === "positive") {
      feedbackCommentMemory.delete(cacheKey);
      draftsRef?.current.commentsByMessageId.delete(messageId);
    }
    if (draftsRef) {
      draftsRef.current.skipNextSubmit = {
        messageId,
        type
      };
    }

    setPendingType(type);
    setErrorText("");
    try {
      const response = await api<{ feedback: ThreadFeedbackOut }>(`/api/threads/${encodeURIComponent(remoteId)}/feedback`, {
        method: "POST",
        json: {
          type,
          message_id: messageId,
          content_preview: messageTextForSuggestions(message as ThreadMessage)
        }
      });
      const metadata = message.metadata as { custom?: Record<string, unknown> };
      const previousCustom = asRecord(metadata.custom) || {};
      metadata.custom = {
        ...previousCustom,
        feedback: {
          id: response.feedback.id,
          type: response.feedback.type,
          comment: response.feedback.comment,
          createdAt: response.feedback.created_at,
          updatedAt: response.feedback.updated_at
        }
      };
      aui.message().submitFeedback({ type });
    } catch (error) {
      if (
        draftsRef?.current.skipNextSubmit?.messageId === messageId &&
        draftsRef.current.skipNextSubmit.type === type
      ) {
        draftsRef.current.skipNextSubmit = undefined;
      }
      setErrorText(error instanceof Error ? error.message : "Feedback could not be saved. Try again.");
    } finally {
      setPendingType(null);
    }
  };

  return (
    <div className="assistant-answer-feedback" data-submitted={submittedType || undefined}>
      <span className="assistant-answer-feedback-prompt">{config.prompt}</span>
      <div className="assistant-answer-feedback-actions" role="group" aria-label={config.prompt}>
        <button
          type="button"
          className="assistant-answer-feedback-button"
          data-selected={submittedType === "positive" ? "true" : undefined}
          aria-pressed={submittedType === "positive"}
          disabled={Boolean(pendingType)}
          onClick={() => void submitAnswerFeedback("positive")}
        >
          <CheckIcon size={14} strokeWidth={2.4} />
          <span>Yes</span>
        </button>
        <button
          type="button"
          className="assistant-answer-feedback-button"
          data-selected={submittedType === "negative" ? "true" : undefined}
          aria-pressed={submittedType === "negative"}
          disabled={Boolean(pendingType)}
          onClick={() => void submitAnswerFeedback("negative")}
        >
          <XIcon size={14} strokeWidth={2.4} />
          <span>No</span>
        </button>
      </div>
      {submittedType ? <span className="assistant-answer-feedback-thanks">Thanks for the feedback.</span> : null}
      {errorText ? <span className="assistant-answer-feedback-error">{errorText}</span> : null}
    </div>
  );
};

const AgentAssistantActionBar: FC = () => {
  return (
    <AssistantActionBar.Root hideWhenRunning autohide="not-last" autohideFloat="single-branch">
      <AssistantActionBar.Copy />
      <AgentAssistantReloadButton />
      <AssistantActionBar.FeedbackPositive />
      <AgentAssistantFeedbackNegativeButton />
    </AssistantActionBar.Root>
  );
};

const AgentAssistantMessage: FC = () => {
  return (
    <ThreadPublicShareMessageShell tone="assistant">
      <AssistantMessage.Root>
        <AssistantMessage.Avatar />
        <AssistantMessage.Content
          components={{
            Text: AssistantMarkdownText,
            Empty: AssistantMessageEmpty as any,
            Reasoning: ReasoningPart as any,
            Source: SourcePart as any,
            data: { Fallback: ProcessDataFallback as any }
          }}
        />
        <BranchPicker />
        <AgentAssistantAnswerFeedback />
        <AgentAssistantActionBar />
      </AssistantMessage.Root>
    </ThreadPublicShareMessageShell>
  );
};

const AgentThreadListItem: FC = () => {
  const aui = useAui();
  const isMobileWorkbench = useContext(MobileWorkbenchContext);
  const runningThreadIds = useContext(RunningThreadIdsContext);
  const { completedThreadIds, clearCompletedThreadNotice } = useContext(ThreadCompletionNoticeContext);
  const threadItemId = useAuiState((s) => s.threadListItem.id);
  const threadRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadExternalId = useAuiState((s) => s.threadListItem.externalId);
  const threadTitle = useAuiState((s) => (typeof s.threadListItem.title === "string" ? s.threadListItem.title : ""));
  const isAuiActiveThread = useAuiState((s) => s.threads.mainThreadId === s.threadListItem.id);
  const sessionSearchQuery = useContext(SessionSearchContext).trim().toLowerCase();
  const groupHeaderByRemoteId = useContext(SessionGroupLabelContext).groupHeaderByRemoteId;
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const remoteId = String(threadRemoteId || "").trim();
  const externalId = String(threadExternalId || "").trim();
  const localId = String(threadItemId || "").trim();
  const identityKeys = useMemo(() => normalizeThreadIdentityKeys(remoteId, externalId, localId), [externalId, localId, remoteId]);
  const isThreadActive = isAuiActiveThread;
  const isThreadRunning = identityKeys.some((key) => Boolean(runningThreadIds[key]));
  const hasCompletionNotice =
    !isThreadRunning && !isThreadActive && identityKeys.some((key) => Boolean(completedThreadIds[key]));
  const groupLabel = resolveThreadGroupHeader(groupHeaderByRemoteId, remoteId, externalId, localId);
  const threadTitleForFilter = threadTitle.trim() || "New conversation";

  useEffect(() => {
    if (!isThreadActive || identityKeys.length === 0) return;
    clearCompletedThreadNotice(...identityKeys);
  }, [clearCompletedThreadNotice, completedThreadIds, identityKeys, isThreadActive]);

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

  const openRename = () => {
    if (renameSaving) return;
    setRenameDraft(threadTitle.trim());
    setIsRenaming(true);
  };

  const beginRename = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    openRename();
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
      const detail = error instanceof Error ? error.message : "Failed to rename session";
      window.alert(detail);
    } finally {
      setRenameSaving(false);
    }
  };

  const deleteCurrentThread = async () => {
    if (renameSaving) return;
    const confirmed = window.confirm("Permanently delete this session? This action cannot be undone.");
    if (!confirmed) return;
    try {
      await aui.threadListItem().delete();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Failed to delete session";
      window.alert(detail);
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
    <>
      {!sessionSearchQuery && groupLabel ? <p className="session-rail-group-divider">{groupLabel}</p> : null}
      <ThreadListItemPrimitive.Root
        className="aui-thread-list-item agent-thread-list-item"
        data-portal-active={isThreadActive ? "true" : undefined}
      >
        <span className="thread-running-indicator-slot" aria-hidden="true">
          {isThreadRunning ? (
            <span className="thread-running-indicator" />
          ) : hasCompletionNotice ? (
            <span className="thread-complete-indicator" />
          ) : null}
        </span>
        {isRenaming ? (
          <div className="thread-title-edit-wrap" onClick={(event) => event.stopPropagation()}>
            <input
              ref={renameInputRef}
              className="thread-title-edit-input"
              value={renameDraft}
              onChange={(event) => setRenameDraft(event.target.value)}
              onKeyDown={onRenameInputKeyDown}
              placeholder="Enter session name"
              disabled={renameSaving}
            />
          </div>
        ) : (
          <ThreadListItemPrimitive.Trigger
            className="aui-thread-list-item-trigger"
            onClick={() => clearCompletedThreadNotice(...identityKeys)}
          >
            <p className="aui-thread-list-item-title">
              <ThreadListItemPrimitive.Title fallback="New conversation" />
            </p>
          </ThreadListItemPrimitive.Trigger>
        )}
        <div className="agent-thread-item-actions">
          {isRenaming ? (
            <>
              <button
                type="button"
                className="thread-item-action-btn thread-item-save-btn"
                title="Save session name"
                aria-label="Save session name"
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
                title="Cancel edit"
                aria-label="Cancel edit"
                onClick={cancelRename}
                disabled={renameSaving}
              >
                <XIcon size={14} />
              </button>
            </>
          ) : isMobileWorkbench ? (
            <Dropdown
              trigger={["click"]}
              placement="bottomRight"
              menu={{
                items: [
                  { key: "rename", label: "Rename session" },
                  { key: "delete", label: "Delete session", danger: true }
                ],
                onClick: ({ key, domEvent }) => {
                  domEvent.preventDefault();
                  domEvent.stopPropagation();
                  if (key === "rename") {
                    openRename();
                    return;
                  }
                  void deleteCurrentThread();
                }
              }}
            >
              <button
                type="button"
                className="thread-item-action-btn thread-item-more-btn"
                title="More session actions"
                aria-label="More session actions"
                onClick={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                }}
              >
                <MoreHorizontalIcon size={16} />
              </button>
            </Dropdown>
          ) : (
            <>
              <button
                type="button"
                className="thread-item-action-btn"
                title="Rename session"
                aria-label="Rename session"
                onClick={beginRename}
              >
                <PencilIcon size={14} />
              </button>
              <ThreadListItemPrimitive.Delete
                className="thread-item-action-btn thread-item-delete-btn"
                title="Delete session"
                aria-label="Delete session"
                disabled={isRenaming}
                onClick={(e) => {
                  const confirmed = window.confirm("Permanently delete this session? This action cannot be undone.");
                  if (!confirmed) {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              >
                <Trash2Icon size={14} />
              </ThreadListItemPrimitive.Delete>
            </>
          )}
        </div>
      </ThreadListItemPrimitive.Root>
    </>
  );
};

const ThreadListItemByIdProvider: FC<PropsWithChildren<{ threadId: string }>> = ({ threadId, children }) => {
  const aui = useAui({
    threadListItem: Derived({
      source: "threads",
      query: { type: "id", id: threadId },
      get: (aui) => aui.threads().item({ id: threadId })
    })
  });

  return <AuiProvider value={aui}>{children}</AuiProvider>;
};

const StableThreadListItems: FC = () => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const stableThreadIds = useMemo(() => {
    const itemById = new Map(threadItems.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const result: string[] = [];
    for (const threadId of threadIds) {
      if (!threadId) continue;
      const item = itemById.get(threadId);
      const identities = [item?.externalId, item?.remoteId, threadId]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      if (identities.length === 0 || identities.some((identity) => seen.has(identity))) continue;
      identities.forEach((identity) => seen.add(identity));
      result.push(threadId);
    }
    return result;
  }, [threadIds, threadItems]);

  return (
    <>
      {stableThreadIds.map((threadId) => (
        <ThreadListItemByIdProvider key={threadId} threadId={threadId}>
          <AgentThreadListItem />
        </ThreadListItemByIdProvider>
      ))}
    </>
  );
};

type ThreadQuestionJumpItem = {
  id: string;
  index: number;
  label: string;
};

function buildThreadQuestionJumpItems(messages: readonly ThreadMessage[]): ThreadQuestionJumpItem[] {
  let questionIndex = 0;
  return messages
    .filter((message) => message.role === "user")
    .map((message) => {
      questionIndex += 1;
      const text = userTextFromUnknownMessage(message)
        .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, "attached file")
        .replace(/\s+/g, " ")
        .trim();
      return {
        id: message.id,
        index: questionIndex,
        label: text || `Question ${questionIndex}`
      };
    })
    .filter((item) => item.id);
}

function findThreadQuestionElement(shell: HTMLElement, messageId: string): HTMLElement | null {
  const nodes = shell.querySelectorAll<HTMLElement>(
    '.thread-public-share-message-shell-user[data-thread-message-id]'
  );
  for (const node of nodes) {
    if (node.dataset.threadMessageId === messageId) return node;
  }
  return null;
}

const ThreadQuestionNavigator: FC<{
  messages: readonly ThreadMessage[];
  shellRef: MutableRefObject<HTMLDivElement | null>;
  disabled?: boolean;
}> = ({ messages, shellRef, disabled }) => {
  const items = useMemo(() => buildThreadQuestionJumpItems(messages), [messages]);
  const [activeId, setActiveId] = useState("");
  const [hoveredId, setHoveredId] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const closeTimerRef = useRef<number | null>(null);
  const navRef = useRef<HTMLElement | null>(null);
  const panelListRef = useRef<HTMLDivElement | null>(null);
  const selectedId = hoveredId || activeId || items[0]?.id || "";

  const refresh = useCallback(() => {
    const shell = shellRef.current;
    if (!shell || items.length < 2) return;
    const viewport = shell.querySelector<HTMLElement>(".aui-thread-viewport");
    if (!viewport) return;

    const viewportRect = viewport.getBoundingClientRect();
    let nextActiveId = items[0]?.id || "";
    let bestDistance = Number.POSITIVE_INFINITY;
    const activeLine = viewport.scrollTop + Math.min(240, viewport.clientHeight * 0.55);

    for (const item of items) {
      const element = findThreadQuestionElement(shell, item.id);
      if (!element) continue;
      const rect = element.getBoundingClientRect();
      const topInScroll = viewport.scrollTop + rect.top - viewportRect.top;
      const distance = Math.abs(topInScroll - activeLine);
      if (topInScroll <= activeLine && distance <= bestDistance) {
        bestDistance = distance;
        nextActiveId = item.id;
      }
    }

    setActiveId((current) => (current === nextActiveId ? current : nextActiveId));
  }, [items, shellRef]);

  useEffect(() => {
    if (disabled || items.length < 2) return;
    const shell = shellRef.current;
    if (!shell) return;
    const viewport = shell.querySelector<HTMLElement>(".aui-thread-viewport");
    if (!viewport) return;

    let frame = 0;
    const scheduleRefresh = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(refresh);
    };

    scheduleRefresh();
    const laterRefresh = window.setTimeout(scheduleRefresh, 250);
    viewport.addEventListener("scroll", scheduleRefresh, { passive: true });
    window.addEventListener("resize", scheduleRefresh);

    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(scheduleRefresh) : null;
    resizeObserver?.observe(viewport);

    const mutationObserver = typeof MutationObserver !== "undefined" ? new MutationObserver(scheduleRefresh) : null;
    mutationObserver?.observe(viewport, {
      childList: true,
      subtree: true,
      characterData: true
    });

    return () => {
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(laterRefresh);
      viewport.removeEventListener("scroll", scheduleRefresh);
      window.removeEventListener("resize", scheduleRefresh);
      resizeObserver?.disconnect();
      mutationObserver?.disconnect();
    };
  }, [disabled, items.length, refresh, shellRef]);

  useEffect(() => {
    setPanelOpen(false);
    setHoveredId("");
  }, [items.length]);

  useEffect(() => {
    return () => {
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!panelOpen || !selectedId) return;
    const frame = window.requestAnimationFrame(() => {
      const row = panelListRef.current?.querySelector<HTMLElement>('[data-question-nav-row-selected="true"]');
      row?.scrollIntoView({ block: "nearest" });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [panelOpen, selectedId]);

  const cancelPanelClose = useCallback(() => {
    if (closeTimerRef.current === null) return;
    window.clearTimeout(closeTimerRef.current);
    closeTimerRef.current = null;
  }, []);

  const schedulePanelClose = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
    }
    closeTimerRef.current = window.setTimeout(() => {
      setPanelOpen(false);
      setHoveredId("");
      closeTimerRef.current = null;
    }, 260);
  }, []);

  const closePanelNow = useCallback(() => {
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    setPanelOpen(false);
    setHoveredId("");
  }, []);

  useEffect(() => {
    if (!panelOpen) return;

    const isInsideNavigator = (target: EventTarget | null) => {
      return target instanceof Node && Boolean(navRef.current?.contains(target));
    };

    const handlePointerMove = (event: PointerEvent) => {
      if (isInsideNavigator(event.target)) {
        cancelPanelClose();
        return;
      }
      schedulePanelClose();
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (isInsideNavigator(event.target)) return;
      closePanelNow();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        closePanelNow();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: true });
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [cancelPanelClose, closePanelNow, panelOpen, schedulePanelClose]);

  const openPanelForQuestion = useCallback(
    (messageId?: string) => {
      cancelPanelClose();
      setHoveredId(messageId || activeId || items[0]?.id || "");
      setPanelOpen(true);
    },
    [activeId, cancelPanelClose, items]
  );

  const jumpToQuestion = useCallback(
    (messageId: string) => {
      const shell = shellRef.current;
      if (!shell) return;
      const element = findThreadQuestionElement(shell, messageId);
      if (!element) return;
      element.scrollIntoView({
        behavior: "smooth",
        block: "center"
      });
      setActiveId(messageId);
      setHoveredId(messageId);
      setPanelOpen(true);
    },
    [shellRef]
  );

  if (disabled || items.length < 2) return null;

  return (
    <nav
      ref={navRef}
      className={`thread-question-nav ${panelOpen ? "is-open" : ""}`}
      aria-label="Question quick jump"
      onMouseEnter={() => openPanelForQuestion()}
      onMouseLeave={schedulePanelClose}
    >
      <div className="thread-question-nav-track" onMouseEnter={() => openPanelForQuestion()}>
        {items.map((item, index) => {
          const fallbackTop = items.length === 1 ? 0 : (index / (items.length - 1)) * 100;
          const current = item.id === activeId;
          const selected = item.id === selectedId;
          return (
            <button
              key={item.id}
              type="button"
              className={`thread-question-nav-marker ${selected ? "is-selected" : ""}`}
              style={{ top: `${fallbackTop}%` }}
              aria-label={`Jump to question ${item.index}: ${item.label}`}
              aria-current={current ? "location" : undefined}
              title={item.label}
              onMouseEnter={() => openPanelForQuestion(item.id)}
              onClick={() => jumpToQuestion(item.id)}
              onFocus={() => openPanelForQuestion(item.id)}
            />
          );
        })}
      </div>
      <div className="thread-question-nav-panel" onMouseEnter={cancelPanelClose} onMouseLeave={schedulePanelClose}>
        <div className="thread-question-nav-panel-list" ref={panelListRef}>
          {items.map((item) => {
            const selected = item.id === selectedId;
            return (
              <button
                key={item.id}
                type="button"
                className={`thread-question-nav-row ${selected ? "is-selected" : ""}`}
                data-question-nav-row-selected={selected ? "true" : undefined}
                aria-current={item.id === activeId ? "location" : undefined}
                onClick={() => jumpToQuestion(item.id)}
                title={item.label}
              >
                <span className="thread-question-nav-row-text">{item.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </nav>
  );
};

const ThreadPublicShareControls: FC<
  PropsWithChildren<{
    threadId: string;
    disabled: boolean;
    onStatusChange?: (text: string) => void;
  }>
> = ({ threadId, disabled, onStatusChange, children }) => {
  const messages = useAuiState((s) => s.thread.messages);
  const threadRunning = useAuiState((s) => s.thread.isRunning);
  const threadLoading = useAuiState((s) => s.thread.isLoading);
  const localThreadId = useAuiState((s) => s.threadListItem.id);
  const messageEntryThreadKeyRef = useRef("");
  const messageEntryHydratedRef = useRef(false);
  const knownMessageIdsRef = useRef<Set<string>>(new Set());
  const messageEntryClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [enteringMessageIdList, setEnteringMessageIdList] = useState<string[]>([]);
  const turns = useMemo(() => groupThreadMessagesIntoPublicShareTurns(messages), [messages]);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedTurnIds, setSelectedTurnIds] = useState<string[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  const allTurnIds = useMemo(() => turns.map((turn) => turn.id), [turns]);
  const leadTurnIdByMessageId = useMemo(
    () =>
      turns.reduce<Record<string, string>>((acc, turn) => {
        acc[turn.leadMessageId] = turn.id;
        return acc;
      }, {}),
    [turns]
  );
  const selectedTurnIdSet = useMemo(() => new Set(selectedTurnIds), [selectedTurnIds]);
  useEffect(() => {
    const localThreadKey = String(localThreadId || "").trim();
    const remoteThreadKey = String(threadId || "").trim();
    const threadKey = localThreadKey || remoteThreadKey || "draft";
    const nextMessageIds = new Set(
      messages.map((message) => String(message.id || "").trim()).filter(Boolean)
    );
    const threadChanged = messageEntryThreadKeyRef.current !== threadKey;

    if (threadChanged) {
      messageEntryThreadKeyRef.current = threadKey;
      messageEntryHydratedRef.current = !threadLoading;
      knownMessageIdsRef.current = nextMessageIds;
      if (messageEntryClearTimerRef.current !== null) {
        clearTimeout(messageEntryClearTimerRef.current);
        messageEntryClearTimerRef.current = null;
      }
      setEnteringMessageIdList([]);
      return;
    }

    if (threadLoading || !messageEntryHydratedRef.current) {
      if (!threadLoading) {
        messageEntryHydratedRef.current = true;
      }
      knownMessageIdsRef.current = nextMessageIds;
      setEnteringMessageIdList([]);
      return;
    }

    if (!threadRunning) {
      knownMessageIdsRef.current = nextMessageIds;
      if (messageEntryClearTimerRef.current !== null) {
        clearTimeout(messageEntryClearTimerRef.current);
        messageEntryClearTimerRef.current = null;
      }
      setEnteringMessageIdList((prev) => (prev.length === 0 ? prev : []));
      return;
    }

    const enteringMessageIds: string[] = [];
    for (const messageId of nextMessageIds) {
      if (!knownMessageIdsRef.current.has(messageId)) {
        enteringMessageIds.push(messageId);
      }
    }
    knownMessageIdsRef.current = nextMessageIds;
    if (enteringMessageIds.length === 0) return;

    setEnteringMessageIdList((prev) => [...new Set([...prev, ...enteringMessageIds])]);
    if (messageEntryClearTimerRef.current !== null) {
      clearTimeout(messageEntryClearTimerRef.current);
    }
    messageEntryClearTimerRef.current = setTimeout(() => {
      setEnteringMessageIdList([]);
      messageEntryClearTimerRef.current = null;
    }, 720);
  }, [localThreadId, messages, threadId, threadLoading, threadRunning]);

  useEffect(() => {
    return () => {
      if (messageEntryClearTimerRef.current !== null) {
        clearTimeout(messageEntryClearTimerRef.current);
      }
    };
  }, []);

  const messageEntryAnimationContext = useMemo<MessageEntryAnimationContextValue>(
    () => ({ enteringMessageIds: new Set(enteringMessageIdList) }),
    [enteringMessageIdList]
  );

  useEffect(() => {
    setSelectionMode(false);
    setSelectedTurnIds([]);
    setConfirmOpen(false);
    setSubmitting(false);
    setErrorText("");
  }, [threadId]);

  useEffect(() => {
    if (!selectionMode) return;
    const available = new Set(allTurnIds);
    setSelectedTurnIds((prev) => {
      const next = prev.filter((turnId) => available.has(turnId));
      return next.length === prev.length && next.every((turnId, index) => turnId === prev[index]) ? prev : next;
    });
    if (allTurnIds.length === 0) {
      setSelectionMode(false);
      setConfirmOpen(false);
    }
  }, [allTurnIds, selectionMode]);

  const toggleTurnSelection = useCallback(
    (turnId: string) => {
      setErrorText("");
      setSelectedTurnIds((prev) => {
        const set = new Set(prev);
        if (set.has(turnId)) {
          set.delete(turnId);
        } else {
          set.add(turnId);
        }
        return allTurnIds.filter((id) => set.has(id));
      });
    },
    [allTurnIds]
  );

  const enterSelectionMode = () => {
    if (!threadId || disabled || threadRunning || allTurnIds.length === 0) return;
    setSelectionMode(true);
    setSelectedTurnIds(allTurnIds);
    setConfirmOpen(false);
    setErrorText("");
  };

  const cancelSelectionMode = () => {
    setSelectionMode(false);
    setSelectedTurnIds([]);
    setConfirmOpen(false);
    setSubmitting(false);
    setErrorText("");
  };

  const selectAllTurns = () => {
    setErrorText("");
    setSelectedTurnIds(allTurnIds);
  };

  const createAndCopyPublicLink = async () => {
    if (!threadId || selectedTurnIds.length === 0 || submitting) return;
    setSubmitting(true);
    setErrorText("");
    try {
      const share = await createThreadPublicShare(threadId, selectedTurnIds);
      const publicUrl = resolveThreadPublicShareUrl(share.public_path);
      await copyTextToClipboard(publicUrl);
      onStatusChange?.("Public link created and copied");
      cancelSelectionMode();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to create public link");
    } finally {
      setSubmitting(false);
    }
  };

  const selectionContext = useMemo<ThreadPublicShareSelectionContextValue>(
    () => ({
      selectionMode,
      leadTurnIdByMessageId,
      selectedTurnIds: selectedTurnIdSet,
      toggleTurnSelection
    }),
    [selectionMode, leadTurnIdByMessageId, selectedTurnIdSet, toggleTurnSelection]
  );

  const shareActionDisabled = !threadId || disabled || threadRunning || allTurnIds.length === 0;

  return (
    <ThreadPublicShareSelectionContext.Provider value={selectionContext}>
      <MessageEntryAnimationContext.Provider value={messageEntryAnimationContext}>
        <div
          ref={shellRef}
          className="thread-public-share-shell"
          data-share-selection-mode={selectionMode ? "true" : "false"}
        >
          {children}
          <ThreadQuestionNavigator messages={messages} shellRef={shellRef} disabled={selectionMode} />
          {!selectionMode && threadId && !disabled ? (
            <div className="thread-public-share-toolbar">
              <button
                type="button"
                className="thread-public-share-toolbar-btn"
                onClick={enterSelectionMode}
                disabled={shareActionDisabled}
                title={threadRunning ? "Thread is running. Create a public link later." : "Create public link"}
              >
                <Share2Icon size={16} />
                <span>Create public link</span>
              </button>
            </div>
          ) : null}

          {selectionMode ? (
            <div className="thread-public-share-actionbar">
              <div className="thread-public-share-actionbar-meta">
                <button
                  type="button"
                  className="thread-public-share-actionbar-link"
                  onClick={selectAllTurns}
                  disabled={submitting || selectedTurnIds.length === allTurnIds.length}
                >
                  Select all
                </button>
                <span>{selectedTurnIds.length} conversation turn selected</span>
              </div>
              <div className="thread-public-share-actionbar-actions">
                <button type="button" className="thread-public-share-secondary-btn" onClick={cancelSelectionMode} disabled={submitting}>
                  Cancel
                </button>
                <button
                  type="button"
                  className="thread-public-share-primary-btn"
                  onClick={() => setConfirmOpen(true)}
                  disabled={submitting || selectedTurnIds.length === 0}
                >
                  Create public link
                </button>
              </div>
            </div>
          ) : null}

          {confirmOpen ? (
            <div
              className="thread-public-share-modal-mask"
              onClick={() => {
                if (submitting) return;
                setConfirmOpen(false);
              }}
            >
              <div className="thread-public-share-modal" onClick={(event) => event.stopPropagation()}>
                <div className="thread-public-share-modal-head">
                  <h3>Create public link</h3>
                  <button
                    type="button"
                    className="thread-public-share-close-btn"
                    onClick={() => setConfirmOpen(false)}
                    disabled={submitting}
                    aria-label="Close public link confirmation dialog"
                  >
                    <XIcon size={18} />
                  </button>
                </div>
                <p className="thread-public-share-modal-copy">
                  Anyone with the link can view the conversation you&apos;ve shared. Please check for sensitive or private
                  content before continuing.
                </p>
                {errorText ? <p className="field-error thread-public-share-modal-error">{errorText}</p> : null}
                <button
                  type="button"
                  className="thread-public-share-modal-primary"
                  onClick={() => void createAndCopyPublicLink()}
                  disabled={submitting || selectedTurnIds.length === 0}
                >
                  {submitting ? "Creating..." : "Create and copy"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </MessageEntryAnimationContext.Provider>
    </ThreadPublicShareSelectionContext.Provider>
  );
};

const ComposerActivationGuard: FC<{ runtime: unknown }> = ({ runtime }) => {
  const aui = useAui();
  const threadItemId = useAuiState((s) => s.threadListItem.id);
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const isComposerEditing = useAuiState((s) => s.composer.isEditing);
  const threadLoading = useAuiState((s) => s.thread.isLoading);
  const recoverRef = useRef<{ threadId: string; attempts: number }>({
    threadId: "",
    attempts: 0
  });

  useEffect(() => {
    if (threadLoading || isComposerEditing) {
      recoverRef.current = { threadId: "", attempts: 0 };
      return;
    }

    const normalizedThreadId = String(threadItemId || mainThreadId || "").trim();
    if (!normalizedThreadId) return;

    if (recoverRef.current.threadId !== normalizedThreadId) {
      recoverRef.current = { threadId: normalizedThreadId, attempts: 0 };
    }

    if (recoverRef.current.attempts >= 3) return;
    recoverRef.current.attempts += 1;
    const attempt = recoverRef.current.attempts;

    const timer = window.setTimeout(() => {
      try {
        const currentThreadId = String(aui.threadListItem().getState().id || "").trim();
        if (currentThreadId !== normalizedThreadId) return;
        if (aui.composer().getState().isEditing) return;
        if (attempt >= 2) {
          // Hard recovery path: rebuild runtime binding for current thread if it got stuck in no-op state.
          const threadsCore = (runtime as { _core?: { threads?: any } } | undefined)?._core?.threads as
            | { _hookManager?: { stopThreadRuntime(threadId: string): void; startThreadRuntime(threadId: string): Promise<unknown> } }
            | undefined;
          const hookManager = threadsCore?._hookManager;
          if (hookManager) {
            try {
              hookManager.stopThreadRuntime(normalizedThreadId);
              void hookManager.startThreadRuntime(normalizedThreadId);
            } catch {
              // ignore internal runtime restart errors
            }
          }
        }
        aui.threadListItem().switchTo();
      } catch {
        // Ignore transient runtime timing errors and wait for next state tick.
      }
    }, attempt === 1 ? 0 : attempt === 2 ? 120 : 240);

    return () => window.clearTimeout(timer);
  }, [aui, isComposerEditing, mainThreadId, runtime, threadItemId, threadLoading]);

  return null;
};

const ThreadRuntimeSubscriptionBridge: FC<{ runtime: unknown }> = ({ runtime }) => {
  useEffect(() => {
    const threadsCore = (runtime as { _core?: { threads?: unknown } } | undefined)?._core?.threads as
      | { _hookManager?: { subscribe(callback: () => void): () => void }; _notifySubscribers?: () => void }
      | undefined;
    const hookManager = threadsCore?._hookManager;
    const notifySubscribers = threadsCore?._notifySubscribers;
    if (!hookManager || typeof hookManager.subscribe !== "function" || typeof notifySubscribers !== "function") {
      return undefined;
    }

    return hookManager.subscribe(() => {
      // assistant-ui replaces per-thread runtimes without notifying outer thread-list subscribers.
      notifySubscribers.call(threadsCore);
    });
  }, [runtime]);

  return null;
};

const ActiveThreadIdentityBridge: FC<{ onChange: (identity: ThreadIdentity) => void }> = ({ onChange }) => {
  const mainThreadId = useAuiState((s) => s.threads.mainThreadId);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const activeThreadItem = useMemo(
    () => threadItems.find((item) => item.id === mainThreadId) || null,
    [mainThreadId, threadItems]
  );
  const activeLocalId = String(activeThreadItem?.id || mainThreadId || "").trim();
  const activeRemoteId = String(activeThreadItem?.remoteId || "").trim();

  useEffect(() => {
    onChange({
      remoteId: activeRemoteId || undefined,
      localId: activeLocalId || undefined
    });
  }, [activeLocalId, activeRemoteId, onChange]);

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
  const autoTitleAppliedRemoteIdsRef = useRef<Set<string>>(new Set());
  const feedbackCommentDraftsRef = useRef<FeedbackCommentDraftStore>({
    commentsByMessageId: new Map<string, string>()
  });

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
        const feedbackByMessageId = new Map<string, ThreadFeedbackOut>();
        for (const item of out.feedback ?? []) {
          const messageId = typeof item.message_id === "string" ? item.message_id.trim() : "";
          if (!messageId) continue;
          const previous = feedbackByMessageId.get(messageId);
          const previousTime = Date.parse(previous?.updated_at || previous?.created_at || "");
          const itemTime = Date.parse(item.updated_at || item.created_at || "");
          if (!previous || itemTime >= previousTime) {
            feedbackByMessageId.set(messageId, item);
          }
        }
        const repository: ExportedMessageRepository = {
          headId: out.head_id ?? null,
          messages: (out.messages || []).map((item) => {
            const revived = reviveMessage(item.message, item.created_at);
            const messageId = typeof asRecord(revived)?.id === "string" ? String(asRecord(revived)?.id).trim() : "";
            return {
              parentId: item.parent_id ?? null,
              message: applyStoredFeedback(revived, messageId ? feedbackByMessageId.get(messageId) : undefined) as any,
              ...(item.run_config ? { runConfig: item.run_config } : undefined)
            };
          })
        };
        return repository;
      },
      async append(item: ExportedMessageRepositoryItem) {
        const init = await aui.threadListItem().initialize();
        const remoteId = init.remoteId;
        const state = aui.threadListItem().getState();
        const messageForPersistence = sanitizeMessageForPersistence(item.message);
        const hasTitle = !isPlaceholderThreadTitle(typeof state.title === "string" ? state.title : "");
        const firstUserText = userTextFromUnknownMessage(messageForPersistence);
        const optimisticTitle = guessThreadTitleFromText(firstUserText);
        const shouldGenerateTitle =
          !hasTitle &&
          !!firstUserText &&
          !isPlaceholderThreadTitle(optimisticTitle) &&
          !autoTitleAppliedRemoteIdsRef.current.has(remoteId);
        if (shouldGenerateTitle) {
          autoTitleAppliedRemoteIdsRef.current.add(remoteId);
          const renameResult = (aui.threadListItem().rename as unknown as (newTitle: string) => Promise<void> | void)(
            optimisticTitle
          );
          if (renameResult && typeof renameResult.catch === "function") {
            void renameResult.catch(() => {
              autoTitleAppliedRemoteIdsRef.current.delete(remoteId);
            });
          }
        }
        await api(`/api/threads/${encodeURIComponent(remoteId)}/messages`, {
          method: "POST",
          json: {
            parent_id: item.parentId ?? null,
            message: messageForPersistence,
            run_config: item.runConfig
          }
        });
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
        const messageId = payload.message.id;
        const store = feedbackCommentDraftsRef.current;
        if (store.skipNextSubmit?.messageId === messageId && store.skipNextSubmit.type === payload.type) {
          store.skipNextSubmit = undefined;
          return;
        }
        const comment = payload.type === "negative" ? store.commentsByMessageId.get(messageId)?.trim() || undefined : undefined;
        const cacheKey = feedbackCommentKey(remoteId, messageId);
        if (payload.type === "negative") {
          if (comment) {
            feedbackCommentMemory.set(cacheKey, comment);
            store.commentsByMessageId.set(messageId, comment);
          } else {
            feedbackCommentMemory.delete(cacheKey);
            store.commentsByMessageId.delete(messageId);
          }
        } else {
          feedbackCommentMemory.delete(cacheKey);
          store.commentsByMessageId.delete(messageId);
        }
        void api(`/api/threads/${encodeURIComponent(remoteId)}/feedback`, {
          method: "POST",
          json: {
            type: payload.type,
            message_id: messageId,
            content_preview: preview,
            ...(comment ? { comment } : {})
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

  return (
    <FeedbackCommentDraftContext.Provider value={feedbackCommentDraftsRef}>
      <RuntimeAdapterProvider adapters={adapters}>{children}</RuntimeAdapterProvider>
    </FeedbackCommentDraftContext.Provider>
  );
};

export function PortalShell(props: { currentUser?: AuthUser; onOpenAdmin?: () => void; onSignOut?: () => void }) {
  const auth = useAuth();
  const { branding, behavior } = useBranding();
  const portalPreferenceUser = props.currentUser ?? auth.user ?? null;
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
  const [subscriptionStatus, setSubscriptionStatus] = useState<PortalSubscriptionStatus | null>(null);
  const [subscriptionStatusLoading, setSubscriptionStatusLoading] = useState(false);
  const [subscriptionStatusError, setSubscriptionStatusError] = useState("");
  const [runtimeMode, setRuntimeMode] = useState("standard");
  const [layoutState, setLayoutState] = useState(() => {
    const initial = createInitialLayoutState();
    if (!isNarrowScreen(768)) return initial;
    return {
      ...initial,
      isSessionRailCollapsed: true
    };
  });
  const isMobile = useIsNarrowScreen(768);

  useEffect(() => {
    document.body.classList.add("portal-workbench-mode");
    return () => {
      document.body.classList.remove("portal-workbench-mode");
    };
  }, []);

  useEffect(() => {
    if (!isMobile) return;
    setLayoutState((prev) => (prev.isSessionRailCollapsed ? prev : { ...prev, isSessionRailCollapsed: true }));
  }, [isMobile]);
  const [sessionSearchValue, setSessionSearchValue] = useState("");
  const [sessionGroupLabelContext, setSessionGroupLabelContext] = useState<SessionGroupLabelContextValue>({
    groupHeaderByRemoteId: {}
  });
  const [activeRunThreadIds, setActiveRunThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [runtimeRunningThreadIds, setRuntimeRunningThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [completedNoticeThreadIds, setCompletedNoticeThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [activeThreadIdentity, setActiveThreadIdentity] = useState<ThreadIdentity>({});

  useEffect(() => {
    if (isMobile) {
      setLayoutState(prev => prev.isSessionRailCollapsed ? prev : { ...prev, isSessionRailCollapsed: true });
    }
  }, [activeThreadIdentity.remoteId, isMobile]);

  const [threadCollaboration, setThreadCollaboration] = useState<ThreadCollaborationView | null>(null);
  const [threadCollaborationLoading, setThreadCollaborationLoading] = useState(false);
  const [, setThreadCollaborationErrorText] = useState("");
  const [requestedPreviewPath, setRequestedPreviewPath] = useState("");
  const [previewRequestNonce, setPreviewRequestNonce] = useState(0);
  const [productFeedbackOpen, setProductFeedbackOpen] = useState(false);
  const [productFeedbackType, setProductFeedbackType] = useState<ProductFeedbackType>("usability_issue");
  const [productFeedbackSeverity, setProductFeedbackSeverity] = useState<ProductFeedbackSeverity>("medium");
  const [productFeedbackDescription, setProductFeedbackDescription] = useState("");
  const [productFeedbackImages, setProductFeedbackImages] = useState<ProductFeedbackImageDraft[]>([]);
  const [productFeedbackPreviewImage, setProductFeedbackPreviewImage] = useState<ProductFeedbackImageDraft | null>(null);
  const [productFeedbackIncludeContext, setProductFeedbackIncludeContext] = useState(true);
  const [productFeedbackSubmitting, setProductFeedbackSubmitting] = useState(false);
  const [productFeedbackError, setProductFeedbackError] = useState("");
  const [productFeedbackSubmitted, setProductFeedbackSubmitted] = useState(false);
  const runningThreadIds = useMemo(
    () => mergeRunningThreadMaps(activeRunThreadIds, runtimeRunningThreadIds),
    [activeRunThreadIds, runtimeRunningThreadIds]
  );
  const clearCompletedThreadNotice = useCallback((...threadIds: Array<string | undefined | null>) => {
    const keys = normalizeThreadIdentityKeys(...threadIds);
    if (keys.length === 0) return;
    setCompletedNoticeThreadIds((prev) => updateRunningThreadMapForKeys(prev, keys, false));
  }, []);
  const threadCompletionNoticeContext = useMemo<ThreadCompletionNoticeContextValue>(
    () => ({
      completedThreadIds: completedNoticeThreadIds,
      clearCompletedThreadNotice
    }),
    [clearCompletedThreadNotice, completedNoticeThreadIds]
  );

  const [statusText, setStatusText] = useState("Ready");
  const [runningStageText, setRunningStageText] = useState(DEFAULT_RUNNING_STAGE_TEXT);
  const [errorText, setErrorText] = useState("");
  const [resourceErrorText, setResourceErrorText] = useState("");
  const [showProcessTrace, setShowProcessTrace] = useState(() => resolveShowProcessTracePreference(portalPreferenceUser));
  const [collapseFinalTraceOnDone, setCollapseFinalTraceOnDone] = useState(() =>
    resolveCollapseFinalTraceOnDonePreference(portalPreferenceUser)
  );
  const [portalPreferenceSaving, setPortalPreferenceSaving] = useState(false);
  const [portalPreferenceErrorText, setPortalPreferenceErrorText] = useState("");
  const [contextUsage, setContextUsage] = useState<ContextUsageSnapshot | null>(null);
  const [selectedKnowledgeSetIds, setSelectedKnowledgeSetIds] = useState<string[]>([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<DirectoryPickerTarget>("workspace");
  const [pickerLoading, setPickerLoading] = useState(false);
  const [pickerError, setPickerError] = useState("");
  const [pickerRoots, setPickerRoots] = useState<string[]>([]);
  const [pickerCwd, setPickerCwd] = useState("");
  const [pickerPathInput, setPickerPathInput] = useState("");
  const [pickerParent, setPickerParent] = useState<string | null>(null);
  const [pickerDirectories, setPickerDirectories] = useState<Array<{ name: string; path: string }>>([]);
  const initialLocationThreadIdRef = useRef(
    typeof window === "undefined" ? "" : readPortalThreadIdFromLocation(window.location.search)
  );
  const [portalThreadRestoreSettled, setPortalThreadRestoreSettled] = useState(() => !initialLocationThreadIdRef.current);

  useEffect(() => {
    setShowProcessTrace(resolveShowProcessTracePreference(portalPreferenceUser));
    setCollapseFinalTraceOnDone(resolveCollapseFinalTraceOnDonePreference(portalPreferenceUser));
    setPortalPreferenceErrorText("");
  }, [portalPreferenceUser?.id]);

  const appliedConfigRef = useRef(appliedConfig);
  const runtimeOptionsRef = useRef(runtimeOptions);
  const runtimeModeRef = useRef(runtimeMode);
  const showProcessTraceRef = useRef(showProcessTrace);
  const collapseFinalTraceOnDoneRef = useRef(collapseFinalTraceOnDone);
  const activeRemoteThreadIdRef = useRef("");
  const activeLocalThreadIdRef = useRef("");
  const usageByThreadRef = useRef<Record<string, ContextUsageSnapshot>>({});
  const runningStageTextRef = useRef(runningStageText);
  const runningStageFallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedKnowledgeSetIdsRef = useRef(selectedKnowledgeSetIds);
  const enabledSkillIdsRef = useRef(enabledSkillIds);
  const knowledgeSetSelectionInitializedRef = useRef(false);
  const completedRunThreadIdsRef = useRef<Set<string>>(new Set());
  const activeThreadIdentityRef = useRef<ThreadIdentity>({});
  const threadCollaborationRef = useRef<ThreadCollaborationView | null>(null);
  const threadCollaborationLoadingRef = useRef(false);
  const threadCollaborationPendingRef = useRef<{
    threadId: string;
    promise: Promise<ThreadCollaborationView | null> | null;
  }>({
    threadId: "",
    promise: null
  });
  const productFeedbackImageInputRef = useRef<HTMLInputElement | null>(null);
  const productFeedbackImagesRef = useRef<ProductFeedbackImageDraft[]>([]);
  const pickerRequestSeqRef = useRef(0);
  const pickerAutoJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPortalSubscriptionStatusRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => undefined);

  const syncActiveThreadIdentity = useCallback((identity: ThreadIdentity) => {
    const normalizedRemoteId = String(identity.remoteId || "").trim();
    const normalizedLocalId = String(identity.localId || "").trim();

    activeRemoteThreadIdRef.current = normalizedRemoteId;
    activeLocalThreadIdRef.current = normalizedLocalId;
    setActiveThreadIdentity((previous) => {
      const next = {
        remoteId: normalizedRemoteId || undefined,
        localId: normalizedLocalId || undefined
      };
      return previous.remoteId === next.remoteId && previous.localId === next.localId ? previous : next;
    });

    if (!normalizedRemoteId) {
      setContextUsage(null);
      return;
    }
    setContextUsage(usageByThreadRef.current[normalizedRemoteId] ?? null);
  }, []);

  appliedConfigRef.current = appliedConfig;
  runtimeOptionsRef.current = runtimeOptions;
  runtimeModeRef.current = runtimeMode;
  showProcessTraceRef.current = showProcessTrace;
  collapseFinalTraceOnDoneRef.current = collapseFinalTraceOnDone;
  runningStageTextRef.current = runningStageText;
  selectedKnowledgeSetIdsRef.current = selectedKnowledgeSetIds;
  enabledSkillIdsRef.current = enabledSkillIds;
  activeThreadIdentityRef.current = activeThreadIdentity;
  productFeedbackImagesRef.current = productFeedbackImages;
  threadCollaborationRef.current = threadCollaboration;
  threadCollaborationLoadingRef.current = threadCollaborationLoading;

  useEffect(
    () => () => {
      if (runningStageFallbackTimerRef.current) {
        clearTimeout(runningStageFallbackTimerRef.current);
        runningStageFallbackTimerRef.current = null;
      }
      for (const item of productFeedbackImagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    },
    []
  );

  const refreshPortalSubscriptionStatus = useCallback(async (options?: { silent?: boolean }) => {
    if (!props.currentUser) {
      setSubscriptionStatus(null);
      setSubscriptionStatusError("");
      setSubscriptionStatusLoading(false);
      return;
    }

    if (!options?.silent) {
      setSubscriptionStatusLoading(true);
    }

    try {
      const next = await fetchPortalSubscriptionStatus();
      setSubscriptionStatus(next);
      setSubscriptionStatusError("");
    } catch (error) {
      setSubscriptionStatusError(error instanceof Error ? error.message : "Failed to load your access details");
    } finally {
      if (!options?.silent) {
        setSubscriptionStatusLoading(false);
      }
    }
  }, [props.currentUser?.id]);
  refreshPortalSubscriptionStatusRef.current = refreshPortalSubscriptionStatus;

  const persistPortalPreferences = useCallback(
    async (next: { showProcessTrace: boolean; collapseFinalTraceOnDone: boolean }) => {
      setPortalPreferenceSaving(true);
      setPortalPreferenceErrorText("");
      try {
        await auth.updatePortalPreferences({
          showProcessTrace: next.showProcessTrace,
          collapseFinalTraceOnDone: next.collapseFinalTraceOnDone
        });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Failed to save portal preferences";
        setPortalPreferenceErrorText(detail);
        throw error;
      } finally {
        setPortalPreferenceSaving(false);
      }
    },
    [auth]
  );

  const handleShowProcessTraceChange = useCallback(
    async (checked: boolean) => {
      const previous = {
        showProcessTrace,
        collapseFinalTraceOnDone
      };
      const next = {
        showProcessTrace: checked,
        collapseFinalTraceOnDone
      };
      setShowProcessTrace(checked);
      try {
        await persistPortalPreferences(next);
      } catch {
        setShowProcessTrace(previous.showProcessTrace);
      }
    },
    [collapseFinalTraceOnDone, persistPortalPreferences, showProcessTrace]
  );

  const handleCollapseFinalTraceOnDoneChange = useCallback(
    async (checked: boolean) => {
      const previous = {
        showProcessTrace,
        collapseFinalTraceOnDone
      };
      const next = {
        showProcessTrace,
        collapseFinalTraceOnDone: checked
      };
      setCollapseFinalTraceOnDone(checked);
      try {
        await persistPortalPreferences(next);
      } catch {
        setCollapseFinalTraceOnDone(previous.collapseFinalTraceOnDone);
      }
    },
    [collapseFinalTraceOnDone, persistPortalPreferences, showProcessTrace]
  );

  const refreshRuntimeOptionsNow = useCallback(async (): Promise<PortalRuntimeOptions | null> => {
    try {
      const next = await api<PortalRuntimeOptions>("/api/portal/runtime-options");
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
      return next;
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load runtime policies");
      return null;
    }
  }, []);

  useEffect(() => {
    let active = true;
    void refreshRuntimeOptionsNow().then(() => {
      if (!active) return;
    });
    return () => {
      active = false;
    };
  }, [refreshRuntimeOptionsNow]);

  useEffect(() => {
    if (!props.currentUser) {
      setSubscriptionStatus(null);
      setSubscriptionStatusError("");
      setSubscriptionStatusLoading(false);
      return;
    }
    void refreshPortalSubscriptionStatus();
  }, [props.currentUser?.id, auth.activeOrganization?.id, refreshPortalSubscriptionStatus]);

  useEffect(() => {
    const remoteThreadId = String(activeThreadIdentity.remoteId || "").trim();
    if (!remoteThreadId) {
      threadCollaborationRef.current = null;
      threadCollaborationLoadingRef.current = false;
      threadCollaborationPendingRef.current = { threadId: "", promise: null };
      setThreadCollaboration(null);
      setThreadCollaborationLoading(false);
      setThreadCollaborationErrorText("");
      return;
    }

    let cancelled = false;
    threadCollaborationLoadingRef.current = true;
    setThreadCollaborationLoading(true);
    setThreadCollaborationErrorText("");

    const pendingCollaboration = fetchThreadCollaboration(remoteThreadId)
      .then((next) => {
        if (cancelled) return null;
        threadCollaborationRef.current = next;
        setThreadCollaboration(next);
        return next;
      })
      .catch((error) => {
        if (cancelled) return null;
        threadCollaborationRef.current = null;
        setThreadCollaboration(null);
        setThreadCollaborationErrorText(error instanceof Error ? error.message : "Failed to load collaboration status");
        return null;
      })
      .finally(() => {
        if (cancelled) return;
        threadCollaborationLoadingRef.current = false;
        if (threadCollaborationPendingRef.current.threadId === remoteThreadId) {
          threadCollaborationPendingRef.current = { threadId: "", promise: null };
        }
        setThreadCollaborationLoading(false);
      });
    threadCollaborationPendingRef.current = { threadId: remoteThreadId, promise: pendingCollaboration };

    return () => {
      cancelled = true;
    };
  }, [activeThreadIdentity.remoteId]);

  const isExternalPortalUser = props.currentUser?.userType === "external_user";
  const [billingPanelOpen, setBillingPanelOpen] = useState(false);
  const [subscriptionReminderModalOpen, setSubscriptionReminderModalOpen] = useState(false);
  const [dismissedSubscriptionReminderKey, setDismissedSubscriptionReminderKey] = useState("");

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
    if (isExternalPortalUser) {
      setEnabledSkillIds([]);
      return;
    }
    const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
    const available = new Set((selectedMode?.availableSkills ?? []).map((skill) => skill.id));
    setEnabledSkillIds((current) => current.filter((skillId) => available.has(skillId)));
  }, [isExternalPortalUser, runtimeMode, runtimeOptions]);

  useEffect(() => {
    const threadId = String(activeThreadIdentity.remoteId || "").trim();
    if (!threadId || isExternalPortalUser) {
      setEnabledSkillIds([]);
      return;
    }

    let active = true;
    void api<ThreadOneOut>(`/api/threads/${encodeURIComponent(threadId)}`)
      .then((response) => {
        if (!active) return;
        const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
        const availableSkills = selectedMode?.availableSkills ?? [];
        const availableById = new Set(availableSkills.map((skill) => skill.id));
        const ids = Array.isArray(response.thread.enabled_skills)
          ? response.thread.enabled_skills
              .map((skill) => (typeof skill?.id === "string" ? skill.id.trim() : ""))
              .filter((id) => id && (!selectedMode || availableById.has(id)))
          : Array.isArray(response.thread.enabled_skill_names)
            ? response.thread.enabled_skill_names
                .map((name) => {
                  const normalized = typeof name === "string" ? name.trim() : "";
                  if (!normalized) return "";
                  return availableSkills.find((skill) => skill.name === normalized)?.id ?? "";
                })
                .filter(Boolean)
            : [];
        setEnabledSkillIds(Array.from(new Set(ids)));
      })
      .catch(() => {
        // Keep the local selection if the detail refresh fails; the next run is still validated server-side.
      });

    return () => {
      active = false;
    };
  }, [activeThreadIdentity.remoteId, isExternalPortalUser, runtimeMode, runtimeOptions]);

  useEffect(() => {
    let active = true;

    async function loadPortalResources() {
      try {
        const next = await fetchPortalResources();
        if (!active) return;
        setResourceErrorText("");
        setPortalResources(next);
        const availableIds = (next.knowledgeSets || []).map((item) => item.id);
        const allowedIds = new Set(availableIds);
        setSelectedKnowledgeSetIds((prev) => {
          const filtered = prev.filter((id) => allowedIds.has(id));
          if (filtered.length > 0) {
            knowledgeSetSelectionInitializedRef.current = true;
            return filtered;
          }
          if (knowledgeSetSelectionInitializedRef.current) return filtered;
          if (availableIds.length === 0) return filtered;
          knowledgeSetSelectionInitializedRef.current = true;
          return availableIds;
        });
      } catch (error) {
        if (!active) return;
        setResourceErrorText(error instanceof Error ? error.message : "Failed to load knowledge-set resources");
      }
    }

    void loadPortalResources();
    return () => {
      active = false;
    };
  }, []);

  const clearRunningStageFallbackTimer = () => {
    if (!runningStageFallbackTimerRef.current) return;
    clearTimeout(runningStageFallbackTimerRef.current);
    runningStageFallbackTimerRef.current = null;
  };

  const updateRunningStage = (next: string, options?: { fallback?: boolean }) => {
    const normalized = next.trim();
    if (!normalized) return;
    clearRunningStageFallbackTimer();
    if (runningStageTextRef.current !== normalized) {
      runningStageTextRef.current = normalized;
      setRunningStageText(normalized);
    }
    if (options?.fallback === false) return;
    if (normalized === RUNNING_STAGE_CONNECTING_TEXT) {
      runningStageFallbackTimerRef.current = setTimeout(() => {
        runningStageFallbackTimerRef.current = null;
        if (runningStageTextRef.current === RUNNING_STAGE_CONNECTING_TEXT) {
          updateRunningStage(RUNNING_STAGE_WORKING_TEXT);
        }
      }, RUNNING_STAGE_CONNECTING_FALLBACK_MS);
      return;
    }
    if (normalized === RUNNING_STAGE_WORKING_TEXT) {
      runningStageFallbackTimerRef.current = setTimeout(() => {
        runningStageFallbackTimerRef.current = null;
        if (runningStageTextRef.current === RUNNING_STAGE_WORKING_TEXT) {
          updateRunningStage(RUNNING_STAGE_NO_VISIBLE_UPDATE_TEXT, { fallback: false });
        }
      }, RUNNING_STAGE_VISIBLE_UPDATE_FALLBACK_MS);
    }
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
      const detail = error instanceof Error ? error.message : "Failed to read directory";
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
      setPickerError("Enter a directory path");
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
    setStatusText(`Added extra directory: ${normalized}`);
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
        const groupHeaderByRemoteId: Record<string, string> = {};
        let previousGroupLabel = "";
        for (const thread of out.threads || []) {
          const groupLabel = formatThreadGroupLabel(thread.updated_at || thread.created_at);
          if (groupLabel && groupLabel !== previousGroupLabel) {
            rememberThreadGroupHeader(groupHeaderByRemoteId, thread, groupLabel);
            previousGroupLabel = groupLabel;
          }
        }
        setSessionGroupLabelContext({ groupHeaderByRemoteId });
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
        const selectedMode = findRuntimeMode(runtimeOptionsRef.current, runtimeModeRef.current);
        const selectedSkillIds = new Set(enabledSkillIdsRef.current);
        const skills = (selectedMode?.availableSkills ?? []).filter((skill) => selectedSkillIds.has(skill.id));
        let created: ThreadCreateOut;
        try {
          created = await api<ThreadCreateOut>("/api/threads", {
            method: "POST",
            json: {
              external_id: threadId,
              model: cfg.model,
              reasoning_effort: cfg.reasoningEffort,
              knowledge_set_ids: knowledgeSetIds,
              codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current, skills)
            }
          });
        } catch (error) {
          const notice = formatAssistantErrorNoticeFromError(error, "Failed to create thread");
          setErrorText(notice);
          void refreshPortalSubscriptionStatusRef.current({ silent: true });
          throw new Error(notice);
        }
        setActiveThreadIdentity({
          remoteId: created.thread.id,
          localId: threadId || undefined
        });
        const groupLabel = formatThreadGroupLabel(created.thread.updated_at || created.thread.created_at || new Date().toISOString());
        setSessionGroupLabelContext((prev) => {
          const nextGroupHeaders = { ...prev.groupHeaderByRemoteId };
          clearThreadGroupHeaderLabel(nextGroupHeaders, groupLabel);
          rememberThreadGroupHeader(nextGroupHeaders, created.thread, groupLabel, threadId);
          return { groupHeaderByRemoteId: nextGroupHeaders };
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
        const shouldPersist = !existingTitle && title.trim() && title !== "New conversation";
        if (shouldPersist) {
          await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
            method: "PATCH",
            json: { title }
          });
        }
        return createAssistantStream((controller) => {
          controller.appendText(title || "New conversation");
          controller.close();
        });
      },
      unstable_Provider: ({ children }: PropsWithChildren) => (
        <AgentRuntimeAdapterProvider
          canUpload={runtimeOptions?.canUpload ?? false}
          onThreadIdentityChange={syncActiveThreadIdentity}
        >
          {children}
        </AgentRuntimeAdapterProvider>
      )
    }),
    [runtimeOptions?.canUpload, syncActiveThreadIdentity]
  );

  const canUpload = runtimeOptions?.canUpload ?? false;
  const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
  const modeOptions = resolveModeOptions(runtimeOptions?.modes ?? [], runtimeMode);
  const selectedModeLabel = resolveModeLabel(runtimeOptions?.modes ?? [], runtimeMode);
  const availableModeSkills = isExternalPortalUser ? [] : (selectedMode?.availableSkills ?? []);
  const toggleEnabledSkill = useCallback((skillId: string) => {
    if (isExternalPortalUser) return;
    setEnabledSkillIds((current) => {
      if (current.includes(skillId)) {
        return current.filter((item) => item !== skillId);
      }
      const nextSkill = availableModeSkills.find((skill) => skill.id === skillId);
      if (!nextSkill) return current;
      const filteredCurrent = current.filter((item) => {
        const currentSkill = availableModeSkills.find((skill) => skill.id === item);
        return currentSkill?.name !== nextSkill.name;
      });
      return [...filteredCurrent, skillId];
    });
  }, [availableModeSkills, isExternalPortalUser]);
  const skillComposerContext = useMemo(
    () => ({
      availableSkills: availableModeSkills,
      enabledSkillIds,
      toggleSkill: toggleEnabledSkill
    }),
    [availableModeSkills, enabledSkillIds, toggleEnabledSkill]
  );
  const selectedKnowledgeSetIdsNormalized = selectedKnowledgeSetIds;
  const handleKnowledgeSetChange = useCallback((ids: string[]) => {
    knowledgeSetSelectionInitializedRef.current = true;
    setSelectedKnowledgeSetIds(ids);
  }, []);
  const activeRemoteThreadId = String(activeThreadIdentity.remoteId || "").trim();
  const activeThreadCollaboration =
    threadCollaboration && threadCollaboration.threadId === activeRemoteThreadId ? threadCollaboration : null;
  const sharedThreadReadonly = Boolean(
    activeThreadCollaboration && activeThreadCollaboration.access.canRead && !activeThreadCollaboration.access.canRun
  );
  const selectedModelLabel = appliedConfig.model;
  const selectedReasoningLabel = appliedConfig.reasoningEffort;
  const currentUserName = props.currentUser?.displayName || props.currentUser?.email || "Current user";
  const assistantDisplayName = branding.assistantName.trim() || "AI Assistant";
  const assistantAvatar = useMemo(
    () => ({
      ...(branding.assistantAvatarUrl.trim() ? { src: branding.assistantAvatarUrl.trim() } : {}),
      alt: assistantDisplayName,
      fallback: getBrandInitials(assistantDisplayName)
    }),
    [assistantDisplayName, branding.assistantAvatarUrl]
  );
  const runtimeSummaryText = `${appliedConfig.model} · ${appliedConfig.reasoningEffort} · ${selectedModeLabel} · Context ${contextUsageView.usedPercent}%`;
  const topbarRuntimeSummaryText = isMobile
    ? `${selectedModeLabel} · Context ${contextUsageView.usedPercent}%`
    : runtimeSummaryText;
  const composerPlaceholder = canUpload
    ? isMobile
      ? "Ask a question or attach a file."
      : "Type your question directly. Any attachments are supported; you can also drag files into the chat window."
    : isMobile
      ? "Ask a question."
      : "Type your question directly";
  const welcomeMessageTemplate = isMobile
    ? behavior.portalWelcomeMessageMobile
    : behavior.portalWelcomeMessageDesktop;
  const welcomeMessage =
    applyPortalWelcomeTemplate(welcomeMessageTemplate, {
      assistantName: assistantDisplayName,
      platformName: branding.platformName.trim() || "Agent Studio"
    }) ||
    (isMobile
      ? "Ask about products, versions, deployment, alarms, or troubleshooting."
      : `Hello, I'm your ${assistantDisplayName}. Ask about products, versions, deployment, alarms, or troubleshooting.`);
  const welcomeSuggestions = useMemo(
    () => behavior.portalWelcomeSuggestions.map((item) => ({ text: item.label, prompt: item.prompt })),
    [behavior.portalWelcomeSuggestions]
  );
  const isInternalAnswerFeedbackAudience = auth.activeOrganization?.type
    ? auth.activeOrganization.type === "internal"
    : portalPreferenceUser?.userType === "internal_employee";
  const answerFeedbackConfig = useMemo<AnswerFeedbackUiConfig>(
    () => ({
      enabled: isInternalAnswerFeedbackAudience
        ? behavior.answerFeedback.enabledForInternalUsers
        : behavior.answerFeedback.enabledForExternalUsers,
      prompt: behavior.answerFeedback.prompt.trim() || "Was this answer helpful?"
    }),
    [
      behavior.answerFeedback.enabledForExternalUsers,
      behavior.answerFeedback.enabledForInternalUsers,
      behavior.answerFeedback.prompt,
      isInternalAnswerFeedbackAudience
    ]
  );

  const buildProductFeedbackContext = useCallback(() => {
    const locationSnapshot =
      typeof window === "undefined"
        ? { path: "", search: "", hash: "" }
        : {
            path: window.location.pathname,
            search: window.location.search,
            hash: window.location.hash
          };
    return {
      capturedAt: new Date().toISOString(),
      page: locationSnapshot,
      userAgent: typeof navigator === "undefined" ? "" : navigator.userAgent,
      thread: {
        remoteId: activeRemoteThreadId || null,
        localId: activeThreadIdentity.localId || null,
        readOnly: sharedThreadReadonly
      },
      runtime: {
        summary: runtimeSummaryText,
        modeId: runtimeMode,
        modeLabel: selectedModeLabel,
        model: appliedConfig.model,
        reasoningEffort: appliedConfig.reasoningEffort,
        workspace: appliedConfig.workspace,
        sandboxMode: appliedConfig.sandboxMode,
        approvalPolicy: appliedConfig.approvalPolicy,
        networkAccessEnabled: appliedConfig.networkAccessEnabled,
        webSearchMode: appliedConfig.webSearchMode,
        knowledgeSetIds: selectedKnowledgeSetIdsNormalized,
        enabledSkillIds
      },
      layout: {
        sessionRailCollapsed: layoutState.isSessionRailCollapsed,
        rightDrawerOpen: layoutState.isRightDrawerOpen,
        activeRightDrawerTab: layoutState.activeRightDrawerTab,
        advancedSettingsOpen: layoutState.isAdvancedSettingsOpen
      },
      contextUsage,
      user: props.currentUser
        ? {
            id: props.currentUser.id,
            displayName: props.currentUser.displayName || null,
            email: props.currentUser.email || null,
            role: props.currentUser.role,
            userType: props.currentUser.userType,
            primaryOrganizationId: props.currentUser.primaryOrganizationId || null
          }
        : null
    };
  }, [
    activeRemoteThreadId,
    activeThreadIdentity.localId,
    appliedConfig,
    contextUsage,
    layoutState,
    props.currentUser,
    runtimeMode,
    runtimeSummaryText,
    enabledSkillIds,
    selectedKnowledgeSetIdsNormalized,
    selectedModeLabel,
    sharedThreadReadonly
  ]);

  const openProductFeedbackModal = useCallback(() => {
    setProductFeedbackOpen(true);
    setProductFeedbackError("");
    setProductFeedbackSubmitted(false);
  }, []);

  const clearProductFeedbackImages = useCallback(() => {
    setProductFeedbackPreviewImage(null);
    setProductFeedbackImages((prev) => {
      for (const item of prev) {
        URL.revokeObjectURL(item.previewUrl);
      }
      return [];
    });
    if (productFeedbackImageInputRef.current) {
      productFeedbackImageInputRef.current.value = "";
    }
  }, []);

  const removeProductFeedbackImage = useCallback((imageId: string) => {
    setProductFeedbackImages((prev) => {
      const target = prev.find((item) => item.id === imageId);
      if (target) {
        URL.revokeObjectURL(target.previewUrl);
        setProductFeedbackPreviewImage((current) => (current?.id === imageId ? null : current));
      }
      return prev.filter((item) => item.id !== imageId);
    });
  }, []);

  const handleProductFeedbackImageChange = useCallback((event: ReactChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(event.target.files || []);
    if (selectedFiles.length === 0) return;
    let nextError = "";
    setProductFeedbackImages((prev) => {
      const next = [...prev];
      for (const file of selectedFiles) {
        if (next.length >= PRODUCT_FEEDBACK_MAX_IMAGES) {
          nextError = `You can upload up to ${PRODUCT_FEEDBACK_MAX_IMAGES} screenshots.`;
          break;
        }
        if (!PRODUCT_FEEDBACK_IMAGE_TYPES.has(file.type)) {
          nextError = "Only PNG, JPG, WebP, or GIF screenshots are supported.";
          continue;
        }
        if (file.size > PRODUCT_FEEDBACK_MAX_IMAGE_BYTES) {
          nextError = `Each screenshot must be ${formatFileSize(PRODUCT_FEEDBACK_MAX_IMAGE_BYTES)} or less.`;
          continue;
        }
        const id =
          typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
            ? crypto.randomUUID()
            : `${Date.now()}-${file.name}-${next.length}`;
        next.push({
          id,
          file,
          previewUrl: URL.createObjectURL(file)
        });
      }
      return next;
    });
    setProductFeedbackSubmitted(false);
    setProductFeedbackError(nextError);
    event.target.value = "";
  }, []);

  const closeProductFeedbackModal = useCallback(() => {
    if (productFeedbackSubmitting) return;
    setProductFeedbackOpen(false);
    setProductFeedbackError("");
    setProductFeedbackSubmitted(false);
    clearProductFeedbackImages();
  }, [clearProductFeedbackImages, productFeedbackSubmitting]);

  const submitProductFeedback = useCallback(async () => {
    const description = productFeedbackDescription.trim();
    if (!description || productFeedbackSubmitting) return;
    setProductFeedbackSubmitting(true);
    setProductFeedbackError("");
    try {
      const formData = new FormData();
      formData.set("type", productFeedbackType);
      if (productFeedbackType === "bug") {
        formData.set("severity", productFeedbackSeverity);
      }
      formData.set("description", description);
      if (activeRemoteThreadId) {
        formData.set("thread_id", activeRemoteThreadId);
      }
      if (productFeedbackIncludeContext) {
        formData.set("context", JSON.stringify(buildProductFeedbackContext()));
      }
      for (const image of productFeedbackImages) {
        formData.append("images", image.file, image.file.name);
      }

      const response = await fetch(`${apiBase()}/api/portal/feedback`, {
        method: "POST",
        credentials: "include",
        headers: authHeaders(),
        body: formData
      });
      const responseText = await response.text();
      const responseBody = responseText ? JSON.parse(responseText) : {};
      if (!response.ok) {
        notifyAuthInvalidStatus(response.status);
        throw new Error(
          (responseBody && typeof responseBody.detail === "string" && responseBody.detail) ||
            `Failed to submit feedback (${response.status})`
        );
      }
      setProductFeedbackSubmitted(true);
      setProductFeedbackDescription("");
      clearProductFeedbackImages();
      window.setTimeout(() => {
        setProductFeedbackOpen(false);
        setProductFeedbackSubmitted(false);
      }, 800);
    } catch (error) {
      setProductFeedbackError(error instanceof Error ? error.message : "Failed to submit feedback");
    } finally {
      setProductFeedbackSubmitting(false);
    }
  }, [
    activeRemoteThreadId,
    buildProductFeedbackContext,
    productFeedbackDescription,
    productFeedbackImages,
    productFeedbackIncludeContext,
    productFeedbackSeverity,
    productFeedbackSubmitting,
    productFeedbackType,
    clearProductFeedbackImages
  ]);

  const requestPreviewForPath = useCallback((filePath: string) => {
    const normalizedPath = normalizePreviewFilePath(filePath);
    if (!normalizedPath) return;
    setRequestedPreviewPath(normalizedPath);
    setPreviewRequestNonce((value) => value + 1);
    setLayoutState((prev) => switchWorkbenchTab(openWorkbenchDrawer(prev), "preview"));
  }, []);

  const handleThreadLinkClickCapture = useCallback(
    (event: ReactMouseEvent<HTMLElement>) => {
      if (event.defaultPrevented) return;
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const anchor = target.closest("a");
      if (!(anchor instanceof HTMLAnchorElement)) return;
      const href = anchor.getAttribute("href") || anchor.href || "";
      const previewPath = resolveThreadPreviewPathFromHref(href, activeRemoteThreadId);
      if (!previewPath) return;

      event.preventDefault();
      event.stopPropagation();
      requestPreviewForPath(previewPath);
    },
    [activeRemoteThreadId, requestPreviewForPath]
  );

  useEffect(() => {
    setRequestedPreviewPath("");
  }, [activeRemoteThreadId]);

  useEffect(() => {
    if (!isExternalPortalUser) return;
    setLayoutState((prev) => {
      if (!prev.isAdvancedSettingsOpen) {
        return prev;
      }
      return {
        ...prev,
        isAdvancedSettingsOpen: false
      };
    });
  }, [isExternalPortalUser]);

  useEffect(() => {
    if (!isExternalPortalUser) return;
    setShowProcessTrace(false);
  }, [isExternalPortalUser]);

  const chatAdapter = useMemo<ChatModelAdapter>(
    () => ({
      run: async function* (options) {
        const prompt = extractLatestPrompt(options.messages);
        if (!prompt) {
          throw new Error("No user input text detected");
        }
        const isSkillCreationRequest = isSkillCreationIntent(prompt);
        const runtimePrompt = isSkillCreationRequest ? buildSkillCreatorReviewPrompt(prompt) : prompt;

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
          throw new Error("Unable to resolve the current thread ID (the thread may still be initializing, please try again).");
        }
        const localThreadId = String(activeLocalThreadIdRef.current || options.unstable_threadId || "").trim();
        activeRemoteThreadIdRef.current = threadId;
        const readActiveCollaboration = () => {
          const current = threadCollaborationRef.current;
          return current && current.threadId === threadId ? current : null;
        };
        const collaborationLoadingForThread =
          threadCollaborationLoadingRef.current &&
          String(activeThreadIdentityRef.current.remoteId || "").trim() === threadId &&
          !readActiveCollaboration();
        if (collaborationLoadingForThread) {
          const pendingCollaboration =
            threadCollaborationPendingRef.current.threadId === threadId
              ? threadCollaborationPendingRef.current.promise
              : null;
          if (pendingCollaboration) {
            updateRunningStage("Waiting for thread collaboration permission");
            await Promise.race([
              pendingCollaboration,
              new Promise<null>((resolve) => window.setTimeout(() => resolve(null), 1500))
            ]);
          }
        }
        const activeCollaboration = readActiveCollaboration();
        if (activeCollaboration && !activeCollaboration.access.canRun) {
          throw new Error("The current shared thread is read-only and cannot continue running.");
        }

        const cfg = normalizeRuntimeConfig(appliedConfigRef.current);
        const knowledgeSetIds = normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current);
        const selectedMode = findRuntimeMode(runtimeOptionsRef.current, runtimeModeRef.current);
        const selectedSkillIds = new Set(enabledSkillIdsRef.current);
        const skills = (selectedMode?.availableSkills ?? []).filter((skill) => selectedSkillIds.has(skill.id));
        let ensured: ThreadSessionOut;
        try {
          ensured = await api<ThreadSessionOut>(`/api/threads/${encodeURIComponent(threadId)}/session`, {
            method: "POST",
            json: {
              model: cfg.model,
              reasoning_effort: cfg.reasoningEffort,
              knowledge_set_ids: knowledgeSetIds,
              codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current, skills)
            }
          });
        } catch (error) {
          const notice = formatAssistantErrorNoticeFromError(error, "Failed to initialize the current session");
          setErrorText(notice);
          void refreshPortalSubscriptionStatusRef.current({ silent: true });
          updateRunningStage("Execution failed");
          throw new Error(notice);
        }
        const session = ensured.session;

        setErrorText("");
        setStatusText(isSkillCreationRequest ? "Creating skill..." : "Generating...");
        updateRunningStage(RUNNING_STAGE_CONNECTING_TEXT);

        let hasTextUpdate = false;
        let doneAnswer = "";
        const orderedParts: any[] = [];
        let activeTextPart: { type: "text"; text: string } | null = null;
        let activeCommentaryPart:
          | {
              type: "data";
              name: "codex_commentary";
              data: CommentaryPartData;
            }
          | null = null;
        let currentCommentaryKey = "";
        let commentarySeq = 0;
        let traceBatchSeq = 0;
        let traceRowSeq = 0;
        let seq = 0;
        let activeTraceBatchPart: TraceBatchPart | null = null;
        const commentaryLineBreakGapMs = 900;

        const processEnabled = showProcessTraceRef.current;
        const collapseFinalTraceOnDoneEnabled = collapseFinalTraceOnDoneRef.current;

        const appendTextPart = (chunk: string): boolean => {
          if (!chunk) return false;
          activeCommentaryPart = null;
          currentCommentaryKey = "";
          if (!activeTextPart) {
            activeTextPart = { type: "text", text: "" };
            orderedParts.push(activeTextPart);
          }
          activeTextPart.text += chunk;
          hasTextUpdate = true;
          return true;
        };

        const commentaryGroupId = "assistant-thoughts";

        const summarizeCommentaryEntries = (entries: CommentaryEntryData[]) => entries.map((entry) => entry.text.trim()).filter(Boolean);

        const syncCommentaryPartSummary = (part: {
          type: "data";
          name: "codex_commentary";
          data: CommentaryPartData;
        }) => {
          const entries = Array.isArray(part.data.entries) ? part.data.entries : [];
          const texts = summarizeCommentaryEntries(entries);
          part.data.text = texts.join("\n\n");
          part.data.lines = texts;
          part.data.status = entries.some((entry) => entry.status === "streaming") ? "streaming" : "completed";
        };

        const createCommentaryPart = () => {
          activeTextPart = null;
          const part: {
            type: "data";
            name: "codex_commentary";
            data: CommentaryPartData;
          } = {
            type: "data",
            name: "codex_commentary",
            data: {
              id: commentaryGroupId,
              text: "",
              lines: [],
              entries: [],
              open: true,
              status: "streaming"
            }
          };
          orderedParts.push(part);
          activeCommentaryPart = part;
          return part;
        };

        const ensureCommentaryPart = () => {
          if (activeCommentaryPart) {
            return activeCommentaryPart;
          }
          let existing:
            | {
                type: "data";
                name: "codex_commentary";
                data: CommentaryPartData;
              }
            | undefined;
          for (let i = orderedParts.length - 1; i >= 0; i -= 1) {
            const item = orderedParts[i] as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_commentary") continue;
            existing = item as {
              type: "data";
              name: "codex_commentary";
              data: CommentaryPartData;
            };
            break;
          }
          if (existing) {
            activeTextPart = null;
            activeCommentaryPart = existing;
            return existing;
          }
          return createCommentaryPart();
        };

        const ensureCommentaryEntry = (key: string) => {
          const part = ensureCommentaryPart();
          const entries = Array.isArray(part.data.entries) ? [...part.data.entries] : [];
          let entry = entries.find((item) => item.id === key);
          if (!entry) {
            entry = {
              id: key,
              text: "",
              lines: [],
              status: "streaming"
            };
            entries.push(entry);
            part.data.entries = entries;
          }
          activeTextPart = null;
          activeCommentaryPart = part;
          currentCommentaryKey = key;
          return { part, entry };
        };

        const updateCommentaryPart = (key: string, nextText: string, mode: "append" | "replace"): boolean => {
          if (!nextText) return false;
          const { part, entry } = ensureCommentaryEntry(key);
          const now = Date.now();
          const previousText = entry.text;
          const previousLines = Array.isArray(entry.lines) ? [...entry.lines] : [];
          const resolvedText = mode === "replace" ? nextText : `${previousText}${nextText}`;
          let nextDelta = nextText;
          if (mode === "replace" && previousText && nextText.startsWith(previousText)) {
            nextDelta = nextText.slice(previousText.length);
          } else if (mode === "replace" && previousText && !nextText.startsWith(previousText)) {
            previousLines.length = 0;
            nextDelta = nextText;
          }
          if (resolvedText === previousText && part.data.status === "streaming") {
            hasTextUpdate = true;
            return false;
          }
          entry.text = resolvedText;
          if (nextDelta) {
            const lastEventAt = typeof entry.last_event_at === "number" ? entry.last_event_at : 0;
            const shouldStartNewLine = previousLines.length === 0 || now - lastEventAt >= commentaryLineBreakGapMs;
            if (shouldStartNewLine) {
              previousLines.push(nextDelta);
            } else {
              const lastIndex = previousLines.length - 1;
              previousLines[lastIndex] = `${previousLines[lastIndex]}${nextDelta}`;
            }
          }
          entry.lines = previousLines;
          entry.last_event_at = now;
          entry.status = "streaming";
          part.data.open = true;
          part.data.last_event_at = now;
          syncCommentaryPartSummary(part);
          part.data.status = "streaming";
          hasTextUpdate = true;
          return true;
        };

        const markCommentaryCompleted = (key: string): boolean => {
          let changed = false;
          for (let i = orderedParts.length - 1; i >= 0; i -= 1) {
            const item = orderedParts[i] as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_commentary") continue;
            const part = item as {
              type: "data";
              name: "codex_commentary";
              data: CommentaryPartData;
            };
            const entries = Array.isArray(part.data.entries) ? part.data.entries : [];
            const entry = entries.find((item) => item.id === key);
            if (entry) {
              entry.status = "completed";
              syncCommentaryPartSummary(part);
              changed = true;
              break;
            }
            if (part.data.id === key) {
              part.data.status = "completed";
              changed = true;
              break;
            }
          }
          if (currentCommentaryKey === key) {
            activeCommentaryPart = null;
            currentCommentaryKey = "";
          }
          return changed;
        };

        const promoteLatestCommentaryToFinalText = (): boolean => {
          for (let i = orderedParts.length - 1; i >= 0; i -= 1) {
            const item = orderedParts[i] as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_commentary") continue;
            const part = item as {
              type: "data";
              name: "codex_commentary";
              data: CommentaryPartData;
            };
            const entries = Array.isArray(part.data.entries) ? [...part.data.entries] : [];
            if (entries.length > 0) {
              for (let entryIndex = entries.length - 1; entryIndex >= 0; entryIndex -= 1) {
                const text = entries[entryIndex]?.text.trim() || "";
                if (!text) {
                  entries.splice(entryIndex, 1);
                  continue;
                }
                entries.splice(entryIndex, 1);
                if (entries.length === 0) {
                  orderedParts.splice(i, 1);
                } else {
                  part.data.entries = entries;
                  syncCommentaryPartSummary(part);
                }
                activeCommentaryPart = null;
                currentCommentaryKey = "";
                return appendTextPart(text);
              }
              orderedParts.splice(i, 1);
              continue;
            }
            const text = part.data.text.trim();
            if (!text) {
              orderedParts.splice(i, 1);
              continue;
            }
            orderedParts.splice(i, 1);
            activeCommentaryPart = null;
            currentCommentaryKey = "";
            return appendTextPart(text);
          }
          return false;
        };

        const collapseCommentaryParts = (): boolean => {
          let changed = false;
          for (const part of orderedParts) {
            const item = part as Record<string, unknown>;
            if (item.type !== "data" || item.name !== "codex_commentary") continue;
            const payload = asRecord(item.data);
            if (!payload) continue;
            const entries = Array.isArray(payload.entries) ? payload.entries : [];
            for (const entry of entries) {
              const entryObj = asRecord(entry);
              if (entryObj && entryObj.status !== "completed") {
                entryObj.status = "completed";
                changed = true;
              }
            }
            if (payload.open !== false || payload.status !== "completed") {
              payload.open = false;
              payload.status = "completed";
              changed = true;
            }
          }
          return changed;
        };

        const appendTraceBatch = (parts: any[]): boolean => {
          if (parts.length === 0) return false;
          const incomingRows = extractTimelineRows(parts);
          if (incomingRows.length === 0) return false;
          activeTextPart = null;
          activeCommentaryPart = null;
          currentCommentaryKey = "";

          if (!activeTraceBatchPart) {
            traceBatchSeq += 1;
            activeTraceBatchPart = {
              type: "data",
              name: "codex_trace_batch",
              data: {
                batch_id: traceBatchSeq,
                open: true,
                active_row_id: "",
                rows: []
              }
            };
            orderedParts.push(activeTraceBatchPart);
          }

          const nextRows = incomingRows.map((row) => ({
            ...row,
            id: `trace-row-${++traceRowSeq}`
          }));
          activeTraceBatchPart.data.rows = [...activeTraceBatchPart.data.rows, ...nextRows];
          activeTraceBatchPart.data.open = true;
          activeTraceBatchPart.data.active_row_id = nextRows[nextRows.length - 1]?.id || activeTraceBatchPart.data.active_row_id || "";
          return true;
        };

        const appendDisplayDataParts = (parts: any[]): boolean => {
          if (parts.length === 0) return false;
          let changed = false;
          for (const part of parts) {
            const partObj = asRecord(part);
            if (!partObj || partObj.type !== "data") continue;
            const name = typeof partObj.name === "string" ? partObj.name.trim() : "";
            if (name !== "codex_file_change" && name !== "skill_draft_status") continue;
            if (isExternalPortalUser && name === "codex_file_change") {
              const dataObj = asRecord(partObj.data);
              if (dataObj?.artifact_only !== true) {
                continue;
              }
            }
            activeTextPart = null;
            activeCommentaryPart = null;
            currentCommentaryKey = "";
            orderedParts.push({
              type: "data",
              name,
              data: partObj.data
            });
            changed = true;
          }
          return changed;
        };

        const appendAuditDataParts = (parts: any[]): boolean => {
          if (parts.length === 0) return false;
          let changed = false;
          for (const part of parts) {
            const partObj = asRecord(part);
            if (!partObj || partObj.type !== "data") continue;
            const name = typeof partObj.name === "string" ? partObj.name.trim() : "";
            if (name !== "codex_process_audit") continue;
            orderedParts.push({
              type: "data",
              name,
              data: partObj.data
            });
            changed = true;
          }
          return changed;
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
          return orderedParts.map((part) => {
            const item = asRecord(part);
            if (!item || item.type !== "data") return { ...part };
            const payload = asRecord(item.data);
            if (!payload) return { ...part };
            if (item.name === "codex_commentary") {
              return {
                ...part,
                data: {
                  ...payload,
                  lines: Array.isArray(payload.lines) ? [...payload.lines] : [],
                  entries: Array.isArray(payload.entries)
                    ? payload.entries.map((entry) => {
                        const entryObj = asRecord(entry);
                        if (!entryObj) return entry;
                        return {
                          ...entryObj,
                          lines: Array.isArray(entryObj.lines) ? [...entryObj.lines] : []
                        };
                      })
                    : []
                }
              };
            }
            if (item.name === "codex_trace_batch") {
              return {
                ...part,
                data: {
                  ...payload,
                  rows: Array.isArray(payload.rows) ? payload.rows.map((row) => ({ ...(asRecord(row) || {}) })) : []
                }
              };
            }
            return {
              ...part,
              data: { ...payload }
            };
          });
        };

        const runningThreadKeys = normalizeThreadIdentityKeys(threadId, localThreadId);
        runningThreadKeys.forEach((key) => completedRunThreadIdsRef.current.delete(key));
        setActiveRunThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, true));
        setRuntimeRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
        setCompletedNoticeThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
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
              message: runtimePrompt
            }),
            signal: options.abortSignal
          })) {
            const updates: any[] = [];
            let textChanged = false;
            const payload = asRecord(data);

            if (event === "error") {
              const detail =
                (payload && typeof payload.detail === "string" ? payload.detail : "") || "Request failed";
              const errorCode =
                (payload && typeof payload.code === "string" ? payload.code : "") ||
                (payload && typeof payload.reason_code === "string" ? payload.reason_code : "");
              const assistantErrorNotice = formatAssistantErrorNotice(detail, errorCode);
              const processDetail = userSafeProcessDetail(detail);
              setErrorText(assistantErrorNotice);
              void refreshPortalSubscriptionStatusRef.current({ silent: true });
              updateRunningStage("Execution failed");
              if (assistantErrorNotice) {
                textChanged = appendTextPart(hasTextUpdate ? `\n\n${assistantErrorNotice}` : assistantErrorNotice) || textChanged;
              }
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "error",
                    at: new Date().toISOString(),
                    title: "Execution failed",
                    detail: processDetail,
                    rawDetail: shorten(detail, 1400)
                  } satisfies ProcessData
                });
              } else {
                updates.push({
                  type: "data",
                  name: "codex_process_audit",
                  data: {
                    kind: "error",
                    at: new Date().toISOString(),
                    title: "Execution failed",
                    detail: processDetail,
                    rawDetail: shorten(detail, 1400)
                  } satisfies ProcessData
                });
              }
              const auditChanged = appendAuditDataParts(updates);
              const dataPartChanged = appendDisplayDataParts(updates);
              const traceChanged = appendTraceBatch(updates);
              if (auditChanged || dataPartChanged || traceChanged || textChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              throw new Error(assistantErrorNotice);
            }

            if (event === "artifacts") {
              if (!payload) continue;
              const serverContentPart = asRecord(payload.content_part ?? payload.contentPart);
              if (serverContentPart?.type === "data" && serverContentPart.name === "codex_file_change") {
                updates.push(serverContentPart);
              } else {
                const policy = asRecord(payload.policy);
                const previewEnabled = policy?.preview_enabled === true;
                const downloadEnabled = policy?.download_enabled === true;
                const artifacts = Array.isArray(payload.artifacts) ? payload.artifacts : [];
                const changes = artifacts
                  .map((item) => {
                    const artifact = asRecord(item);
                    if (!artifact) return null;
                    const filePath = normalizePreviewFilePath(asString(artifact.relative_path));
                    if (!filePath) return null;
                    const canPreview = previewEnabled && asString(artifact.preview_status) === "ready";
                    const canDownload = downloadEnabled && asString(artifact.download_status) === "ready";
                    if (!canPreview && !canDownload) return null;
                    return {
                      path: filePath,
                      kind: "ready",
                      artifact_id: asString(artifact.id),
                      preview_status: asString(artifact.preview_status),
                      download_status: asString(artifact.download_status),
                      can_preview: canPreview,
                      can_download: canDownload,
                      blocked_reason: asString(artifact.blocked_reason)
                    };
                  })
                  .filter(Boolean);
                if (changes.length === 0) continue;
                updates.push({
                  type: "data",
                  name: "codex_file_change",
                  data: {
                    at: new Date().toISOString(),
                    artifact_only: true,
                    changes
                  }
                });
              }
              const dataPartChanged = appendDisplayDataParts(updates);
              if (dataPartChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event === "done") {
              doneAnswer =
                payload && typeof payload.answer === "string" ? payload.answer : "";
              void refreshPortalSubscriptionStatusRef.current({ silent: true });
              updateRunningStage("Finishing the answer");
              const promotedLatestCommentary = promoteLatestCommentaryToFinalText();
              if (promotedLatestCommentary) {
                textChanged = true;
              } else if (!hasTextUpdate && doneAnswer.trim()) {
                textChanged = appendTextPart(doneAnswer);
              }
              const commentaryCollapsed = collapseCommentaryParts();
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "done",
                    at: new Date().toISOString(),
                    title: "Response completed"
                  } satisfies ProcessData
                });
              }
              const dataPartChanged = appendDisplayDataParts(updates);
              const traceChanged = appendTraceBatch(updates);
              if (traceChanged && collapseFinalTraceOnDoneEnabled) {
                collapseLatestTraceBatch();
              }
              if (dataPartChanged || traceChanged || textChanged || commentaryCollapsed) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event === "meta") {
              updateRunningStage(RUNNING_STAGE_WORKING_TEXT);
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
                    title: "Session started",
                    detail: [model, reasoning].filter(Boolean).join(" / ")
                  } satisfies ProcessData
                });
              }
              const dataPartChanged = appendDisplayDataParts(updates);
              const traceChanged = appendTraceBatch(updates);
              if (dataPartChanged || traceChanged || textChanged) {
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
            const itemId = typeof item?.id === "string" && item.id.trim() ? item.id.trim() : "";

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
              const commentaryKey = itemId || currentCommentaryKey || `commentary-${++commentarySeq}`;
              const nextMode = delta ? "append" : "replace";
              textChanged = updateCommentaryPart(commentaryKey, append, nextMode) || textChanged;
            }

            const isStarted = eventType === "item.started";
            const isCompleted = eventType === "item.completed";
            if (itemType && (isStarted || isCompleted)) {
              updateRunningStage(stageTextForCodexItem(itemType, isStarted ? "started" : "completed", item));
            }

            if (itemType === "agent_message" && isCompleted) {
              const completedKey = itemId || currentCommentaryKey;
              if (completedKey) {
                markCommentaryCompleted(completedKey);
              }
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
                  title: `Command execution ${formatProcessStatus(status)}`.trim(),
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
              const crestTrace = crestActionTrace(toolName, args, result, errMsg);
              const rawDetail = [
                server ? `server: ${server}` : "",
                tool ? `tool: ${tool}` : "",
                errMsg ? `error: ${shorten(errMsg, 400)}` : ""
              ]
                .filter(Boolean)
                .join("\n");

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
                  title: crestTrace?.title ?? `Tool call ${errMsg ? "Failed" : "Completed"}`,
                  detail: crestTrace?.detail ?? (errMsg ? GENERIC_TOOL_ERROR_DETAIL : rawDetail),
                  rawDetail: errMsg ? rawDetail : undefined,
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
                    title: "Web search",
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
                  title: "Execution plan (Todo)",
                  detail: lines,
                  event: eventType,
                  item_type: itemType
                } satisfies ProcessData
              });
            }

            if (itemType === "file_change" && isCompleted) {
              const changes = Array.isArray(item?.changes) ? item.changes : [];
              const normalizedChanges = changes
                .slice(0, 60)
                .map((it) => {
                  const obj = asRecord(it);
                  if (!obj) return null;
                  const filePath = typeof obj.path === "string" ? obj.path.trim() : "";
                  if (!filePath) return null;
                  const kind = typeof obj.kind === "string" && obj.kind.trim() ? obj.kind.trim() : "update";
                  return {
                    path: filePath,
                    kind
                  };
                })
                .filter((value): value is { path: string; kind: string } => Boolean(value));
              const lines = normalizedChanges
                .slice(0, 30)
                .map((change) => `${change.kind}: ${change.path}`)
                .join("\n");
              if (normalizedChanges.length > 0) {
                updates.push({
                  type: "data",
                  name: "codex_file_change",
                  data: {
                    at: new Date().toISOString(),
                    changes: normalizedChanges
                  }
                });
              }
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "process",
                    at: new Date().toISOString(),
                    title: "File changes",
                    detail: lines,
                    event: eventType,
                    item_type: itemType
                  } satisfies ProcessData
                });
              }
            }

            if (itemType === "error" && processEnabled) {
              const message = typeof item?.message === "string" ? item.message : "";
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "error",
                  at: new Date().toISOString(),
                  title: "Execution error",
                  detail: userSafeProcessDetail(message, GENERIC_EXECUTION_ERROR_DETAIL),
                  rawDetail: shorten(message, 1200),
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
                  title: `Process event ${eventType}`,
                  detail: shorten(detailFromUnknown(item), 800),
                  event: eventType,
                  item_type: itemType,
                  status
                } satisfies ProcessData
              });
            }

            const dataPartChanged = appendDisplayDataParts(updates);
            const traceChanged = appendTraceBatch(updates);
            if (dataPartChanged || traceChanged || textChanged) {
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
          runningThreadKeys.forEach((key) => completedRunThreadIdsRef.current.add(key));
          const activeThreadKeys = normalizeThreadIdentityKeys(
            activeThreadIdentityRef.current.remoteId,
            activeThreadIdentityRef.current.localId
          );
          const completedInActiveThread = runningThreadKeys.some((key) => activeThreadKeys.includes(key));
          setActiveRunThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
          setRuntimeRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
          setCompletedNoticeThreadIds((prev) =>
            updateRunningThreadMapForKeys(prev, runningThreadKeys, !completedInActiveThread)
          );
          setStatusText("Ready");
          updateRunningStage(DEFAULT_RUNNING_STAGE_TEXT, { fallback: false });
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

  useEffect(() => {
    const threadsCore = (runtime as { _core?: { threads?: unknown } } | undefined)?._core?.threads as
      | {
          _hookManager?: { subscribe(callback: () => void): () => void };
          threadItems?: Record<string, { remoteId?: string; externalId?: string }>;
          getThreadRuntimeCore(threadIdOrRemoteId: string): unknown;
        }
      | undefined;
    const hookManager = threadsCore?._hookManager;
    if (!threadsCore || !hookManager || typeof hookManager.subscribe !== "function") {
      setRuntimeRunningThreadIds((prev) => (Object.keys(prev).length === 0 ? prev : {}));
      return undefined;
    }

    const syncRunningThreadIds = () => {
      const next: RunningThreadIdsContextValue = {};
      for (const [localId, item] of Object.entries(threadsCore.threadItems || {})) {
        const remoteId = typeof item?.remoteId === "string" ? item.remoteId.trim() : "";
        const externalId = typeof item?.externalId === "string" ? item.externalId.trim() : "";
        const runtimeLookupId = remoteId || externalId || localId;
        const identityKeys = normalizeThreadIdentityKeys(remoteId, externalId, localId);
        if (!runtimeLookupId || identityKeys.some((key) => next[key] || completedRunThreadIdsRef.current.has(key))) continue;
        try {
          if (isThreadRuntimeRunning(threadsCore.getThreadRuntimeCore(runtimeLookupId))) {
            for (const key of identityKeys) {
              next[key] = true;
            }
          }
        } catch {
          // Ignore threads whose runtime is not mounted yet.
        }
      }
      setRuntimeRunningThreadIds((prev) => (areRunningThreadMapsEqual(prev, next) ? prev : next));
    };

    syncRunningThreadIds();
    return hookManager.subscribe(syncRunningThreadIds);
  }, [runtime]);

  const skillDraftActionContext = useMemo(
    () => ({
      refreshRuntimeOptions: refreshRuntimeOptionsNow,
      async openNewSessionWithSkill(input: { skillName: string; managedSkillId?: string }) {
        const normalizedSkillName = input.skillName.trim();
        if (!normalizedSkillName) return;
        const nextOptions = await refreshRuntimeOptionsNow();
        const selectedMode = findRuntimeMode(nextOptions, runtimeModeRef.current) ?? nextOptions?.modes[0];
        const targetSkill = (selectedMode?.availableSkills ?? []).find(
          (skill) =>
            (input.managedSkillId && skill.managedSkillId === input.managedSkillId) || skill.name === normalizedSkillName
        );
        if (!targetSkill) {
          setErrorText(
            "The skill is installed, but it is not available in the current workbench mode yet. Ask an admin to check the mode binding."
          );
          return;
        }
        setEnabledSkillIds([targetSkill.id]);
        await runtime.threads.switchToNewThread();
        setStatusText(`New chat ready with ${targetSkill.label || targetSkill.name}`);
      },
      async installSkillFromPath(input: { threadId: string; path: string; prompt?: string }) {
        const threadId = input.threadId.trim();
        const skillPath = input.path.trim();
        if (!threadId || !skillPath) return null;
        const response = await installPortalSkillFromThreadPath({
          threadId,
          path: skillPath,
          prompt: input.prompt,
          modeId: runtimeModeRef.current
        });
        setStatusText(`Skill installed: ${response.skill.displayName || response.skill.skillName || response.skill.id}`);
        return response.skill;
      },
      async uninstallSkill(input: { skillId: string }) {
        const skillId = input.skillId.trim();
        if (!skillId) return null;
        const response = await uninstallPortalManagedSkill({ id: skillId });
        await refreshRuntimeOptionsNow();
        setStatusText(`Skill uninstalled: ${response.skill.displayName || response.skill.skillName || response.skill.id}`);
        return response.skill;
      }
    }),
    [refreshRuntimeOptionsNow, runtime]
  );

  const hasRunningSessions = Object.keys(runningThreadIds).length > 0;

  useEffect(() => {
    if (!hasRunningSessions || typeof window === "undefined") return undefined;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Modern browsers show their own localized unload text and ignore custom copy.
      event.returnValue = PORTAL_RUNNING_LEAVE_WARNING;
      return PORTAL_RUNNING_LEAVE_WARNING;
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [hasRunningSessions]);

  useEffect(() => {
    if (portalThreadRestoreSettled) return;
    const requestedThreadId = initialLocationThreadIdRef.current.trim();
    if (!requestedThreadId) {
      setPortalThreadRestoreSettled(true);
      return;
    }

    let cancelled = false;
    void runtime.threads
      .switchToThread(requestedThreadId)
      .catch((error) => {
        if (cancelled) return;
        setErrorText(error instanceof Error ? error.message : "Failed to restore current session");
      })
      .finally(() => {
        if (!cancelled) {
          setPortalThreadRestoreSettled(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [portalThreadRestoreSettled, runtime]);

  useEffect(() => {
    if (!portalThreadRestoreSettled) return;
    replacePortalThreadIdInLocation(activeRemoteThreadId);
  }, [activeRemoteThreadId, portalThreadRestoreSettled]);

  const subscriptionAccessContextValue = useMemo(
    () => ({
      status: subscriptionStatus,
      loading: subscriptionStatusLoading,
      errorText: subscriptionStatusError
    }),
    [subscriptionStatus, subscriptionStatusError, subscriptionStatusLoading]
  );
  const blockedSubscriptionStatus = isSubscriptionAccessBlocked(subscriptionStatus) ? subscriptionStatus : null;
  const subscriptionReminderStatus = !blockedSubscriptionStatus && shouldShowPortalSubscriptionReminder(subscriptionStatus)
    ? subscriptionStatus
    : null;
  const subscriptionReminderKey = portalSubscriptionReminderKey(blockedSubscriptionStatus ?? subscriptionReminderStatus);
  const externalInlineErrorText = isExternalPortalUser && !blockedSubscriptionStatus ? errorText : "";

  useEffect(() => {
    if (!isExternalPortalUser) return;
    if (!subscriptionReminderKey || subscriptionReminderKey === dismissedSubscriptionReminderKey) return;
    setSubscriptionReminderModalOpen(true);
  }, [dismissedSubscriptionReminderKey, isExternalPortalUser, subscriptionReminderKey]);

  const threadContent = (
    <div
      className={sharedThreadReadonly ? "thread-dropzone thread-dropzone-readonly" : "thread-dropzone"}
      aria-disabled={sharedThreadReadonly}
      onClickCapture={handleThreadLinkClickCapture}
    >
      {sharedThreadReadonly ? (
        <div className="thread-readonly-banner" role="status">
          <strong>Shared read-only thread</strong>
          <span>In shared view, you can read messages and attachments, but cannot continue running this thread.</span>
        </div>
      ) : null}
      {blockedSubscriptionStatus ? (
        <PortalAccessBlockedBanner status={blockedSubscriptionStatus} onOpenBilling={() => setBillingPanelOpen(true)} />
      ) : subscriptionReminderStatus ? (
        <PortalSubscriptionReminderBanner status={subscriptionReminderStatus} onOpenBilling={() => setBillingPanelOpen(true)} />
      ) : (
        <PortalInlineErrorBanner message={externalInlineErrorText} />
      )}
      <RunningThreadIdsContext.Provider value={runningThreadIds}>
        <ThreadPublicShareControls
          threadId={activeRemoteThreadId}
          disabled={sharedThreadReadonly}
          onStatusChange={setStatusText}
        >
        <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
          <AnswerFeedbackConfigContext.Provider value={answerFeedbackConfig}>
          <ExternalPortalUserContext.Provider value={isExternalPortalUser}>
          <PreviewRequestContext.Provider value={requestPreviewForPath}>
            <Thread
              key={`thread-view-${String(activeThreadIdentity.remoteId || activeThreadIdentity.localId || "empty")}`}
              strings={{
                threadList: {
                  new: { label: "New session" },
                  item: {
                    title: { fallback: "New conversation" }
                  }
                },
                composer: {
                  input: {
                    placeholder: composerPlaceholder
                  },
                  send: { tooltip: "Send message" },
                  cancel: { tooltip: "Stop generation" }
                }
              }}
              welcome={{
                message: welcomeMessage,
                suggestions: welcomeSuggestions
              }}
              assistantAvatar={assistantAvatar}
              components={{
                Composer: canUpload ? UploadAwareComposer : MobileAwareComposer,
                UserMessage: AgentUserMessage,
                AssistantMessage: AgentAssistantMessage,
                ThreadWelcome: DraftOnlyThreadWelcome
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
          </PreviewRequestContext.Provider>
          </ExternalPortalUserContext.Provider>
          </AnswerFeedbackConfigContext.Provider>
        </ActiveThreadIdContext.Provider>
        </ThreadPublicShareControls>
      </RunningThreadIdsContext.Provider>
      {sharedThreadReadonly ? (
        <div className="thread-readonly-shield" aria-hidden="true">
          <div className="thread-readonly-card">
            <p>This shared thread has switched to read-only mode.</p>
            <p>You can still browse existing messages and attachments.</p>
          </div>
        </div>
      ) : null}
    </div>
  );



  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PortalSubscriptionAccessContext.Provider value={subscriptionAccessContextValue}>
      <SkillComposerContext.Provider value={skillComposerContext}>
      <SkillDraftActionContext.Provider value={skillDraftActionContext}>
        <ActiveThreadIdentityBridge onChange={syncActiveThreadIdentity} />
        <ComposerActivationGuard runtime={runtime} />
        <ThreadRuntimeSubscriptionBridge runtime={runtime} />
        <BuildVersionRefreshActivityBridge hasRunningSessions={hasRunningSessions} />
        <RunningStageTextContext.Provider value={runningStageText}>
        <MobileWorkbenchContext.Provider value={isMobile}>
          <ConfigProvider theme={PORTAL_ANTD_THEME}>
            <div className="portal-workbench-root">
              <PortalTopBar
                sessionRailCollapsed={layoutState.isSessionRailCollapsed}
                onToggleRail={() => setLayoutState((prev) => toggleSessionRail(prev))}
                onOpenAdvancedSettings={() =>
                  setLayoutState((prev) =>
                    isExternalPortalUser
                      ? prev
                      : {
                          ...prev,
                          isAdvancedSettingsOpen: true
                        }
                  )
                }
                onToggleDrawer={() =>
                  setLayoutState((prev) =>
                    isExternalPortalUser
                      ? prev
                      : prev.isRightDrawerOpen
                        ? closeWorkbenchDrawer(prev)
                        : openWorkbenchDrawer(prev, "preview")
                  )
                }
                onOpenAdmin={props.onOpenAdmin}
                onOpenFeedback={openProductFeedbackModal}
                onOpenBilling={() => setBillingPanelOpen(true)}
                runtimeSummary={topbarRuntimeSummaryText}
                showRuntimeSummary={!isExternalPortalUser}
                showAdvancedSettings={!isExternalPortalUser}
                showRightPanelToggle={!isExternalPortalUser}
                drawerOpen={layoutState.isRightDrawerOpen}
                mobile={isMobile}
              />

              <div className="portal-workbench-body">
                {isMobile ? (
                  <div className="mobile-workbench-layout">
                    <Drawer
                      placement="left"
                      title="Sessions"
                      open={!layoutState.isSessionRailCollapsed}
                      width="min(360px, calc(100vw - 24px))"
                      styles={{ header: { padding: "12px 16px" }, body: { padding: 0 } }}
                      closable
                      push={false}
                      rootClassName="workbench-mobile-session-drawer"
                      onClose={() => setLayoutState((prev) => toggleSessionRail(prev))}
                    >
                      <ThreadList.Root>
                        <SessionRail
                          collapsed={layoutState.isSessionRailCollapsed}
                          userName={currentUserName}
                          searchValue={sessionSearchValue}
                          onSearchChange={setSessionSearchValue}
                          onCreateThread={() => undefined}
                          onToggleCollapsed={() => setLayoutState((prev) => toggleSessionRail(prev))}
                          newThreadSlot={<SessionRailNewThreadButton />}
                          footer={
                            <div className="session-rail-footer-stack">
                              {props.currentUser ? (
                                <UserIdentitySummary
                                  user={props.currentUser}
                                  compact
                                  onSignOut={props.onSignOut}
                                  locale="en"
                                  accessStatus={subscriptionStatus}
                                  accessStatusLoading={subscriptionStatusLoading}
                                  accessStatusError={subscriptionStatusError}
                                  onOpenAccessStatus={() => {
                                    void refreshPortalSubscriptionStatus();
                                  }}
                                />
                              ) : (
                                <p className="session-rail-user-fallback">{currentUserName}</p>
                              )}
                            </div>
                          }
                        >
                          <SessionSearchContext.Provider value={sessionSearchValue}>
                            <SessionGroupLabelContext.Provider value={sessionGroupLabelContext}>
                              <RunningThreadIdsContext.Provider value={runningThreadIds}>
                                <ThreadCompletionNoticeContext.Provider value={threadCompletionNoticeContext}>
                                  <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
                                    <StableThreadListItems />
                                  </ActiveThreadIdContext.Provider>
                                </ThreadCompletionNoticeContext.Provider>
                              </RunningThreadIdsContext.Provider>
                            </SessionGroupLabelContext.Provider>
                          </SessionSearchContext.Provider>
                        </SessionRail>
                      </ThreadList.Root>
                    </Drawer>

                    <main className="portal-workbench-chat flex-1" style={{ minHeight: 0 }}>
                      <div className="thread-wrap">
                        {canUpload && !sharedThreadReadonly ? (
                          <ComposerPrimitive.AttachmentDropzone asChild>{threadContent}</ComposerPrimitive.AttachmentDropzone>
                        ) : (
                          threadContent
                        )}
                      </div>
                    </main>

                    {layoutState.isRightDrawerOpen && (!isExternalPortalUser || requestedPreviewPath) && (
                      <Drawer
                        placement="right"
                        open={layoutState.isRightDrawerOpen}
                        width="100%"
                        styles={{ body: { padding: 0 } }}
                        closable={false}
                        push={false}
                        rootClassName="workbench-mobile-right-drawer"
                        onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                      >
                        <RightWorkbenchDrawer
                          open={layoutState.isRightDrawerOpen}
                          onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                          previewContent={
                            <PreviewWorkbenchPanel
                              threadId={activeRemoteThreadId}
                              requestedFilePath={requestedPreviewPath}
                              requestNonce={previewRequestNonce}
                              allowDownload
                              externalArtifactMode={isExternalPortalUser}
                            />
                          }
                          mobile
                        />
                      </Drawer>
                    )}
                  </div>
                ) : (
                  <PanelGroup orientation="horizontal" className="portal-workbench-layout">
                  {!layoutState.isSessionRailCollapsed && (
                    <>
                      <Panel defaultSize="20" minSize="15" maxSize="30" collapsible>
                        <ThreadList.Root>
                          <SessionRail
                            collapsed={layoutState.isSessionRailCollapsed}
                            userName={currentUserName}
                          searchValue={sessionSearchValue}
                          onSearchChange={setSessionSearchValue}
                          onCreateThread={() => undefined}
                          onToggleCollapsed={() => setLayoutState((prev) => toggleSessionRail(prev))}
                          newThreadSlot={<SessionRailNewThreadButton />}
                          footer={
                            <div className="session-rail-footer-stack">
                              {props.currentUser ? (
                                <UserIdentitySummary
                                    user={props.currentUser}
                                    compact
                                    onSignOut={props.onSignOut}
                                    locale="en"
                                    accessStatus={subscriptionStatus}
                                    accessStatusLoading={subscriptionStatusLoading}
                                    accessStatusError={subscriptionStatusError}
                                    onOpenAccessStatus={() => {
                                      void refreshPortalSubscriptionStatus();
                                    }}
                                  />
                                ) : (
                                  <p className="session-rail-user-fallback">{currentUserName}</p>
                                )}
                              </div>
                            }
                        >
                          <SessionSearchContext.Provider value={sessionSearchValue}>
                            <SessionGroupLabelContext.Provider value={sessionGroupLabelContext}>
                              <RunningThreadIdsContext.Provider value={runningThreadIds}>
                                <ThreadCompletionNoticeContext.Provider value={threadCompletionNoticeContext}>
                                  <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
                                    <StableThreadListItems />
                                  </ActiveThreadIdContext.Provider>
                                </ThreadCompletionNoticeContext.Provider>
                              </RunningThreadIdsContext.Provider>
                            </SessionGroupLabelContext.Provider>
                          </SessionSearchContext.Provider>
                        </SessionRail>
                      </ThreadList.Root>
                    </Panel>
                      <PanelResizeHandle className="Resizer" />
                    </>
                  )}

                  <Panel minSize="30">
                    <main className="portal-workbench-chat">
                      <div className="thread-wrap">
                        {canUpload && !sharedThreadReadonly ? (
                          <ComposerPrimitive.AttachmentDropzone asChild>{threadContent}</ComposerPrimitive.AttachmentDropzone>
                        ) : (
                          threadContent
                        )}
                      </div>
                    </main>
                  </Panel>

                  {layoutState.isRightDrawerOpen && (!isExternalPortalUser || requestedPreviewPath) && (
                    <>
                      <PanelResizeHandle className="Resizer" />
                      <Panel defaultSize="37.5" minSize="20" maxSize="40" className="right-drawer-panel">
                        <RightWorkbenchDrawer
                          open={layoutState.isRightDrawerOpen}
                          onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                          previewContent={
                            <PreviewWorkbenchPanel
                              threadId={activeRemoteThreadId}
                              requestedFilePath={requestedPreviewPath}
                              requestNonce={previewRequestNonce}
                              allowDownload
                              externalArtifactMode={isExternalPortalUser}
                            />
                          }
                        />
                      </Panel>
                    </>
                  )}
                </PanelGroup>
              )}
            </div>

            <Modal
              open={productFeedbackOpen}
              title="Send feedback"
              className="product-feedback-modal"
              okText={productFeedbackSubmitted ? "Submitted" : "Submit feedback"}
              cancelText="Cancel"
              okButtonProps={{
                disabled: !productFeedbackDescription.trim() || productFeedbackSubmitted,
                loading: productFeedbackSubmitting
              }}
              onOk={() => void submitProductFeedback()}
              onCancel={closeProductFeedbackModal}
              destroyOnHidden
            >
              <p className="product-feedback-modal-help">
                Tell us what happened or what would make {branding.platformName} better.
              </p>
              <label className="field product-feedback-field">
                <span className="field-label">Feedback type</span>
                <select
                  className="field-input"
                  value={productFeedbackType}
                  onChange={(event) => setProductFeedbackType(event.target.value as ProductFeedbackType)}
                  disabled={productFeedbackSubmitting}
                >
                  {PRODUCT_FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {productFeedbackType === "bug" ? (
                <label className="field product-feedback-field">
                  <span className="field-label">Impact</span>
                  <select
                    className="field-input"
                    value={productFeedbackSeverity}
                    onChange={(event) => setProductFeedbackSeverity(event.target.value as ProductFeedbackSeverity)}
                    disabled={productFeedbackSubmitting}
                  >
                    {PRODUCT_FEEDBACK_SEVERITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field product-feedback-field">
                <span className="field-label">Details</span>
                <Input.TextArea
                  value={productFeedbackDescription}
                  onChange={(event) => setProductFeedbackDescription(event.target.value)}
                  placeholder="What happened, or what should be improved?"
                  rows={5}
                  maxLength={4000}
                  showCount
                  disabled={productFeedbackSubmitting}
                />
              </label>
              <div className="product-feedback-field">
                <span className="field-label">Screenshots</span>
                <div className="product-feedback-upload-row">
                  <button
                    type="button"
                    className="product-feedback-upload-button"
                    onClick={() => productFeedbackImageInputRef.current?.click()}
                    disabled={productFeedbackSubmitting || productFeedbackImages.length >= PRODUCT_FEEDBACK_MAX_IMAGES}
                  >
                    <ImageIcon size={16} />
                    <span>Add image</span>
                  </button>
                  <span className="product-feedback-upload-hint">
                    Up to {PRODUCT_FEEDBACK_MAX_IMAGES} images, {formatFileSize(PRODUCT_FEEDBACK_MAX_IMAGE_BYTES)} each.
                  </span>
                </div>
                <input
                  ref={productFeedbackImageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  multiple
                  className="product-feedback-file-input"
                  onChange={handleProductFeedbackImageChange}
                  disabled={productFeedbackSubmitting}
                />
                {productFeedbackImages.length > 0 ? (
                  <div className="product-feedback-image-list">
                    {productFeedbackImages.map((image) => (
                      <div key={image.id} className="product-feedback-image-item">
                        <button
                          type="button"
                          className="product-feedback-image-preview-button"
                          onClick={() => setProductFeedbackPreviewImage(image)}
                          aria-label={`Preview ${image.file.name || "feedback screenshot"}`}
                        >
                          <img src={image.previewUrl} alt={image.file.name || "Feedback screenshot"} />
                        </button>
                        <div className="product-feedback-image-meta">
                          <span>{image.file.name || "Screenshot"}</span>
                          <small>{formatFileSize(image.file.size)}</small>
                        </div>
                        <button
                          type="button"
                          className="product-feedback-image-remove"
                          title="Remove screenshot"
                          aria-label="Remove screenshot"
                          onClick={() => removeProductFeedbackImage(image.id)}
                          disabled={productFeedbackSubmitting}
                        >
                          <XIcon size={14} />
                        </button>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
              <label className="product-feedback-context-toggle">
                <input
                  type="checkbox"
                  checked={productFeedbackIncludeContext}
                  onChange={(event) => setProductFeedbackIncludeContext(event.target.checked)}
                  disabled={productFeedbackSubmitting}
                />
                <span>Include current context so reviewers can reproduce it.</span>
              </label>
              {productFeedbackError ? <p className="product-feedback-error">{productFeedbackError}</p> : null}
              {productFeedbackSubmitted ? <p className="product-feedback-success">Feedback submitted.</p> : null}
            </Modal>
            <Modal
              open={Boolean(productFeedbackPreviewImage)}
              title={productFeedbackPreviewImage?.file.name || "Screenshot preview"}
              className="product-feedback-preview-modal"
              footer={null}
              centered
              width={900}
              onCancel={() => setProductFeedbackPreviewImage(null)}
              destroyOnHidden
            >
              {productFeedbackPreviewImage ? (
                <img
                  className="product-feedback-preview-image"
                  src={productFeedbackPreviewImage.previewUrl}
                  alt={productFeedbackPreviewImage.file.name || "Feedback screenshot preview"}
                />
              ) : null}
            </Modal>

            <Drawer
              placement="right"
              title={null}
              open={billingPanelOpen}
              onClose={() => setBillingPanelOpen(false)}
              width={isMobile ? "100%" : 440}
              styles={{ body: { padding: 0 } }}
              destroyOnHidden
            >
              <PortalBillingPanel
                subscriptionStatus={subscriptionStatus}
                onSubscriptionStatusChange={(nextStatus) => {
                  if (nextStatus) setSubscriptionStatus(nextStatus);
                }}
                onClose={() => setBillingPanelOpen(false)}
              />
            </Drawer>

            <Modal
              open={subscriptionReminderModalOpen}
              title={blockedSubscriptionStatus ? "Access expired" : "Renew Agent Studio"}
              okText={blockedSubscriptionStatus ? "Renew now" : "Choose renewal"}
              cancelText="Later"
              onOk={() => {
                setSubscriptionReminderModalOpen(false);
                setBillingPanelOpen(true);
              }}
              onCancel={() => {
                setDismissedSubscriptionReminderKey(subscriptionReminderKey);
                setSubscriptionReminderModalOpen(false);
              }}
              destroyOnHidden
            >
              <div className="portal-billing-reminder-modal">
                <p>{(blockedSubscriptionStatus ?? subscriptionReminderStatus)?.detail || (blockedSubscriptionStatus ?? subscriptionReminderStatus)?.summary}</p>
                {(blockedSubscriptionStatus ?? subscriptionReminderStatus)?.expiresAt ? (
                  <p>Expires at {formatPortalLocalTime((blockedSubscriptionStatus ?? subscriptionReminderStatus)!.expiresAt!)}</p>
                ) : null}
                <p>Plus Class includes 300 AI requests per month. PRO includes 1000 AI requests per month. Annual prepaid plans reduce the total yearly payment.</p>
              </div>
            </Modal>

            {!isExternalPortalUser ? (
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
                        onChange={handleKnowledgeSetChange}
                      />
                    ) : (
                      <p className="field-help knowledge-set-loading">Loading knowledge-set resources...</p>
                    )}
                    {resourceErrorText ? <p className="err-text knowledge-set-error">{resourceErrorText}</p> : null}
                  </div>

                  <label className="field checkbox-field">
                    <span className="field-label">Show process trace</span>
                    <input
                      type="checkbox"
                      checked={showProcessTrace}
                      onChange={(e) => void handleShowProcessTraceChange(e.target.checked)}
                      disabled={portalPreferenceSaving}
                    />
                    <span className="field-help">Show reasoning summaries, tool calls, and execution steps in messages.</span>
                  </label>

                  <label className="field checkbox-field">
                    <span className="field-label">Collapse final trace when done</span>
                    <input
                      type="checkbox"
                      checked={collapseFinalTraceOnDone}
                      onChange={(e) => void handleCollapseFinalTraceOnDoneChange(e.target.checked)}
                      disabled={!showProcessTrace || portalPreferenceSaving}
                    />
                    <span className="field-help">When enabled, only the final conclusion remains expanded and completed traces collapse by default.</span>
                  </label>

                  {portalPreferenceErrorText ? <p className="err-text">{portalPreferenceErrorText}</p> : null}

                  <label className="field">
                    <span className="field-label">Policy mode</span>
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
                    <span className="field-help">Provided by `/api/portal/runtime-options`; employees can only choose allowed policies.</span>
                  </label>

                  {selectedMode ? (
                    <div className="field">
                      <span className="field-label">Policy snapshot</span>
                      <RuntimeProfileView profile={selectedMode.runtimeProfile} />
                      <span className="field-help">The runtime parameters below are determined by the run profile bound to the current policy mode.</span>
                    </div>
                  ) : null}

                  <div className="status-box">
                    <p>
                      <strong>Status: </strong>
                      {statusText}
                    </p>
                    <p>
                      <strong>Attachment policy: </strong>
                      {runtimeOptions?.canUpload ? "Upload allowed" : "Uploads currently disabled"}
                    </p>
                    <p className="field-help">Runtime setting changes take effect automatically in the next turn.</p>
                    {errorText ? <p className="err-text">{errorText}</p> : null}
                  </div>
                </div>
              </AdvancedSettingsPanel>
            ) : null}
          </div>
        </ConfigProvider>
        {pickerOpen ? (
          <div className="dir-modal-mask" onClick={() => setPickerOpen(false)}>
            <div className="dir-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dir-modal-head">
              <h3>{pickerTarget === "workspace" ? "Select workspace directory" : "Select additional directory"}</h3>
              <button type="button" className="picker-btn" onClick={() => setPickerOpen(false)}>
                Close
              </button>
            </div>
            <div className="dir-path-input-row">
              <input
                className="field-input dir-path-input"
                value={pickerPathInput}
                onChange={(e) => onPickerPathInputChange(e.target.value)}
                onKeyDown={onPickerPathInputKeyDown}
                placeholder="Enter a directory path to jump and load subdirectories"
              />
              <button
                type="button"
                className="picker-btn"
                onClick={jumpToDirectoryFromInput}
                disabled={pickerLoading}
              >
                Jump
              </button>
            </div>
            <p className="dir-modal-current">Current directory: {pickerCwd || "..."}</p>
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
                Up one level
              </button>
              <button
                type="button"
                className="picker-btn"
                onClick={() => selectDirectory(pickerCwd)}
                disabled={!pickerCwd || pickerLoading}
              >
                {pickerTarget === "workspace" ? "Set as workspace" : "Add current directory"}
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
              {pickerLoading ? <p className="trace-empty">Loading directories...</p> : null}
              {!pickerLoading && pickerDirectories.length === 0 ? (
                <p className="trace-empty">No subdirectories available in the current directory.</p>
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
                        Select
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
            </div>
          </div>
        ) : null}
        </MobileWorkbenchContext.Provider>
        </RunningStageTextContext.Provider>
      </SkillDraftActionContext.Provider>
      </SkillComposerContext.Provider>
      </PortalSubscriptionAccessContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export default PortalShell;
