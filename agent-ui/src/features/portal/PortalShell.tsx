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
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren
} from "react";
import { createPortal } from "react-dom";
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  RuntimeAdapterProvider,
  ThreadPrimitive,
  ThreadListItemPrimitive,
  useAui,
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
  Thread,
  UserMessage,
  ThreadWelcome,
  ThreadList,
  makeMarkdownText
} from "@assistant-ui/react-ui";
import { CheckIcon, PencilIcon, RefreshCwIcon, Share2Icon, ThumbsDownIcon, Trash2Icon, XIcon } from "lucide-react";
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
import { ConfigProvider, Input, Modal } from "antd";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

import { api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
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
import { ThreadCollaborationPanel } from "../collaboration/ThreadCollaborationPanel";
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
import { MARKDOWN_REMARK_PLUGINS, MarkdownTable } from "../markdown/markdown-rendering";
import { PortalTopBar } from "./workbench/PortalTopBar";
import { fetchPortalSubscriptionStatus, type PortalSubscriptionStatus } from "./api";
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

type SessionGroupLabelContextValue = {
  groupHeaderByRemoteId: Record<string, string>;
};

const DEFAULT_WORKSPACE = ".";

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
  { value: "bug", label: "Bug" },
  { value: "feature_request", label: "Feature request" },
  { value: "usability_issue", label: "Usability issue" },
  { value: "other", label: "Other" }
];
const PRODUCT_FEEDBACK_SEVERITY_OPTIONS: Array<{ value: ProductFeedbackSeverity; label: string }> = [
  { value: "blocking", label: "Blocking" },
  { value: "high", label: "High" },
  { value: "medium", label: "Medium" },
  { value: "low", label: "Low" }
];
const DEFAULT_RUNNING_STAGE_TEXT = "Waiting for model response";
const RunningStageTextContext = createContext(DEFAULT_RUNNING_STAGE_TEXT);
const SessionSearchContext = createContext("");
const SessionGroupLabelContext = createContext<SessionGroupLabelContextValue>({
  groupHeaderByRemoteId: {}
});
const ActiveThreadIdContext = createContext("");
const PreviewRequestContext = createContext<(filePath: string) => void>(() => undefined);
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
  remarkPlugins: MARKDOWN_REMARK_PLUGINS,
  components: {
    table: MarkdownTable as any,
    a: AssistantMarkdownLink as any,
    img: AssistantMarkdownImage as any
  }
});

const DraftOnlyWelcomeSuggestions: FC = () => (
  <div className="aui-thread-welcome-suggestions">
    {PORTAL_STARTER_SUGGESTIONS.map((suggestion, index) => (
      <ThreadPrimitive.Suggestion
        key={`${suggestion.prompt}-${index}`}
        className="aui-thread-welcome-suggestion"
        prompt={suggestion.prompt}
        send={false}
        clearComposer
      >
        <span className="aui-thread-welcome-suggestion-text">{suggestion.text ?? suggestion.prompt}</span>
      </ThreadPrimitive.Suggestion>
    ))}
  </div>
);

const DraftOnlyThreadWelcome: FC = () => (
  <ThreadWelcome.Root>
    <ThreadWelcome.Center>
      <ThreadWelcome.Avatar />
      <ThreadWelcome.Message />
    </ThreadWelcome.Center>
    <DraftOnlyWelcomeSuggestions />
  </ThreadWelcome.Root>
);

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
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

function formatAssistantErrorNotice(detail: string): string {
  const normalized = detail.replace(/\s+/g, " ").trim();
  if (!normalized) return "I couldn't complete this response. Please try again.";

  if (/conversation limit reached/i.test(normalized)) {
    return "Conversation limit reached. Please wait for the next reset or contact your workspace admin.";
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
  if (/service capacity|token limit|temporarily unavailable/i.test(normalized)) {
    return "This workspace is temporarily unavailable. Please try again after the next reset or contact your workspace admin.";
  }

  return `I couldn't complete this response. ${normalized}`;
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
    const msg = (data && typeof data.detail === "string" && data.detail) || `Upload failed (${res.status})`;
    throw new Error(msg);
  }

  return uploadedMetaFromUnknown((data as { attachment?: unknown }).attachment);
}

function buildUploadedAttachmentHint(meta: UploadedAttachmentMeta): string {
  return [
    `<uploaded_file name=${JSON.stringify(meta.name)} path=${JSON.stringify(meta.path)} relativePath=${JSON.stringify(meta.relativePath)} mimeType=${JSON.stringify(meta.mimeType)} bytes=${meta.size}>`,
    "The file has been uploaded to the workspace. Use filesystem tools to read this path instead of assuming the content is already in context.",
    "</uploaded_file>"
  ].join("\n");
}

class WorkspaceFileAttachmentAdapter implements AttachmentAdapter {
  public accept = "*";

  constructor(private readonly resolveThreadId: () => Promise<string>) {}

  public async add(state: { file: File }): Promise<PendingAttachment> {
    const name = fileNameFromUnknown(state.file.name, "Untitled file");
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
      throw new Error("Failed to initialize the current session. Please try again.");
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
  const runConfig: Record<string, unknown> = {
    sandboxMode: cfg.sandboxMode,
    approvalPolicy: cfg.approvalPolicy,
    networkAccessEnabled: cfg.networkAccessEnabled,
    webSearchMode: cfg.webSearchMode,
    mode
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

function stageTextForCodexItem(
  itemType: string,
  lifecycle: "started" | "completed",
  item: Record<string, unknown> | null
): string {
  if (lifecycle === "started") {
    if (itemType === "reasoning") return "Reasoning about a solution";
    if (itemType === "command_execution") {
      const command = typeof item?.command === "string" ? ellipsizeSingleLine(item.command, 28) : "";
      return command ? `Running command: ${command}` : "Running command";
    }
    if (itemType === "mcp_tool_call") {
      const server = typeof item?.server === "string" ? item.server.trim() : "";
      const tool = typeof item?.tool === "string" ? item.tool.trim() : "";
      const toolName = [server, tool].filter(Boolean).join(".");
      return toolName ? `Calling tool: ${ellipsizeSingleLine(toolName, 30)}` : "Calling tool";
    }
    if (itemType === "web_search") {
      const query = typeof item?.query === "string" ? ellipsizeSingleLine(item.query, 20) : "";
      return query ? `Searching resources: ${query}` : "Searching resources";
    }
    if (itemType === "todo_list") return "Updating execution plan";
    if (itemType === "file_change") return "Writing file changes";
    if (itemType === "agent_message") return "Generating response";
    if (itemType === "error") return "Handling error details";
    return "Running step";
  }

  if (itemType === "reasoning") return "Reasoning completed, continuing";
  if (itemType === "command_execution") return "Command execution completed";
  if (itemType === "mcp_tool_call") return "Tool call completed";
  if (itemType === "web_search") return "Search completed, summarizing results";
  if (itemType === "todo_list") return "Execution plan updated";
  if (itemType === "file_change") return "File changes written";
  if (itemType === "agent_message") return "Generating response";
  if (itemType === "error") return "Execution error detected";
  return "Step completed, continuing";
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
    .replace(/<uploaded_file[\s\S]*?<\/uploaded_file>/gi, "uploaded file")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "New conversation";
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
  if (!normalized || normalized === "update" || normalized === "updated") return "Updated";
  if (normalized === "create" || normalized === "created" || normalized === "add" || normalized === "added") return "Added";
  if (normalized === "delete" || normalized === "deleted" || normalized === "remove" || normalized === "removed") return "Deleted";
  if (normalized === "rename" || normalized === "renamed" || normalized === "move" || normalized === "moved") return "Renamed";
  return kind.trim() || "Change";
}

function collectCodexFileChanges(data: unknown): Array<{ path: string; kind: string }> {
  const payload = asRecord(data);
  if (!payload) return [];
  const changes = Array.isArray(payload.changes) ? payload.changes : [];
  const dedup = new Set<string>();
  const out: Array<{ path: string; kind: string }> = [];

  for (const item of changes) {
    const obj = asRecord(item);
    if (!obj) continue;
    const path = normalizePreviewFilePath(asString(obj.path));
    if (!path) continue;
    const kind = asString(obj.kind) || "update";
    const key = `${kind}::${path}`;
    if (dedup.has(key)) continue;
    dedup.add(key);
    out.push({ path, kind });
  }

  return out;
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
        <span className="assistant-running-title">Processing request</span>
        <span className="assistant-running-chip">Live</span>
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
  const requestPreview = useContext(PreviewRequestContext);

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
    if (changes.length === 0) return null;
    return (
      <section className="assistant-file-change-block" aria-label="File changes">
        <p className="assistant-file-change-title">Generated files</p>
        <ul className="assistant-file-change-list">
          {changes.map((item) => {
            const label = fileChangeKindLabel(item.kind);
            return (
              <li key={`${item.kind}-${item.path}`} className="assistant-file-change-item">
                <div className="assistant-file-change-meta">
                  <span className="assistant-file-change-kind">{label}</span>
                  <span className="assistant-file-change-name">{fileNameFromPreviewPath(item.path)}</span>
                </div>
                <div className="assistant-file-change-actions">
                  <button type="button" className="assistant-file-change-btn" onClick={() => requestPreview(item.path)}>
                    Preview
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
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

    if (type === "data" && p.name === "codex_file_change") {
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

const ThreadPublicShareMessageShell: FC<{ tone: "user" | "assistant"; children: ReactNode }> = ({ tone, children }) => {
  const messageId = useAuiState((s) => s.message.id);
  const selection = useContext(ThreadPublicShareSelectionContext);
  const selectable = selection.selectionMode && Boolean(selection.leadTurnIdByMessageId[messageId]);

  return (
    <div
      className={
        selectable
          ? `thread-public-share-message-shell thread-public-share-message-shell-${tone} is-selectable`
          : `thread-public-share-message-shell thread-public-share-message-shell-${tone}`
      }
    >
      {selectable ? <ThreadPublicShareTurnCheckbox /> : null}
      {children}
    </div>
  );
};

const AgentUserMessage: FC = () => {
  return (
    <ThreadPublicShareMessageShell tone="user">
      <UserMessage />
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
    void api(`/api/threads/${encodeURIComponent(remoteId)}/feedback`, {
      method: "POST",
      json: {
        type: "negative",
        message_id: messageId,
        content_preview: messageTextForSuggestions(message as ThreadMessage),
        comment: normalizedComment
      }
    })
      .then(() => {
        const metadata = message.metadata as { custom?: Record<string, unknown> };
        const previousCustom = asRecord(metadata.custom) || {};
        const previousFeedback = asRecord(previousCustom.feedback) || {};
        metadata.custom = {
          ...previousCustom,
          feedback: {
            ...previousFeedback,
            type: "negative",
            comment: normalizedComment
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
        if (draftsRef?.current.skipNextSubmit?.type === "negative") {
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
            Empty: RunningMessagePlaceholder as any,
            Reasoning: ReasoningPart as any,
            Source: SourcePart as any,
            data: { Fallback: ProcessDataFallback as any }
          }}
        />
        <BranchPicker />
        <AgentAssistantActionBar />
      </AssistantMessage.Root>
    </ThreadPublicShareMessageShell>
  );
};

const AgentThreadListItem: FC = () => {
  const aui = useAui();
  const threadItemId = useAuiState((s) => s.threadListItem.id);
  const threadRemoteId = useAuiState((s) => s.threadListItem.remoteId);
  const threadTitle = useAuiState((s) => (typeof s.threadListItem.title === "string" ? s.threadListItem.title : ""));
  const sessionSearchQuery = useContext(SessionSearchContext).trim().toLowerCase();
  const groupHeaderByRemoteId = useContext(SessionGroupLabelContext).groupHeaderByRemoteId;
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameSaving, setRenameSaving] = useState(false);
  const [renameDraft, setRenameDraft] = useState("");
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const remoteId = String(threadRemoteId || "").trim();
  const groupLabel = remoteId ? groupHeaderByRemoteId[remoteId] || "" : "";
  const threadTitleForFilter = threadTitle.trim() || "New conversation";

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
      const detail = error instanceof Error ? error.message : "Failed to rename session";
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
    <>
      {!sessionSearchQuery && groupLabel ? <p className="session-rail-group-divider">{groupLabel}</p> : null}
      <ThreadListItemPrimitive.Root className="aui-thread-list-item agent-thread-list-item">
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
          <ThreadListItemPrimitive.Trigger className="aui-thread-list-item-trigger">
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
          ) : (
            <button
              type="button"
              className="thread-item-action-btn"
              title="Rename session"
              aria-label="Rename session"
              onClick={beginRename}
            >
              <PencilIcon size={14} />
            </button>
          )}
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
        </div>
      </ThreadListItemPrimitive.Root>
    </>
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
  const turns = useMemo(() => groupThreadMessagesIntoPublicShareTurns(messages), [messages]);
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
      <div className="thread-public-share-shell" data-share-selection-mode={selectionMode ? "true" : "false"}>
        {children}
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
            const revived = reviveMessage(item.message);
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
        const messageId = payload.message.id;
        const store = feedbackCommentDraftsRef.current;
        if (store.skipNextSubmit?.type === payload.type) {
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
  const { branding } = useBranding();
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
  const [layoutState, setLayoutState] = useState(createInitialLayoutState());
  const [sessionSearchValue, setSessionSearchValue] = useState("");
  const [sessionGroupLabelContext, setSessionGroupLabelContext] = useState<SessionGroupLabelContextValue>({
    groupHeaderByRemoteId: {}
  });
  const [activeThreadIdentity, setActiveThreadIdentity] = useState<ThreadIdentity>({});
  const [threadCollaboration, setThreadCollaboration] = useState<ThreadCollaborationView | null>(null);
  const [threadCollaborationLoading, setThreadCollaborationLoading] = useState(false);
  const [threadCollaborationErrorText, setThreadCollaborationErrorText] = useState("");
  const [requestedPreviewPath, setRequestedPreviewPath] = useState("");
  const [previewRequestNonce, setPreviewRequestNonce] = useState(0);
  const [productFeedbackOpen, setProductFeedbackOpen] = useState(false);
  const [productFeedbackType, setProductFeedbackType] = useState<ProductFeedbackType>("bug");
  const [productFeedbackSeverity, setProductFeedbackSeverity] = useState<ProductFeedbackSeverity>("medium");
  const [productFeedbackDescription, setProductFeedbackDescription] = useState("");
  const [productFeedbackIncludeContext, setProductFeedbackIncludeContext] = useState(true);
  const [productFeedbackSubmitting, setProductFeedbackSubmitting] = useState(false);
  const [productFeedbackError, setProductFeedbackError] = useState("");
  const [productFeedbackSubmitted, setProductFeedbackSubmitted] = useState(false);

  const [statusText, setStatusText] = useState("Ready");
  const [runningStageText, setRunningStageText] = useState(DEFAULT_RUNNING_STAGE_TEXT);
  const [errorText, setErrorText] = useState("");
  const [resourceErrorText, setResourceErrorText] = useState("");
  const [showProcessTrace, setShowProcessTrace] = useState(() => props.currentUser?.userType !== "external_user");
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
  const initialLocationThreadIdRef = useRef(
    typeof window === "undefined" ? "" : readPortalThreadIdFromLocation(window.location.search)
  );
  const [portalThreadRestoreSettled, setPortalThreadRestoreSettled] = useState(() => !initialLocationThreadIdRef.current);

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
  const knowledgeSetSelectionInitializedRef = useRef(false);
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
  const pickerRequestSeqRef = useRef(0);
  const pickerAutoJumpTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshPortalSubscriptionStatusRef = useRef<(options?: { silent?: boolean }) => Promise<void>>(async () => undefined);

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
        setErrorText(error instanceof Error ? error.message : "Failed to load runtime policies");
      }
    }

    void loadRuntimeOptions();
    return () => {
      active = false;
    };
  }, []);

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
            groupHeaderByRemoteId[thread.id] = groupLabel;
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

  const canUpload = runtimeOptions?.canUpload ?? false;
  const selectedMode = findRuntimeMode(runtimeOptions, runtimeMode);
  const modeOptions = resolveModeOptions(runtimeOptions?.modes ?? [], runtimeMode);
  const selectedModeLabel = resolveModeLabel(runtimeOptions?.modes ?? [], runtimeMode);
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
  const isExternalPortalUser = props.currentUser?.userType === "external_user";
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
        knowledgeSetIds: selectedKnowledgeSetIdsNormalized
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
    selectedKnowledgeSetIdsNormalized,
    selectedModeLabel,
    sharedThreadReadonly
  ]);

  const openProductFeedbackModal = useCallback(() => {
    setProductFeedbackOpen(true);
    setProductFeedbackError("");
    setProductFeedbackSubmitted(false);
  }, []);

  const closeProductFeedbackModal = useCallback(() => {
    if (productFeedbackSubmitting) return;
    setProductFeedbackOpen(false);
    setProductFeedbackError("");
    setProductFeedbackSubmitted(false);
  }, [productFeedbackSubmitting]);

  const submitProductFeedback = useCallback(async () => {
    const description = productFeedbackDescription.trim();
    if (!description || productFeedbackSubmitting) return;
    setProductFeedbackSubmitting(true);
    setProductFeedbackError("");
    try {
      await api<{ feedback: { id: string; status: string; created_at: string } }>("/api/portal/feedback", {
        method: "POST",
        json: {
          type: productFeedbackType,
          ...(productFeedbackType === "bug" ? { severity: productFeedbackSeverity } : {}),
          description,
          ...(activeRemoteThreadId ? { thread_id: activeRemoteThreadId } : {}),
          ...(productFeedbackIncludeContext ? { context: buildProductFeedbackContext() } : {})
        }
      });
      setProductFeedbackSubmitted(true);
      setProductFeedbackDescription("");
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
    productFeedbackIncludeContext,
    productFeedbackSeverity,
    productFeedbackSubmitting,
    productFeedbackType
  ]);

  const requestPreviewForPath = useCallback((filePath: string) => {
    if (isExternalPortalUser) return;
    const normalizedPath = normalizePreviewFilePath(filePath);
    if (!normalizedPath) return;
    setRequestedPreviewPath(normalizedPath);
    setPreviewRequestNonce((value) => value + 1);
    setLayoutState((prev) => switchWorkbenchTab(openWorkbenchDrawer(prev), "preview"));
  }, [isExternalPortalUser]);

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
      if (!prev.isRightDrawerOpen && !prev.isAdvancedSettingsOpen) {
        return prev;
      }
      return {
        ...prev,
        isRightDrawerOpen: false,
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
        setStatusText("Generating...");
        updateRunningStage("Request submitted, waiting for model response");

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

        const appendDisplayDataParts = (parts: any[]): boolean => {
          if (parts.length === 0) return false;
          let changed = false;
          for (const part of parts) {
            const partObj = asRecord(part);
            if (!partObj || partObj.type !== "data") continue;
            const name = typeof partObj.name === "string" ? partObj.name.trim() : "";
            if (name !== "codex_file_change") continue;
            activeTextPart = null;
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
                (payload && typeof payload.detail === "string" ? payload.detail : "") || "Request failed";
              const assistantErrorNotice = formatAssistantErrorNotice(detail);
              setErrorText(detail);
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
                    detail: shorten(detail, 1400)
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
              throw new Error(detail);
            }

            if (event === "done") {
              doneAnswer =
                payload && typeof payload.answer === "string" ? payload.answer : "";
              void refreshPortalSubscriptionStatusRef.current({ silent: true });
              updateRunningStage("Response generation completed");
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
                    title: "Response completed"
                  } satisfies ProcessData
                });
              }
              const dataPartChanged = appendDisplayDataParts(updates);
              const traceChanged = appendTraceBatch(updates);
              if (traceChanged && collapseFinalTraceOnDoneEnabled) {
                collapseLatestTraceBatch();
              }
              if (dataPartChanged || traceChanged || textChanged) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event === "meta") {
              updateRunningStage("Session established, starting execution");
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
                  title: `Tool call ${errMsg ? "Failed" : "Completed"}`,
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
          setStatusText("Ready");
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
      <ThreadPublicShareControls
        threadId={activeRemoteThreadId}
        disabled={sharedThreadReadonly}
        onStatusChange={setStatusText}
      >
        <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
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
                    placeholder: canUpload ? "Type your question directly. Any attachments are supported; you can also drag files into the chat window." : "Type your question directly"
                  },
                  send: { tooltip: "Send message" },
                  cancel: { tooltip: "Stop generation" }
                }
              }}
              welcome={{
                message: `Hello, I'm your ${assistantDisplayName}. Ask about products, versions, deployment, alarms, or troubleshooting.`,
                suggestions: PORTAL_STARTER_SUGGESTIONS
              }}
              assistantAvatar={assistantAvatar}
              components={{
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
        </ActiveThreadIdContext.Provider>
      </ThreadPublicShareControls>
      {sharedThreadReadonly ? (
        <div className="thread-readonly-shield" aria-hidden="true">
          <div className="thread-readonly-card">
            <p>This shared thread has switched to read-only mode.</p>
            <p>You can still browse messages, attachments, and comments in the right collaboration panel.</p>
          </div>
        </div>
      ) : null}
    </div>
  );

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ComposerActivationGuard runtime={runtime} />
      <ThreadRuntimeSubscriptionBridge runtime={runtime} />
      <RunningStageTextContext.Provider value={runningStageText}>
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
              runtimeSummary={runtimeSummaryText}
              showRuntimeSummary={!isExternalPortalUser}
              showAdvancedSettings={!isExternalPortalUser}
              showRightPanelToggle={!isExternalPortalUser}
              drawerOpen={layoutState.isRightDrawerOpen}
              activeDrawerTab={layoutState.activeRightDrawerTab}
            />

            <div className="portal-workbench-body">
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
                  newThreadSlot={<ThreadList.New aria-label="New session" className="session-rail-new-btn" />}
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
                      <ThreadList.Items
                        components={{
                          ThreadListItem: AgentThreadListItem as any
                        }}
                      />
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

                {!isExternalPortalUser && layoutState.isRightDrawerOpen && (
                  <>
                    <PanelResizeHandle className="Resizer" />
                    <Panel defaultSize="25" minSize="20" maxSize="40" className="right-drawer-panel">

            <RightWorkbenchDrawer
              open={layoutState.isRightDrawerOpen}
              activeTab={layoutState.activeRightDrawerTab}
              onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
              onTabChange={(tab) => setLayoutState((prev) => switchWorkbenchTab(prev, tab))}
              previewContent={
                <PreviewWorkbenchPanel
                  threadId={activeRemoteThreadId}
                  requestedFilePath={requestedPreviewPath}
                  requestNonce={previewRequestNonce}
                  allowDownload={!isExternalPortalUser}
                />
              }
              collaborationContent={
                <div className="workbench-collaboration-content">
                  <section className="workbench-priority-card">
                    <h3>Priority B: Comments and @mentions</h3>
                    <p>Align on context and disagreements first. Comments are tracked in real time for follow-up.</p>
                  </section>
                  <section className="workbench-priority-card">
                    <h3>Priority D: Owner and follow-up</h3>
                    <p>Assign owner and followers so every action has clear accountability.</p>
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
                    </Panel>
                  </>
                )}
              </PanelGroup>
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
                      onChange={(e) => setShowProcessTrace(e.target.checked)}
                    />
                    <span className="field-help">Show reasoning summaries, tool calls, and execution steps in messages.</span>
                  </label>

                  <label className="field checkbox-field">
                    <span className="field-label">Collapse final trace when done</span>
                    <input
                      type="checkbox"
                      checked={collapseFinalTraceOnDone}
                      onChange={(e) => setCollapseFinalTraceOnDone(e.target.checked)}
                      disabled={!showProcessTrace}
                    />
                    <span className="field-help">When enabled, only the final conclusion remains expanded and completed traces collapse by default.</span>
                  </label>

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
      </RunningStageTextContext.Provider>
    </AssistantRuntimeProvider>
  );
}

export default PortalShell;
