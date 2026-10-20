import {
  type ChangeEvent as ReactChangeEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { flushSync } from "react-dom";
import {
  AssistantRuntimeProvider,
  type ChatModelAdapter,
  ComposerPrimitive,
  type ThreadMessage,
  unstable_useRemoteThreadListRuntime as useRemoteThreadListRuntime,
  useLocalRuntime
} from "@assistant-ui/react";
import { ThreadList } from "@assistant-ui/react-ui";
import { AlertCircleIcon, ChevronLeft, ChevronRight, Folder, ImageIcon, XIcon } from "lucide-react";
import { createAssistantStream, type AssistantStream } from "assistant-stream";
import { type RemoteThreadListAdapter } from "@assistant-ui/core";
import { Button, ConfigProvider, Drawer, Input, Modal } from "antd";
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from "react-resizable-panels";

import { ApiError, api, apiBase, authHeaders, notifyAuthInvalidStatus } from "../../lib/api";
import {
  DEFAULT_MODEL,
  contextLimitForModel,
  modelOptionsFromCatalog,
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
import { reconcileAuthoritativeFinalAnswer } from "./stream-final-answer";
import { pendingPortalUserMessageAppend } from "./pending-user-message";
import { resolveThreadReadOnlyPresentation } from "./training-readonly-policy";
import type { AuthUser } from "../auth/api";
import { useAuth } from "../auth/AuthProvider";
import { isInternalPortalExperience } from "../auth/portal-experience";
import { PortalTopBar } from "./workbench/PortalTopBar";
import { localToolResultObject, upsertLocalToolParts } from "./workbench/local-tool-parts";
import { useLocalBridgeEntryVisibility } from "./local-bridge-visibility";
import { LocalWorkspaceContext, LocalWorkspaceDialogs, useLocalWorkspace } from "./workbench/LocalWorkspace";
import { PortalThread, PortalThreadSwitchingPlaceholder } from "./PortalThread";
import { reportClientError } from "../../lib/client-error-report";
import { reportSendFailure, shouldBrowserReportSendFailure } from "../../lib/send-failure-report";
import { PortalThreadErrorBoundary } from "./PortalThreadErrorBoundary";
import { resolvePortalChatRecoveryActive } from "./chat-recovery";
import { completedAssistantContentForParent, isPortalTransportDisconnect } from "./background-run-recovery";
import {
  createPortalServerThreadId,
  pendingServerThreads,
  setPortalSendProtocol,
  singleRequestSendSupported,
  type PendingServerThread
} from "./pending-server-threads";
import {
  PortalSendNotDeliveredError,
  streamPortalSendWithRetry,
  type PortalSendAttemptResult
} from "./portal-send-transport";
import { PortalBillingPanel } from "./PortalBillingPanel";
import { fetchPortalSubscriptionStatus, type PortalSubscriptionStatus } from "./api";
import { usePortalI18n } from "./i18n";
import {
  PortalComposerWorkflowProvider,
  type PortalSteerOptions,
  usePortalComposerWorkflowController
} from "./composer-workflow";
import {
  PortalBackgroundRunContext,
  USER_INPUT_REQUEST_PART_NAME,
  UserInputReadOnlyContext
} from "./user-input-request";
import { installPortalSkillFromThreadPath, uninstallPortalManagedSkill } from "../skills/api";
import { getBrandInitials } from "../branding/BrandMark";
import { useBranding } from "../branding/BrandingProvider";
import {
  WorkspaceRail,
  AGENT_OUTPUTS_WORKSPACE_VIEW,
  RECENT_WORKSPACE_VIEW,
  TRASH_WORKSPACE_VIEW,
  WORKSPACE_RAIL_TASK_LIMIT
} from "./workbench/WorkspaceRail";
import { expandWorkspaceFolderIds } from "./workspace-folder-state";
import {
  startWorkspaceTaskInFolder,
  switchToExistingWorkspaceTask,
  type ExistingTaskSwitchGate
} from "./workspace-task-navigation";
import { filterStaleRuntimeThreadIds } from "./thread-running-state";
import { WorkspaceFolderHome } from "./workbench/WorkspaceFolderHome";
import { CreateWorkspaceFolderModal } from "./workbench/CreateWorkspaceFolderModal";
import { WorkspaceTaskFilesPanel } from "./workbench/WorkspaceTaskFilesPanel";
import { RightWorkbenchDrawer } from "./workbench/RightWorkbenchDrawer";
import { PreviewWorkbenchPanel } from "./workbench/PreviewWorkbenchPanel";
import { AdvancedSettingsPanel } from "./workbench/AdvancedSettingsPanel";
import { inlineReferencePlainText } from "./inline-references";
import {
  closeWorkbenchDrawer,
  openWorkbenchDrawer,
  switchWorkbenchTab
} from "./workbench/layout-state";
import { useWorkbenchLayout } from "./workbench/use-workbench-layout";
import { createPortalAntdTheme } from "./workbench/theme";
import { HomeProfileProvider } from "./roadmap/home-profile";
import { AccountMenu } from "./roadmap/AccountMenu";
import { AutomationRailSection } from "./roadmap/AutomationRailSection";
import { tourTarget } from "./roadmap/OnboardingTour";
import { PortalRoadmapProvider } from "./roadmap/PortalRoadmapContext";
import { usePortalTheme } from "./roadmap/use-portal-theme";
import { dispatchPortalRunFinished, useRunCompletionAttention } from "./roadmap/run-attention";
import { updatePortalPreferences } from "./roadmap/api";
import { useIsNarrowScreen } from "../../lib/use-is-narrow-screen";
import { orderAssistantContentParts } from "./assistant-content-order";
import { consolidateCodexFileChangeParts } from "./file-change-display";
import {
  selectVisibleWorkspaceThreads,
  sortWorkspaceThreads
} from "./workspace-thread-order";
import {
  createPortalWorkspaceFolder,
  PORTAL_WORKSPACE_DATA_SOURCE,
  createTrainingWorkspaceDataSource,
  type PortalWorkspaceDataSource,
  type PortalWorkspaceNode,
  type PortalWorkspaceSummary,
  type PortalWorkspaceTask
} from "./workspace";
import "./workbench/workbench.css";
import "./roadmap/roadmap.css";
import "./roadmap/portal-dark.generated.css";
import "./roadmap/portal-dark.css";
import { asRecord, asString, detailFromUnknown, shorten } from "./portal-value-utils";
import { formatFileSize } from "./portal-attachment-upload";
import {
  type DirectoryBrowseOut,
  portalSteerEventFromOut,
  type PortalSteerEventListOut,
  type PortalSteerEventOut,
  type RunningThreadsOut,
  type ThreadCreateOut,
  type ThreadListOut,
  type ThreadMessagesOut,
  type ThreadOneOut,
  type ThreadOut,
  type ThreadSessionOut
} from "./portal-api-types";
import {
  type AppliedConfig,
  type ApprovalPolicy,
  type CommentaryEntryData,
  type CommentaryPartData,
  type ContextUsageSnapshot,
  type ContextUsageTone,
  type DirectoryLoadOptions,
  type DirectoryPickerTarget,
  type ProcessData,
  type ProductFeedbackImageDraft,
  type ProductFeedbackSeverity,
  type ProductFeedbackType,
  type RunningThreadIdsContextValue,
  type SandboxMode,
  type SessionGroupLabelContextValue,
  type ThreadCompletionNoticeContextValue,
  type ThreadIdentity,
  type TraceBatchPart,
  type WebSearchMode
} from "./portal-types";
import {
  DEFAULT_RUNNING_STAGE_TEXT,
  DEFAULT_WORKSPACE,
  PORTAL_RUNNING_LEAVE_WARNING,
  PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM,
  PRODUCT_FEEDBACK_IMAGE_TYPES,
  PRODUCT_FEEDBACK_MAX_IMAGE_BYTES,
  PRODUCT_FEEDBACK_MAX_IMAGES,
  PRODUCT_FEEDBACK_SEVERITY_OPTIONS,
  PRODUCT_FEEDBACK_TYPE_OPTIONS,
  resolveCollapseFinalTraceOnDonePreference,
  resolveShowProcessTracePreference,
  RUNNING_STAGE_CONTEXT_TEXT,
  RUNNING_STAGE_RECEIVED_TEXT,
  RUNNING_STAGE_RESULT_TEXT,
  RUNNING_STAGE_WAITING_MS,
  RUNNING_STAGE_WAITING_TEXT,
  type RunningStageContextValue,
  type RunningStageKind
} from "./portal-constants";
import {
  codexLifecycleProcessTrace,
  crestActionTrace,
  formatCompactTokens,
  isImageGenerationItem,
  isImageGenerationStageText,
  parseTurnUsage,
  stageTextForCodexItem,
  toTokenCount
} from "./codex-process-trace";
import {
  clearPortalBillingIntentFromLocation,
  readPortalBillingIntentFromLocation,
  readPortalThreadIdFromLocation,
  readPortalWorkspaceLocation,
  replacePortalThreadIdInLocation,
  writePortalWorkspaceLocation
} from "./portal-location";
import {
  areRunningThreadMapsEqual,
  isThreadRuntimeRunning,
  mergeRunningThreadMaps,
  normalizeThreadIdentityKeys,
  updateRunningThreadMapForKeys
} from "./running-thread-map";
import {
  clearThreadGroupHeaderLabel,
  formatThreadGroupLabel,
  relocalizeThreadGroupLabel,
  rememberThreadGroupHeader
} from "./thread-group-labels";
import { guessThreadTitle } from "./thread-title";
import {
  buildCodexRunConfig,
  findRuntimeMode,
  formatDirectories,
  normalizeKnowledgeSetIds,
  normalizeRuntimeConfig,
  parseDirectories
} from "./runtime-run-config";
import {
  fileNameFromPreviewPath,
  normalizePreviewFilePath,
  resolveThreadPreviewPathFromHref
} from "./assistant-preview-paths";
import {
  formatAssistantErrorNotice,
  formatAssistantErrorNoticeFromError,
  GENERIC_EXECUTION_ERROR_DETAIL,
  userSafeProcessDetail
} from "./portal-formatting";
import {
  isSubscriptionAccessBlocked,
  portalSubscriptionReminderKey,
  shouldShowPortalSubscriptionReminder
} from "./portal-subscription";
import {
  extractLatestPrompt,
  extractSources,
  findLatestUserMessageForStream,
  sanitizeMessageForPersistence,
  shouldHydratePortalThreadSkills
} from "./thread-message-persistence";
import {
  ActiveThreadIdContext,
  AnswerFeedbackConfigContext,
  type AnswerFeedbackUiConfig,
  AttachmentWorkspaceFilesContext,
  type AttachmentWorkspaceFilesContextValue,
  ComposerPendingAttachmentsContext,
  createPortalRunId,
  ExternalPortalUserContext,
  MobileWorkbenchContext,
  type PortalActiveRun,
  PortalChatRecoveryContext,
  type PortalChatRecoveryState,
  PortalRunCancelContext,
  PortalSubscriptionAccessContext,
  PreviewRequestContext,
  type PreviewRequestOptions,
  type ProcessTracePreferences,
  ProcessTracePreferencesContext,
  RunningStageTextContext,
  RunningThreadIdsContext,
  RuntimeReadinessContext,
  type RuntimeReadinessContextValue,
  type RuntimeReadinessStatus,
  SessionGroupLabelContext,
  SessionSearchContext,
  SkillComposerContext,
  SkillDraftActionContext,
  ThreadCompletionNoticeContext,
  ThreadHeaderActionsSlotContext,
  ThreadMutationReadOnlyContext,
  workspaceFilePreviewOptions
} from "./portal-contexts";
import { applyPortalWelcomeTemplate, DraftOnlyThreadWelcome } from "./PortalWelcome";
import {
  PortalAccessBlockedBanner,
  PortalBillingReturnBanner,
  type PortalBillingReturnNotice,
  PortalInlineErrorBanner,
  PortalSubscriptionReminderBanner
} from "./PortalBanners";
import { ThreadPublicShareControls } from "./ThreadPublicShareControls";
import { StableThreadListItems } from "./PortalThreadList";
import { buildSkillCreatorReviewPrompt, isSkillCreationIntent } from "./SkillDraftStatusBlock";
import { HiddenToolFallback } from "./AssistantRunningState";
import { extractTimelineRows } from "./ProcessDataPart";
import {
  AgentAssistantMessage,
  AgentUserMessage,
  InlineEditComposer,
  PortalSteerEventsFooter,
  ReadOnlyComposer
} from "./PortalMessages";
import { MobileAwareComposer, sendFailureContextFromMessages, UploadAwareComposer } from "./PortalComposer";
import {
  ActiveThreadIdentityBridge,
  AgentRuntimeAdapterBridge,
  type AgentRuntimeAdapterSettings,
  AgentRuntimeAdapterSettingsContext,
  BuildVersionRefreshActivityBridge,
  ComposerActivationGuard,
  threadMessagesOutToRepository,
  ThreadRuntimeSubscriptionBridge
} from "./PortalRuntimeAdapter";

export function PortalShell(props: {
  currentUser?: AuthUser;
  onOpenAdmin?: () => void;
  onSignOut?: () => void;
  trainingReadOnly?: boolean;
  onOpenTraining?: () => void;
  onExitTraining?: () => void;
}) {
  const auth = useAuth();
  const { brand, branding, behavior } = useBranding();
  const { locale, intlLocale, antdLocale, t } = usePortalI18n();
  const trainingReadOnly = props.trainingReadOnly ?? false;
  const workspaceDataSource: PortalWorkspaceDataSource = useMemo(
    () => trainingReadOnly ? createTrainingWorkspaceDataSource(locale) : PORTAL_WORKSPACE_DATA_SOURCE,
    [locale, trainingReadOnly]
  );
  const productFeedbackTypeLabel = (value: ProductFeedbackType): string => {
    if (value === "usability_issue") return t("feedback.typeImprovement");
    if (value === "bug") return t("feedback.typeBug");
    if (value === "feature_request") return t("feedback.typeFeature");
    return t("feedback.typeOther");
  };
  const productFeedbackSeverityLabel = (value: ProductFeedbackSeverity): string => {
    if (value === "blocking") return t("feedback.impactBlocking");
    if (value === "high") return t("feedback.impactHigh");
    if (value === "medium") return t("feedback.impactMedium");
    return t("feedback.impactLow");
  };
  const portalPreferenceUser = props.currentUser ?? auth.user ?? null;
  const serverThemePreference = portalPreferenceUser?.portalPreferences?.theme;
  const portalTheme = usePortalTheme(
    serverThemePreference === "light" || serverThemePreference === "dark" || serverThemePreference === "system"
      ? serverThemePreference
      : undefined
  );
  const portalAntdTheme = useMemo(
    () => createPortalAntdTheme(branding.primaryColor, branding.accentColor, portalTheme.resolved),
    [branding.accentColor, branding.primaryColor, portalTheme.resolved]
  );
  const setPortalThemePreference = portalTheme.setPreference;
  const portalThemeApi = useMemo(
    () => ({
      preference: portalTheme.preference,
      resolved: portalTheme.resolved,
      setPreference: (next: "light" | "dark" | "system") => {
        setPortalThemePreference(next);
        void updatePortalPreferences({ theme: next }).catch(() => undefined);
      }
    }),
    [portalTheme.preference, portalTheme.resolved, setPortalThemePreference]
  );
  const canUseLocalBridge = Boolean(portalPreferenceUser?.id) && !trainingReadOnly;
  const showLocalBridgeEntry = useLocalBridgeEntryVisibility(canUseLocalBridge ? portalPreferenceUser?.id : undefined);
  const isExternalPortalUser = !isInternalPortalExperience({
    userType: portalPreferenceUser?.userType,
    organizationType: auth.activeOrganization?.type,
    membershipType: auth.activeOrganization?.membershipType
  });
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
  const [threadHeaderActionsSlot, setThreadHeaderActionsSlot] = useState<HTMLElement | null>(null);
  const [runtimeOptionsStatus, setRuntimeOptionsStatus] = useState<"loading" | "ready" | "error">("loading");
  const [portalResources, setPortalResources] = useState<PortalResourcesResponse | null>(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState<PortalSubscriptionStatus | null>(null);
  const [subscriptionStatusLoading, setSubscriptionStatusLoading] = useState(false);
  const [subscriptionStatusError, setSubscriptionStatusError] = useState("");
  const [runtimeMode, setRuntimeMode] = useState("");
  const { layoutState, setLayoutState, toggleRail } = useWorkbenchLayout(props.currentUser?.id);
  const isMobile = useIsNarrowScreen(768);
  const isCompactDesktop = useIsNarrowScreen(1279) && !isMobile;

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

  useEffect(() => {
    if (!isCompactDesktop) return;
    setLayoutState((prev) => (prev.isRightDrawerOpen ? closeWorkbenchDrawer(prev) : prev));
  }, [isCompactDesktop]);
  const [sessionSearchValue, setSessionSearchValue] = useState(
    typeof window === "undefined" ? "" : readPortalWorkspaceLocation(window.location.search).query
  );
  const [portalWorkspace, setPortalWorkspace] = useState<PortalWorkspaceSummary | null>(null);
  const [workspaceRootNodes, setWorkspaceRootNodes] = useState<PortalWorkspaceNode[]>([]);
  const [workspaceThreads, setWorkspaceThreads] = useState<ThreadOut[]>([]);
  const [selectedWorkspaceFolderId, setSelectedWorkspaceFolderId] = useState(
    typeof window === "undefined"
      ? RECENT_WORKSPACE_VIEW
      : readPortalWorkspaceLocation(window.location.search).folderId
  );
  const [selectedWorkspaceFolderLabel, setSelectedWorkspaceFolderLabel] = useState("");
  const [selectedWorkspaceFolderPath, setSelectedWorkspaceFolderPath] = useState<PortalWorkspaceNode[]>([]);
  const [workspaceMainView, setWorkspaceMainView] = useState<"folder" | "task">(
    typeof window !== "undefined" && readPortalThreadIdFromLocation(window.location.search) ? "task" : "folder"
  );
  const [workspaceLoading, setWorkspaceLoading] = useState(true);
  const [workspaceErrorText, setWorkspaceErrorText] = useState("");
  const [createRootFolderOpen, setCreateRootFolderOpen] = useState(false);
  const [selectedWorkspaceFile, setSelectedWorkspaceFile] = useState<PortalWorkspaceNode | null>(null);
  const [workspaceRefreshToken, setWorkspaceRefreshToken] = useState(0);
  const [sessionGroupLabelContext, setSessionGroupLabelContext] = useState<SessionGroupLabelContextValue>({
    groupHeaderByRemoteId: {}
  });
  useEffect(() => {
    setSessionGroupLabelContext((previous) => {
      let changed = false;
      const groupHeaderByRemoteId = Object.fromEntries(
        Object.entries(previous.groupHeaderByRemoteId).map(([threadId, label]) => {
          const nextLabel = relocalizeThreadGroupLabel(label, locale);
          changed ||= nextLabel !== label;
          return [threadId, nextLabel];
        })
      );
      return changed ? { groupHeaderByRemoteId } : previous;
    });
  }, [locale]);
  const [activeRunThreadIds, setActiveRunThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [runtimeRunningThreadIds, setRuntimeRunningThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [serverRunningThreadIds, setServerRunningThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [serverRunningSnapshotReady, setServerRunningSnapshotReady] = useState(false);
  const [completedNoticeThreadIds, setCompletedNoticeThreadIds] = useState<RunningThreadIdsContextValue>({});
  const [persistedCompletionNoticeThreadIds, setPersistedCompletionNoticeThreadIds] =
    useState<RunningThreadIdsContextValue>({});
  const [activeThreadIdentity, setActiveThreadIdentity] = useState<ThreadIdentity>({});
  const localWorkspace = useLocalWorkspace(String(activeThreadIdentity.remoteId || ""), canUseLocalBridge);

  useEffect(() => {
    if (isMobile) {
      setLayoutState(prev => prev.isSessionRailCollapsed ? prev : { ...prev, isSessionRailCollapsed: true });
    }
  }, [activeThreadIdentity.remoteId, isMobile]);

  const [threadCollaboration, setThreadCollaboration] = useState<ThreadCollaborationView | null>(null);
  const [threadCollaborationLoading, setThreadCollaborationLoading] = useState(false);
  const [, setThreadCollaborationErrorText] = useState("");
  const [requestedPreviewPath, setRequestedPreviewPath] = useState("");
  const [requestedDirectPreview, setRequestedDirectPreview] = useState<PreviewRequestOptions | null>(null);
  const [activeTaskFiles, setActiveTaskFiles] = useState<PortalWorkspaceNode[]>([]);
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
    () => mergeRunningThreadMaps(
      activeRunThreadIds,
      serverRunningSnapshotReady
        ? filterStaleRuntimeThreadIds(runtimeRunningThreadIds, activeRunThreadIds, serverRunningThreadIds)
        : runtimeRunningThreadIds,
      serverRunningThreadIds
    ),
    [activeRunThreadIds, runtimeRunningThreadIds, serverRunningSnapshotReady, serverRunningThreadIds]
  );
  const completionNoticeThreadIds = useMemo(
    () => mergeRunningThreadMaps(completedNoticeThreadIds, persistedCompletionNoticeThreadIds),
    [completedNoticeThreadIds, persistedCompletionNoticeThreadIds]
  );
  const refreshServerRunningThreadIds = useCallback(async () => {
    if (!props.currentUser) {
      setServerRunningSnapshotReady(false);
      setServerRunningThreadIds({});
      return;
    }
    try {
      const out = await api<RunningThreadsOut>("/api/threads/running");
      setPortalSendProtocol(out.send_protocol);
      const next: RunningThreadIdsContextValue = {};
      for (const threadId of Array.isArray(out.thread_ids) ? out.thread_ids : []) {
        const normalized = String(threadId || "").trim();
        if (normalized) next[normalized] = true;
      }
      setServerRunningSnapshotReady(true);
      setServerRunningThreadIds((previous) => (areRunningThreadMapsEqual(previous, next) ? previous : next));
    } catch {
      // Keep the last successful snapshot during a transient status request failure.
    }
  }, [props.currentUser]);
  useEffect(() => {
    if (!props.currentUser || typeof window === "undefined") {
      setServerRunningSnapshotReady(false);
      setServerRunningThreadIds({});
      return undefined;
    }
    const refreshIfVisible = () => {
      if (document.visibilityState === "hidden") return;
      void refreshServerRunningThreadIds();
    };
    refreshIfVisible();
    const interval = window.setInterval(refreshIfVisible, 3500);
    window.addEventListener("focus", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener("focus", refreshIfVisible);
      document.removeEventListener("visibilitychange", refreshIfVisible);
    };
  }, [props.currentUser, refreshServerRunningThreadIds]);
  const clearPortalThreadUnreadState = useCallback((...threadIds: Array<string | undefined | null>) => {
    const keys = normalizeThreadIdentityKeys(...threadIds);
    if (keys.length === 0) return;
    setCompletedNoticeThreadIds((prev) => updateRunningThreadMapForKeys(prev, keys, false));
    setPersistedCompletionNoticeThreadIds((prev) => updateRunningThreadMapForKeys(prev, keys, false));
    setWorkspaceThreads((previous) => {
      let changed = false;
      const next = previous.map((thread) => {
        if (thread.has_unread_completion !== true) return thread;
        const matches = normalizeThreadIdentityKeys(thread.id, thread.external_id)
          .some((key) => keys.includes(key));
        if (!matches) return thread;
        changed = true;
        return { ...thread, has_unread_completion: false };
      });
      return changed ? next : previous;
    });
  }, []);
  const clearCompletedThreadNotice = clearPortalThreadUnreadState;
  const threadCompletionNoticeContext = useMemo<ThreadCompletionNoticeContextValue>(
    () => ({
      completedThreadIds: completionNoticeThreadIds,
      clearCompletedThreadNotice
    }),
    [clearCompletedThreadNotice, completionNoticeThreadIds]
  );

  const [statusText, setStatusText] = useState("Ready");
  const [runningStageText, setRunningStageText] = useState(DEFAULT_RUNNING_STAGE_TEXT);
  const [runningStageSecondaryText, setRunningStageSecondaryText] = useState("");
  const [runningStageKind, setRunningStageKind] = useState<RunningStageKind>("text");
  const [portalChatRecoveryActive, setPortalChatRecoveryActive] = useState(false);
  const portalChatRecoveryContextValue = useMemo<PortalChatRecoveryState>(
    () => ({ active: portalChatRecoveryActive }),
    [portalChatRecoveryActive]
  );
  const runningStageContextValue = useMemo<RunningStageContextValue>(
    () => ({
      text: runningStageText,
      secondaryText: runningStageSecondaryText,
      kind: runningStageKind
    }),
    [runningStageKind, runningStageSecondaryText, runningStageText]
  );
  const [errorText, setErrorText] = useState("");
  const [resourceErrorText, setResourceErrorText] = useState("");
  const [showProcessTrace, setShowProcessTrace] = useState(() => resolveShowProcessTracePreference(portalPreferenceUser));
  const effectiveShowProcessTrace = isExternalPortalUser ? false : showProcessTrace;
  const [collapseFinalTraceOnDone, setCollapseFinalTraceOnDone] = useState(() =>
    resolveCollapseFinalTraceOnDonePreference(portalPreferenceUser)
  );
  const processTracePreferences = useMemo<ProcessTracePreferences>(
    () => ({ showRawDetail: effectiveShowProcessTrace, collapseOnDone: collapseFinalTraceOnDone }),
    [collapseFinalTraceOnDone, effectiveShowProcessTrace]
  );
  const [portalPreferenceSaving, setPortalPreferenceSaving] = useState(false);
  const [portalPreferenceErrorText, setPortalPreferenceErrorText] = useState("");
  const [contextUsage, setContextUsage] = useState<ContextUsageSnapshot | null>(null);
  const [selectedKnowledgeSetIds, setSelectedKnowledgeSetIds] = useState<string[]>([]);
  const [enabledSkillIds, setEnabledSkillIds] = useState<string[]>([]);
  const [skillSelectionPendingCount, setSkillSelectionPendingCount] = useState(0);
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
  const localeRef = useRef(locale);
  const tRef = useRef(t);
  tRef.current = t;
  const runtimeOptionsRef = useRef(runtimeOptions);
  const runtimeModeRef = useRef(runtimeMode);
  const showProcessTraceRef = useRef(showProcessTrace);
  const collapseFinalTraceOnDoneRef = useRef(collapseFinalTraceOnDone);
  const threadSwitchGateRef = useRef<ExistingTaskSwitchGate>({ current: 0 });
  const [threadSwitchPending, setThreadSwitchPending] = useState(false);
  const navigationViewRef = useRef<"folder" | "task" | null>(null);
  const activeRemoteThreadIdRef = useRef("");
  const activeLocalThreadIdRef = useRef("");
  const runtimeModeOverrideRef = useRef<{ threadId: string; modeId: string } | null>(null);
  const activePortalRunRef = useRef<PortalActiveRun | null>(null);
  // Bumped when a new task reaches the server, so per-task data loads that skipped it run again.
  const [serverThreadRevision, setServerThreadRevision] = useState(0);
  const reloadThreadHistoryRef = useRef<((threadId: string) => Promise<void>) | null>(null);
  const getSteerSourceUserMessageId = useCallback(
    () => activePortalRunRef.current?.userMessageId,
    []
  );
  const requestPortalRunSteer = useCallback(async (message: string, clientSteerId: string, options?: PortalSteerOptions) => {
    const run = activePortalRunRef.current;
    // After a reload this tab no longer streams the response; the server then locates
    // the still-running response by thread.
    const threadId = run?.threadId || activeRemoteThreadIdRef.current;
    if (!threadId) {
      throw new Error("The current response is no longer running");
    }
    const out = await api<{ accepted: boolean; turn_id: string; steer_event: PortalSteerEventOut }>("/api/chat/steer", {
      method: "POST",
      json: {
        ...(run?.sessionId ? { session_id: run.sessionId, client_run_id: run.runId } : {}),
        thread_id: threadId,
        client_steer_id: clientSteerId,
        message: inlineReferencePlainText(message),
        ...(options?.userInputRequestId ? { user_input_request_id: options.userInputRequestId } : {})
      }
    });
    return portalSteerEventFromOut(out.steer_event);
  }, []);
  const loadPortalSteerEvents = useCallback(async (threadId: string) => {
    if (pendingServerThreads.has(threadId)) return [];
    const out = await api<PortalSteerEventListOut>(
      `/api/threads/${encodeURIComponent(threadId)}/steer-events`
    );
    return (out.steer_events ?? []).map(portalSteerEventFromOut);
  }, []);
  const composerWorkflowController = usePortalComposerWorkflowController({
    userId: String(portalPreferenceUser?.id || "").trim(),
    activeThreadId: String(activeThreadIdentity.remoteId || "__new_task__").trim(),
    onSteer: requestPortalRunSteer,
    loadSteerEvents: loadPortalSteerEvents,
    getSteerSourceUserMessageId
  });
  const usageByThreadRef = useRef<Record<string, ContextUsageSnapshot>>({});
  const runningStageTextRef = useRef(runningStageText);
  const runningStageSecondaryTextRef = useRef(runningStageSecondaryText);
  const runningStageKindRef = useRef<RunningStageKind>(runningStageKind);
  const runningStageWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedKnowledgeSetIdsRef = useRef(selectedKnowledgeSetIds);
  const enabledSkillIdsRef = useRef(enabledSkillIds);
  const selectedWorkspaceFolderIdRef = useRef(selectedWorkspaceFolderId);
  const roadmapSkills = useMemo(
    () =>
      (findRuntimeMode(runtimeOptions, runtimeMode)?.availableSkills ?? []).map((skill) => ({
        id: skill.id,
        label: skill.presentation?.displayName || skill.label || skill.name
      })),
    [runtimeMode, runtimeOptions]
  );
  const scheduledTaskContext = useMemo(
    () => ({
      skills: roadmapSkills,
      runSnapshot: () => {
        const cfg = appliedConfigRef.current;
        const folderId = selectedWorkspaceFolderIdRef.current;
        return {
          mode_id: runtimeModeRef.current,
          model: cfg.model,
          reasoning_effort: cfg.reasoningEffort,
          run_config: buildCodexRunConfig(cfg, runtimeModeRef.current),
          folder_id: folderId && !folderId.startsWith("__") ? folderId : null
        };
      }
    }),
    [roadmapSkills]
  );
  const roadmapModeLabel = useCallback(
    (modeId: string | null) => (modeId ? findRuntimeMode(runtimeOptionsRef.current, modeId)?.label : undefined),
    []
  );
  const serverLocalePreference = portalPreferenceUser?.portalPreferences?.locale;
  const syncedLocaleRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (!portalPreferenceUser?.id || trainingReadOnly) return;
    const known = syncedLocaleRef.current ?? serverLocalePreference;
    if (known === locale) return;
    const timer = window.setTimeout(() => {
      syncedLocaleRef.current = locale;
      void updatePortalPreferences({ locale }).catch(() => undefined);
    }, 800);
    return () => window.clearTimeout(timer);
  }, [locale, portalPreferenceUser?.id, serverLocalePreference, trainingReadOnly]);
  const portalWorkspaceRef = useRef<PortalWorkspaceSummary | null>(portalWorkspace);
  const hydratedSkillThreadIdRef = useRef("");
  const skillHydrationRef = useRef<{ threadId: string; promise: Promise<void> } | null>(null);
  const knowledgeSetSelectionInitializedRef = useRef(false);
  const completedRunThreadIdsRef = useRef<Set<string>>(new Set());
  const activeThreadIdentityRef = useRef<ThreadIdentity>({});
  const lastMarkedReadThreadIdRef = useRef("");
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

  const markPortalThreadRead = useCallback(async (threadId: string) => {
    const normalizedThreadId = threadId.trim();
    if (!normalizedThreadId) return;
    clearPortalThreadUnreadState(normalizedThreadId);
    if (trainingReadOnly || pendingServerThreads.has(normalizedThreadId)) return;
    try {
      await api(`/api/threads/${encodeURIComponent(normalizedThreadId)}/read`, { method: "POST" });
    } catch {
      // The next thread-list refresh can restore the persisted unread state.
    }
  }, [clearPortalThreadUnreadState, trainingReadOnly]);

  const syncActiveThreadIdentity = useCallback((identity: ThreadIdentity) => {
    const normalizedRemoteId = String(identity.remoteId || "").trim();
    const normalizedLocalId = String(identity.localId || "").trim();
    if (activeRemoteThreadIdRef.current !== normalizedRemoteId) {
      runtimeModeOverrideRef.current = null;
    }

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
    if (lastMarkedReadThreadIdRef.current !== normalizedRemoteId) {
      lastMarkedReadThreadIdRef.current = normalizedRemoteId;
      void markPortalThreadRead(normalizedRemoteId);
    }
    if (navigationViewRef.current !== "folder" && !threadSwitchGateRef.current.tail) setWorkspaceMainView("task");
    setSelectedWorkspaceFile(null);
    setContextUsage(usageByThreadRef.current[normalizedRemoteId] ?? null);
  }, [markPortalThreadRead]);
  const syncActiveThreadIdentityRef = useRef(syncActiveThreadIdentity);
  syncActiveThreadIdentityRef.current = syncActiveThreadIdentity;

  appliedConfigRef.current = appliedConfig;
  localeRef.current = locale;
  runtimeOptionsRef.current = runtimeOptions;
  runtimeModeRef.current = runtimeMode;
  showProcessTraceRef.current = effectiveShowProcessTrace;
  collapseFinalTraceOnDoneRef.current = collapseFinalTraceOnDone;
  runningStageTextRef.current = runningStageText;
  runningStageSecondaryTextRef.current = runningStageSecondaryText;
  runningStageKindRef.current = runningStageKind;
  selectedKnowledgeSetIdsRef.current = selectedKnowledgeSetIds;
  enabledSkillIdsRef.current = enabledSkillIds;
  selectedWorkspaceFolderIdRef.current = selectedWorkspaceFolderId;
  portalWorkspaceRef.current = portalWorkspace;
  activeThreadIdentityRef.current = activeThreadIdentity;
  productFeedbackImagesRef.current = productFeedbackImages;
  threadCollaborationRef.current = threadCollaboration;
  threadCollaborationLoadingRef.current = threadCollaborationLoading;

  useEffect(
    () => () => {
      if (runningStageWaitTimerRef.current) {
        clearTimeout(runningStageWaitTimerRef.current);
        runningStageWaitTimerRef.current = null;
      }
      for (const item of productFeedbackImagesRef.current) {
        URL.revokeObjectURL(item.previewUrl);
      }
    },
    []
  );

  useEffect(() => {
    if (!props.currentUser) {
      setPortalWorkspace(null);
      setWorkspaceRootNodes([]);
      setWorkspaceLoading(false);
      return;
    }
    let cancelled = false;
    setWorkspaceLoading(true);
    setWorkspaceErrorText("");
    void workspaceDataSource.fetchWorkspace()
      .then((out) => {
        if (cancelled) return;
        setPortalWorkspace(out.workspace);
        setWorkspaceRootNodes(Array.isArray(out.nodes) ? out.nodes : []);
        if (
          typeof window !== "undefined" &&
          !new URLSearchParams(window.location.search).has(PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM) &&
          !readPortalThreadIdFromLocation(window.location.search)
        ) {
          const initialFolderId = trainingReadOnly
            ? String(out.nodes?.[0]?.id || "").trim()
            : out.workspace.history_folder_id;
          if (initialFolderId) {
            setSelectedWorkspaceFolderId(initialFolderId);
            writePortalWorkspaceLocation({ folderId: initialFolderId }, "replace");
          }
        } else if (!trainingReadOnly && typeof window !== "undefined") {
          // A `?folder=` copied from someone else's link (or a folder trashed elsewhere)
          // is not in this user's workspace; quietly fall back to History.
          const urlFolderId = new URLSearchParams(window.location.search).get(PORTAL_WORKSPACE_FOLDER_SEARCH_PARAM)?.trim() || "";
          const historyFolderId = out.workspace.history_folder_id;
          if (urlFolderId && !urlFolderId.startsWith("__") && historyFolderId && urlFolderId !== historyFolderId) {
            void workspaceDataSource.fetchFolderAncestorPaths([urlFolderId])
              .then((paths) => {
                if (cancelled || (paths[urlFolderId]?.length ?? 0) > 0) return;
                if (selectedWorkspaceFolderIdRef.current !== urlFolderId) return;
                setSelectedWorkspaceFolderId(historyFolderId);
                const location = readPortalWorkspaceLocation(window.location.search);
                writePortalWorkspaceLocation({
                  folderId: historyFolderId,
                  threadId: readPortalThreadIdFromLocation(window.location.search) || undefined,
                  fileId: location.fileId,
                  query: location.query
                }, "replace");
              })
              .catch(() => undefined);
          }
        }
      })
      .catch((error) => {
        if (!cancelled) setWorkspaceErrorText(error instanceof Error ? error.message : t("workspace.loadFailed"));
      })
      .finally(() => {
        if (!cancelled) setWorkspaceLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [auth.activeOrganization?.id, props.currentUser?.id, t, trainingReadOnly, workspaceDataSource, workspaceRefreshToken]);

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
      const next = await fetchPortalSubscriptionStatus(locale);
      setSubscriptionStatus(next);
      setSubscriptionStatusError("");
    } catch (error) {
      setSubscriptionStatusError(error instanceof Error ? error.message : "Failed to load your access details");
    } finally {
      if (!options?.silent) {
        setSubscriptionStatusLoading(false);
      }
    }
  }, [locale, props.currentUser?.id]);
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
    setRuntimeOptionsStatus("loading");
    try {
      const next = await api<PortalRuntimeOptions>("/api/portal/runtime-options", {
        headers: { "Accept-Language": intlLocale }
      });
      setRuntimeOptions(next);
      setRuntimeMode((prev) => {
        if (next.modes.some((item) => item.id === prev)) return prev;
        if (activeRemoteThreadIdRef.current && prev) return prev;
        return next.defaults.mode || next.modes[0]?.id || "";
      });
      setRuntimeOptionsStatus("ready");
      return next;
    } catch (error) {
      setRuntimeOptionsStatus("error");
      setErrorText(error instanceof Error ? error.message : t("runtime.loadFailed"));
      return null;
    }
  }, [intlLocale, t]);

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
    // A new task that is not on the server yet is the user's own: nothing to load.
    if (!remoteThreadId || pendingServerThreads.has(remoteThreadId)) {
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
  }, [activeThreadIdentity.remoteId, serverThreadRevision]);

  const [billingPanelOpen, setBillingPanelOpen] = useState(false);
  const [billingReturnNotice, setBillingReturnNotice] = useState<PortalBillingReturnNotice | null>(null);
  const [subscriptionReminderModalOpen, setSubscriptionReminderModalOpen] = useState(false);
  const [dismissedSubscriptionReminderKey, setDismissedSubscriptionReminderKey] = useState("");
  const canUseCustomerBilling =
    brand.billingEnabled && isExternalPortalUser && auth.activeOrganization?.type === "customer";
  const openCustomerBillingPanel = useCallback(() => {
    if (!canUseCustomerBilling) return;
    setBillingPanelOpen(true);
  }, [canUseCustomerBilling]);

  useEffect(() => {
    if (canUseCustomerBilling) return;
    setBillingPanelOpen(false);
    setBillingReturnNotice(null);
    setSubscriptionReminderModalOpen(false);
  }, [canUseCustomerBilling]);

  useEffect(() => {
    if (!canUseCustomerBilling || typeof window === "undefined") return;
    const intent = readPortalBillingIntentFromLocation(window.location.search);
    if (!intent) return;

    clearPortalBillingIntentFromLocation();
    if (intent === "renew") {
      setBillingReturnNotice(null);
      setBillingPanelOpen(true);
      return;
    }

    if (intent === "success") {
      setBillingReturnNotice({
        tone: "success",
        title: "Payment received",
        detail: "Your billing page is ready. Stripe may take a moment to update the final subscription status."
      });
      void refreshPortalSubscriptionStatus({ silent: true });
      return;
    }

    setBillingReturnNotice({
      tone: "warning",
      title: "Payment was not completed",
      detail: "You can reopen billing and continue the secure payment when you are ready."
    });
    setBillingPanelOpen(true);
  }, [canUseCustomerBilling, refreshPortalSubscriptionStatus]);

  useEffect(() => {
    const activeRemoteId = String(activeThreadIdentity.remoteId || "").trim();
    const activeThread = workspaceThreads.find(
      (thread) => thread.id === activeRemoteId || thread.external_id === activeRemoteId
    );
    const persistedModeId = String(activeThread?.mode_id || "").trim();
    const hasUserOverride = Boolean(
      runtimeModeOverrideRef.current &&
      runtimeModeOverrideRef.current.threadId === activeRemoteId &&
      runtimeModeOverrideRef.current.modeId === runtimeMode
    );
    if (persistedModeId && persistedModeId !== runtimeMode && !hasUserOverride) {
      setRuntimeMode(persistedModeId);
      return;
    }
    const selectedMode = findRuntimeMode(runtimeOptions, hasUserOverride ? runtimeMode : persistedModeId || runtimeMode);
    if (!selectedMode) return;
    setAppliedConfig((prev) => {
      const persistedModel = activeThread?.model?.trim() || "";
      const model = !hasUserOverride && persistedModeId && persistedModeId === selectedMode.id && persistedModel
        ? persistedModel
        : selectedMode.runtimeProfile.defaultModel;
      const reasoningEffort = !hasUserOverride && persistedModeId && persistedModeId === selectedMode.id && activeThread?.reasoning_effort
        ? activeThread.reasoning_effort
        : selectedMode.runtimeProfile.defaultReasoningEffort as ReasoningEffort;
      return {
        ...prev,
        model,
        reasoningEffort: normalizeReasoningEffortForModel(
          model,
          reasoningEffort,
          modelOptionsFromCatalog(runtimeOptions?.modelCatalog)
        ),
        sandboxMode: selectedMode.runtimeProfile.sandboxMode as SandboxMode,
        approvalPolicy: selectedMode.runtimeProfile.approvalPolicy as ApprovalPolicy,
        networkAccessEnabled: selectedMode.runtimeProfile.networkAccessEnabled,
        webSearchMode: selectedMode.runtimeProfile.webSearchMode as WebSearchMode
      };
    });
  }, [activeThreadIdentity.remoteId, runtimeMode, runtimeOptions, workspaceThreads]);

  useEffect(() => {
    if (isExternalPortalUser) {
      enabledSkillIdsRef.current = [];
      hydratedSkillThreadIdRef.current = "";
      setEnabledSkillIds([]);
      return;
    }
    const activeRemoteId = String(activeThreadIdentity.remoteId || "").trim();
    const activeThread = workspaceThreads.find(
      (thread) => thread.id === activeRemoteId || thread.external_id === activeRemoteId
    );
    const persistedModeId = String(activeThread?.mode_id || "").trim();
    const hasUserOverride = Boolean(
      runtimeModeOverrideRef.current &&
      runtimeModeOverrideRef.current.threadId === activeRemoteId &&
      runtimeModeOverrideRef.current.modeId === runtimeMode
    );
    const selectedMode = findRuntimeMode(runtimeOptions, hasUserOverride ? runtimeMode : persistedModeId || runtimeMode);
    if (!selectedMode) return;
    const available = new Set((selectedMode?.availableSkills ?? []).map((skill) => skill.id));
    setEnabledSkillIds((current) => {
      const next = current.filter((skillId) => available.has(skillId));
      enabledSkillIdsRef.current = next;
      return next;
    });
  }, [activeThreadIdentity.remoteId, isExternalPortalUser, runtimeMode, runtimeOptions, workspaceThreads]);

  useEffect(() => {
    const threadId = String(activeThreadIdentity.remoteId || "").trim();
    if (!shouldHydratePortalThreadSkills({ threadId, isExternalPortalUser, trainingReadOnly })) {
      enabledSkillIdsRef.current = [];
      hydratedSkillThreadIdRef.current = "";
      skillHydrationRef.current = null;
      setEnabledSkillIds([]);
      return;
    }

    if (pendingServerThreads.has(threadId)) {
      // The first send creates this task with the skills chosen now.
      hydratedSkillThreadIdRef.current = threadId;
      skillHydrationRef.current = null;
      return;
    }
    let active = true;
    hydratedSkillThreadIdRef.current = "";
    const hydrationPromise = api<ThreadOneOut>(`/api/threads/${encodeURIComponent(threadId)}`)
      .then((response) => {
        if (!active) return;
        setWorkspaceThreads((current) => [
          response.thread,
          ...current.filter((thread) => thread.id !== response.thread.id)
        ]);
        const persistedModeId = String(response.thread.mode_id || "").trim();
        const hasUserOverride = Boolean(
          runtimeModeOverrideRef.current &&
          runtimeModeOverrideRef.current.threadId === threadId &&
          runtimeModeOverrideRef.current.modeId === runtimeMode
        );
        if (persistedModeId && !hasUserOverride) {
          setRuntimeMode(persistedModeId);
        }
        const selectedMode = findRuntimeMode(runtimeOptions, hasUserOverride ? runtimeMode : persistedModeId || runtimeMode);
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
        const nextIds = Array.from(new Set(ids));
        enabledSkillIdsRef.current = nextIds;
        hydratedSkillThreadIdRef.current = threadId;
        setEnabledSkillIds(nextIds);
      })
      .catch(() => {
        // Keep the local selection if the detail refresh fails; the next run is still validated server-side.
      });
    skillHydrationRef.current = { threadId, promise: hydrationPromise };

    return () => {
      active = false;
      if (skillHydrationRef.current?.threadId === threadId) {
        skillHydrationRef.current = null;
      }
    };
  }, [activeThreadIdentity.remoteId, isExternalPortalUser, runtimeMode, runtimeOptions, trainingReadOnly]);

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

  const clearRunningStageWaitTimers = () => {
    if (runningStageWaitTimerRef.current) {
      clearTimeout(runningStageWaitTimerRef.current);
      runningStageWaitTimerRef.current = null;
    }
  };

  const updateRunningStageSecondaryText = (next: string) => {
    const normalized = next.trim();
    if (runningStageSecondaryTextRef.current === normalized) return;
    runningStageSecondaryTextRef.current = normalized;
    setRunningStageSecondaryText(normalized);
  };

  const startRunningStageWaitTimers = () => {
    clearRunningStageWaitTimers();
    updateRunningStageSecondaryText("");
    runningStageWaitTimerRef.current = setTimeout(() => {
      runningStageWaitTimerRef.current = null;
      updateRunningStageSecondaryText(RUNNING_STAGE_WAITING_TEXT);
    }, RUNNING_STAGE_WAITING_MS);
  };

  const stopRunningStageWaitTimers = () => {
    clearRunningStageWaitTimers();
    updateRunningStageSecondaryText("");
  };

  const updateRunningStage = (next: string, options?: { fallback?: boolean; kind?: RunningStageKind }) => {
    const normalized = next.trim();
    if (!normalized) return;
    const nextKind: RunningStageKind = options?.kind ?? (isImageGenerationStageText(normalized) ? "image" : runningStageKindRef.current);
    if (runningStageTextRef.current !== normalized) {
      runningStageTextRef.current = normalized;
      setRunningStageText(normalized);
    }
    if (runningStageKindRef.current !== nextKind) {
      runningStageKindRef.current = nextKind;
      setRunningStageKind(nextKind);
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

  const rememberNewThreadGroupHeader = (thread: Pick<ThreadOut, "id" | "external_id">, localThreadId: string, at?: string) => {
    const groupLabel = formatThreadGroupLabel(at || new Date().toISOString(), localeRef.current);
    setSessionGroupLabelContext((prev) => {
      const nextGroupHeaders = { ...prev.groupHeaderByRemoteId };
      clearThreadGroupHeaderLabel(nextGroupHeaders, groupLabel);
      rememberThreadGroupHeader(nextGroupHeaders, thread, groupLabel, localThreadId);
      return { groupHeaderByRemoteId: nextGroupHeaders };
    });
  };
  const rememberNewThreadGroupHeaderRef = useRef(rememberNewThreadGroupHeader);
  rememberNewThreadGroupHeaderRef.current = rememberNewThreadGroupHeader;
  const handleServerThreadCreated = (thread: ThreadOut, localThreadId: string) => {
    const wasPending = pendingServerThreads.has(thread.id);
    pendingServerThreads.confirm(thread.id);
    setWorkspaceThreads((current) => [thread, ...current.filter((item) => item.id !== thread.id)]);
    rememberNewThreadGroupHeader(thread, localThreadId, thread.updated_at || thread.created_at);
    if (wasPending) setServerThreadRevision((value) => value + 1);
  };
  const handleServerThreadCreatedRef = useRef(handleServerThreadCreated);
  handleServerThreadCreatedRef.current = handleServerThreadCreated;
  /** Run settings a new task is created with; the first send repeats them for its session. */
  const newThreadRunSettings = () => {
    const cfg = normalizeRuntimeConfig(appliedConfigRef.current, runtimeOptionsRef.current);
    const selectedMode = findRuntimeMode(runtimeOptionsRef.current, runtimeModeRef.current);
    const selectedSkillIds = new Set(enabledSkillIdsRef.current);
    const skills = (selectedMode?.availableSkills ?? []).filter((skill) => selectedSkillIds.has(skill.id));
    return {
      model: cfg.model,
      reasoning_effort: cfg.reasoningEffort,
      knowledge_set_ids: normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current),
      codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current, skills)
    };
  };
  const newThreadRunSettingsRef = useRef(newThreadRunSettings);
  newThreadRunSettingsRef.current = newThreadRunSettings;
  const createServerThread = async (thread: PendingServerThread): Promise<ThreadCreateOut> => {
    const created = await api<ThreadCreateOut>("/api/threads", {
      method: "POST",
      json: {
        // Older releases ignore the id and choose their own; callers use the returned thread.
        id: thread.remoteId,
        external_id: thread.localId,
        title: thread.title,
        ...newThreadRunSettingsRef.current(),
        folder_id: thread.folderId,
        local_root_id: thread.localRootId,
        start_session: false
      }
    });
    return created;
  };
  const createServerThreadRef = useRef(createServerThread);
  createServerThreadRef.current = createServerThread;
  useEffect(() => {
    // Uploads need the task on the server before the first send.
    pendingServerThreads.setCreator(async (thread) => {
      const created = await createServerThreadRef.current(thread);
      handleServerThreadCreatedRef.current(created.thread, thread.localId);
    });
    return () => pendingServerThreads.setCreator(undefined);
  }, []);

  const threadListAdapter = useMemo<RemoteThreadListAdapter>(
    () => ({
      async list() {
        const out = await api<ThreadListOut>(
          trainingReadOnly
            ? `/api/portal/training/threads${localeRef.current === "en" ? "?lang=en" : ""}`
            : "/api/threads"
        );
        const threads = Array.isArray(out.threads) ? out.threads : [];
        setWorkspaceThreads(threads);
        const nextPersistedCompletionNotices: RunningThreadIdsContextValue = {};
        for (const thread of threads) {
          if (thread.has_unread_completion !== true) continue;
          for (const key of normalizeThreadIdentityKeys(thread.id, thread.external_id)) {
            nextPersistedCompletionNotices[key] = true;
          }
        }
        setPersistedCompletionNoticeThreadIds((previous) =>
          areRunningThreadMapsEqual(previous, nextPersistedCompletionNotices)
            ? previous
            : nextPersistedCompletionNotices
        );
        const groupHeaderByRemoteId: Record<string, string> = {};
        let previousGroupLabel = "";
        for (const thread of threads) {
          const groupLabel = formatThreadGroupLabel(thread.updated_at || thread.created_at, localeRef.current);
          if (groupLabel && groupLabel !== previousGroupLabel) {
            rememberThreadGroupHeader(groupHeaderByRemoteId, thread, groupLabel);
            previousGroupLabel = groupLabel;
          }
        }
        setSessionGroupLabelContext({ groupHeaderByRemoteId });
        return {
          threads: threads.map((thread) => ({
            status: thread.status,
            remoteId: thread.id,
            externalId: thread.external_id,
            title: thread.title
          }))
        };
      },
      async initialize(threadId: string) {
        if (trainingReadOnly) throw new Error("Training catalog is read-only.");
        const cfg = normalizeRuntimeConfig(appliedConfigRef.current, runtimeOptionsRef.current);
        const knowledgeSetIds = normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current);
        const selectedMode = findRuntimeMode(runtimeOptionsRef.current, runtimeModeRef.current);
        if (!selectedMode) {
          throw new Error(tRef.current("runtime.sendBlocked"));
        }
        const selectedFolderId = selectedWorkspaceFolderIdRef.current;
        const folderId =
          selectedFolderId &&
          selectedFolderId !== RECENT_WORKSPACE_VIEW &&
          selectedFolderId !== AGENT_OUTPUTS_WORKSPACE_VIEW &&
          selectedFolderId !== TRASH_WORKSPACE_VIEW
            ? selectedFolderId
            : portalWorkspaceRef.current?.history_folder_id;
        const pending: PendingServerThread = {
          remoteId: createPortalServerThreadId(),
          localId: threadId,
          folderId: folderId || undefined,
          localRootId: localWorkspace.selectionRef.current?.root_id
        };
        if (singleRequestSendSupported()) {
          // The first send creates the task together with the message (one request).
          pendingServerThreads.add(pending);
          syncActiveThreadIdentityRef.current({ remoteId: pending.remoteId, localId: threadId || undefined });
          rememberNewThreadGroupHeaderRef.current({ id: pending.remoteId, external_id: threadId }, threadId);
          return { remoteId: pending.remoteId, externalId: threadId };
        }
        let created: ThreadCreateOut;
        try {
          created = await createServerThreadRef.current(pending);
        } catch (error) {
          if (shouldBrowserReportSendFailure(error)) {
            reportSendFailure({ stage: "thread_create", threadId, error });
          }
          const notice = formatAssistantErrorNoticeFromError(error, "Failed to create thread", t);
          setErrorText(notice);
          void refreshPortalSubscriptionStatusRef.current({ silent: true });
          throw new Error(notice);
        }
        syncActiveThreadIdentityRef.current({
          remoteId: created.thread.id,
          localId: threadId || undefined
        });
        handleServerThreadCreatedRef.current(created.thread, threadId);
        return {
          remoteId: created.thread.id,
          externalId: created.thread.external_id
        };
      },
      async rename(remoteId: string, newTitle: string) {
        if (trainingReadOnly) throw new Error("Training catalog is read-only.");
        // Not on the server yet: the first send creates the task with this title.
        if (pendingServerThreads.setTitle(remoteId, newTitle)) return;
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { title: newTitle }
        });
        setWorkspaceThreads((current) =>
          current.map((thread) => thread.id === remoteId ? { ...thread, title: newTitle } : thread)
        );
      },
      async archive(remoteId: string) {
        if (trainingReadOnly) throw new Error("Training catalog is read-only.");
        if (pendingServerThreads.has(remoteId)) {
          pendingServerThreads.confirm(remoteId);
          return;
        }
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { status: "archived" }
        });
        setWorkspaceThreads((current) =>
          current.map((thread) => thread.id === remoteId ? { ...thread, status: "archived" } : thread)
        );
      },
      async unarchive(remoteId: string) {
        if (trainingReadOnly) throw new Error("Training catalog is read-only.");
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { status: "regular" }
        });
        setWorkspaceThreads((current) =>
          current.map((thread) => thread.id === remoteId ? { ...thread, status: "regular" } : thread)
        );
      },
      async delete(remoteId: string) {
        if (trainingReadOnly) throw new Error("Training catalog is read-only.");
        if (pendingServerThreads.has(remoteId)) {
          pendingServerThreads.confirm(remoteId);
          return;
        }
        await api(`/api/threads/${encodeURIComponent(remoteId)}`, {
          method: "PATCH",
          json: { status: "archived" }
        });
        setWorkspaceThreads((current) => current.filter((thread) => thread.id !== remoteId));
      },
      async fetch(threadId: string) {
        const out = await api<ThreadOneOut>(
          trainingReadOnly
            ? `/api/portal/training/threads/${encodeURIComponent(threadId)}${localeRef.current === "en" ? "?lang=en" : ""}`
            : `/api/threads/${encodeURIComponent(threadId)}`
        );
        setWorkspaceThreads((current) => [
          out.thread,
          ...current.filter((thread) => thread.id !== out.thread.id)
        ]);
        return {
          status: out.thread.status,
          remoteId: out.thread.id,
          externalId: out.thread.external_id,
          title: out.thread.title
        };
      },
      async generateTitle(remoteId: string, messages: readonly ThreadMessage[]): Promise<AssistantStream> {
        if (trainingReadOnly) {
          const existing = guessThreadTitle(messages);
          return createAssistantStream((controller) => {
            controller.appendText(existing || "New conversation");
            controller.close();
          });
        }
        const pendingThread = pendingServerThreads.get(remoteId);
        if (pendingThread) {
          const title = pendingThread.title || guessThreadTitle(messages);
          if (title && title !== "New conversation") pendingServerThreads.setTitle(remoteId, title);
          return createAssistantStream((controller) => {
            controller.appendText(title || "New conversation");
            controller.close();
          });
        }
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
      unstable_Provider: AgentRuntimeAdapterBridge
    }),
    // Keep this adapter stable for the session: read locale, translations and the identity
    // callback through refs so a language switch or late runtime options never rebuild it.
    [trainingReadOnly]
  );

  const canUpload = !trainingReadOnly && (runtimeOptions?.canUpload ?? false);
  const handleRuntimeThreadIdentityChange = useCallback((identity: ThreadIdentity) => {
    syncActiveThreadIdentityRef.current(identity);
  }, []);
  const runtimeAdapterSettings = useMemo<AgentRuntimeAdapterSettings>(
    () => ({
      canUpload,
      trainingReadOnly,
      locale,
      onThreadIdentityChange: handleRuntimeThreadIdentityChange
    }),
    [canUpload, handleRuntimeThreadIdentityChange, locale, trainingReadOnly]
  );
  const activeRemoteThreadId = String(activeThreadIdentity.remoteId || "").trim();
  const activeRuntimeThread = workspaceThreads.find(
    (thread) => thread.id === activeRemoteThreadId || thread.external_id === activeRemoteThreadId
  );
  const persistedRuntimeMode = String(activeRuntimeThread?.mode_id || "").trim();
  const hasRuntimeModeOverride = Boolean(
    runtimeModeOverrideRef.current &&
    runtimeModeOverrideRef.current.threadId === activeRemoteThreadId &&
    runtimeModeOverrideRef.current.modeId === runtimeMode
  );
  const effectiveRuntimeMode = hasRuntimeModeOverride ? runtimeMode : persistedRuntimeMode || runtimeMode;
  runtimeModeRef.current = effectiveRuntimeMode;
  const selectedMode = findRuntimeMode(runtimeOptions, effectiveRuntimeMode);
  const modeOptions = resolveModeOptions(runtimeOptions?.modes ?? [], effectiveRuntimeMode);
  const selectedModeLabel = resolveModeLabel(runtimeOptions?.modes ?? [], effectiveRuntimeMode);
  const availableModeSkills = isExternalPortalUser ? [] : (selectedMode?.availableSkills ?? []);
  const automaticModeSkills = isExternalPortalUser ? [] : (selectedMode?.automaticSkills ?? []);
  const setEnabledSkills = useCallback(async (skillIds: string[]) => {
    if (isExternalPortalUser) return;
    const availableIds = new Set(availableModeSkills.map((skill) => skill.id));
    const normalizedIds = Array.from(new Set(skillIds.filter((skillId) => availableIds.has(skillId))));
    const previousIds = enabledSkillIdsRef.current;
    enabledSkillIdsRef.current = normalizedIds;
    hydratedSkillThreadIdRef.current = String(activeThreadIdentity.remoteId || "").trim();
    setEnabledSkillIds(normalizedIds);

    const threadId = String(activeThreadIdentity.remoteId || "").trim();
    // A task not on the server yet takes the selection with its first send.
    if (!threadId || pendingServerThreads.has(threadId)) return;
    setSkillSelectionPendingCount(count => count + 1);
    try {
      await api<ThreadOneOut>(`/api/threads/${encodeURIComponent(threadId)}/skills`, {
        method: "PUT",
        json: {
          mode_id: effectiveRuntimeMode,
          skill_ids: normalizedIds
        }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Skill 保存失败，请重试";
      // A late response from another task must not overwrite the current task's selection.
      if (activeRemoteThreadIdRef.current === threadId) {
        enabledSkillIdsRef.current = previousIds;
        setEnabledSkillIds(previousIds);
        setErrorText(message);
      }
      throw new Error(message);
    } finally {
      setSkillSelectionPendingCount(count => Math.max(0, count - 1));
    }
  }, [activeThreadIdentity.remoteId, availableModeSkills, effectiveRuntimeMode, isExternalPortalUser]);
  const skillComposerContext = useMemo(
    () => ({
      availableSkills: availableModeSkills,
      automaticSkills: automaticModeSkills,
      enabledSkillIds,
      recentSkillIds: runtimeOptions?.recentSkillIds ?? [],
      setSkills: setEnabledSkills,
      ready: !activeThreadIdentity.remoteId || hydratedSkillThreadIdRef.current === activeThreadIdentity.remoteId,
      busy: skillSelectionPendingCount > 0
    }),
    [automaticModeSkills, availableModeSkills, enabledSkillIds, runtimeOptions?.recentSkillIds, setEnabledSkills, activeThreadIdentity.remoteId, skillSelectionPendingCount]
  );
  const selectedKnowledgeSetIdsNormalized = selectedKnowledgeSetIds;
  const handleKnowledgeSetChange = useCallback((ids: string[]) => {
    knowledgeSetSelectionInitializedRef.current = true;
    setSelectedKnowledgeSetIds(ids);
  }, []);
  useEffect(() => {
    if (!activeRemoteThreadId || workspaceMainView !== "task" || threadSwitchPending) return;
    const activeThread = workspaceThreads.find(
      (thread) => thread.id === activeRemoteThreadId || thread.external_id === activeRemoteThreadId
    );
    if (activeThread?.folder_id && activeThread.folder_id !== selectedWorkspaceFolderId) {
      setSelectedWorkspaceFolderId(activeThread.folder_id);
      writePortalWorkspaceLocation({
        folderId: activeThread.folder_id,
        threadId: activeRemoteThreadId
      });
    }
  }, [activeRemoteThreadId, selectedWorkspaceFolderId, workspaceMainView, workspaceThreads, threadSwitchPending]);
  const selectedWorkspaceFolder = useMemo(
    () => workspaceRootNodes.find((node) => node.id === selectedWorkspaceFolderId) ?? null,
    [selectedWorkspaceFolderId, workspaceRootNodes]
  );
  useEffect(() => {
    if (selectedWorkspaceFolderId.startsWith("__")) {
      setSelectedWorkspaceFolderLabel("");
      setSelectedWorkspaceFolderPath([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      const chain: PortalWorkspaceNode[] = [];
      let nodeId: string | null = selectedWorkspaceFolderId;
      for (let depth = 0; nodeId && depth < 20; depth += 1) {
        const rootNode = workspaceRootNodes.find((node) => node.id === nodeId);
        const node: PortalWorkspaceNode = rootNode ?? await workspaceDataSource.fetchNode(nodeId);
        if (node.kind !== "folder") break;
        chain.unshift(node);
        nodeId = node.parent_id;
      }
      if (!cancelled) {
        setSelectedWorkspaceFolderLabel(chain.at(-1)?.name || "");
        setSelectedWorkspaceFolderPath(chain);
      }
    })()
      .catch(() => {
        if (!cancelled) {
          setSelectedWorkspaceFolderLabel(selectedWorkspaceFolder?.name || "");
          setSelectedWorkspaceFolderPath(selectedWorkspaceFolder ? [selectedWorkspaceFolder] : []);
        }
      })
    return () => {
      cancelled = true;
    };
  }, [selectedWorkspaceFolder, selectedWorkspaceFolderId, workspaceDataSource, workspaceRootNodes]);
  const selectedWorkspaceFolderName =
    selectedWorkspaceFolderId === RECENT_WORKSPACE_VIEW
      ? t("workspace.recent")
      : selectedWorkspaceFolderId === AGENT_OUTPUTS_WORKSPACE_VIEW
        ? t("workspace.agentOutputs")
      : selectedWorkspaceFolderId === TRASH_WORKSPACE_VIEW
        ? t("workspace.trash")
      : selectedWorkspaceFolder?.system_key === "history_unfiled"
        ? t("workspace.historyTasks")
        : selectedWorkspaceFolder?.name || selectedWorkspaceFolderLabel || t("workspace.folder");
  const selectedWorkspaceThreadIds = useMemo<RunningThreadIdsContextValue>(
    () => activeRemoteThreadId ? { [activeRemoteThreadId]: true } : {},
    [activeRemoteThreadId]
  );
  const selectedWorkspaceThreads = useMemo(() => {
    const filteredThreads = workspaceThreads
      .filter((thread) => thread.status === "regular")
      .filter((thread) =>
        selectedWorkspaceFolderId === RECENT_WORKSPACE_VIEW
          ? true
          : selectedWorkspaceFolderId === AGENT_OUTPUTS_WORKSPACE_VIEW
            ? true
          : selectedWorkspaceFolderId === TRASH_WORKSPACE_VIEW
            ? false
            : thread.folder_id === selectedWorkspaceFolderId
      );
    return sortWorkspaceThreads(
      filteredThreads,
      runningThreadIds,
      completionNoticeThreadIds
    );
  }, [completionNoticeThreadIds, runningThreadIds, selectedWorkspaceFolderId, selectedWorkspaceThreadIds, workspaceThreads]);
  const visibleWorkspaceThreads = useMemo(
    () => selectVisibleWorkspaceThreads(
      selectedWorkspaceThreads,
      runningThreadIds,
      completionNoticeThreadIds,
      WORKSPACE_RAIL_TASK_LIMIT,
      selectedWorkspaceThreadIds
    ),
    [completionNoticeThreadIds, runningThreadIds, selectedWorkspaceThreadIds, selectedWorkspaceThreads]
  );
  const visibleWorkspaceThreadIds = useMemo(
    () => new Set(visibleWorkspaceThreads.map((thread) => thread.id)),
    [visibleWorkspaceThreads]
  );
  const orderedWorkspaceThreadIds = useMemo(
    () => selectedWorkspaceThreads
      .filter((thread) => visibleWorkspaceThreadIds.has(thread.id))
      .flatMap((thread) => [thread.id, thread.external_id].filter((value): value is string => Boolean(value))),
    [selectedWorkspaceThreads, visibleWorkspaceThreadIds]
  );
  const directRunningWorkspaceFolderIds = useMemo(() => {
    const folderIds = new Set<string>();
    const historyFolderId = portalWorkspace?.history_folder_id?.trim() || "";
    for (const thread of workspaceThreads) {
      if (thread.status !== "regular") continue;
      const isRunning = normalizeThreadIdentityKeys(thread.id, thread.external_id).some(
        (key) => runningThreadIds[key]
      );
      if (!isRunning) continue;
      const folderId = thread.folder_id?.trim() || historyFolderId;
      if (folderId) folderIds.add(folderId);
    }
    return folderIds;
  }, [portalWorkspace?.history_folder_id, runningThreadIds, workspaceThreads]);
  const directUnreadWorkspaceFolderIds = useMemo(() => {
    const folderIds = new Set<string>();
    const historyFolderId = portalWorkspace?.history_folder_id?.trim() || "";
    for (const thread of workspaceThreads) {
      if (thread.status !== "regular") continue;
      const hasUnreadCompletion = thread.has_unread_completion === true ||
        normalizeThreadIdentityKeys(thread.id, thread.external_id).some(
          (key) => completionNoticeThreadIds[key]
        );
      if (!hasUnreadCompletion) continue;
      const folderId = thread.folder_id?.trim() || historyFolderId;
      if (folderId) folderIds.add(folderId);
    }
    return folderIds;
  }, [completionNoticeThreadIds, portalWorkspace?.history_folder_id, workspaceThreads]);
  const workspaceFolderStateSourceKey = useMemo(
    () => Array.from(new Set([
      ...directRunningWorkspaceFolderIds,
      ...directUnreadWorkspaceFolderIds
    ])).sort().join(","),
    [directRunningWorkspaceFolderIds, directUnreadWorkspaceFolderIds]
  );
  const [workspaceFolderAncestorPaths, setWorkspaceFolderAncestorPaths] = useState<Record<string, string[]>>({});
  useEffect(() => {
    const folderIds = workspaceFolderStateSourceKey ? workspaceFolderStateSourceKey.split(",") : [];
    if (folderIds.length === 0) {
      setWorkspaceFolderAncestorPaths({});
      return undefined;
    }
    let cancelled = false;
    void workspaceDataSource.fetchFolderAncestorPaths(folderIds)
      .then((paths) => {
        if (!cancelled) setWorkspaceFolderAncestorPaths(paths);
      })
      .catch(() => {
        if (!cancelled) setWorkspaceFolderAncestorPaths({});
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceDataSource, workspaceFolderStateSourceKey]);
  const runningWorkspaceFolderIds = useMemo(
    () => expandWorkspaceFolderIds(directRunningWorkspaceFolderIds, workspaceFolderAncestorPaths),
    [directRunningWorkspaceFolderIds, workspaceFolderAncestorPaths]
  );
  const unreadWorkspaceFolderIds = useMemo(
    () => expandWorkspaceFolderIds(directUnreadWorkspaceFolderIds, workspaceFolderAncestorPaths),
    [directUnreadWorkspaceFolderIds, workspaceFolderAncestorPaths]
  );
  const selectWorkspaceFolder = useCallback((folderId: string, folderName?: string) => {
    navigationViewRef.current = "folder";
    threadSwitchGateRef.current.current += 1;
    setThreadSwitchPending(false);
    setSelectedWorkspaceFolderId(folderId);
    setSelectedWorkspaceFolderLabel(folderName || "");
    setSessionSearchValue("");
    setWorkspaceMainView("folder");
    setSelectedWorkspaceFile(null);
    setRequestedPreviewPath("");
    writePortalWorkspaceLocation({ folderId }, "push");
    if (isMobile) {
      setLayoutState((prev) => ({ ...prev, isSessionRailCollapsed: true }));
    }
  }, [isMobile]);
  const createRootWorkspaceFolder = useCallback(async (name: string) => {
    const folder = await createPortalWorkspaceFolder(name);
    setWorkspaceRootNodes((current) => [
      ...current.filter((node) => node.id !== folder.id),
      folder
    ]);
    selectWorkspaceFolder(folder.id, folder.name);
  }, [selectWorkspaceFolder]);
  const activeThreadCollaboration =
    threadCollaboration && threadCollaboration.threadId === activeRemoteThreadId ? threadCollaboration : null;
  const sharedThreadReadonly = Boolean(
    activeThreadCollaboration && activeThreadCollaboration.access.canRead && !activeThreadCollaboration.access.canRun
  );
  const threadReadOnlyPresentation = resolveThreadReadOnlyPresentation({ trainingReadOnly, sharedThreadReadonly });
  const threadReadOnly = threadReadOnlyPresentation.mutationReadOnly;
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
  const runtimeReadinessStatus: RuntimeReadinessStatus = runtimeOptionsStatus === "loading"
    ? "loading"
    : runtimeOptionsStatus === "error"
      ? "error"
      : selectedMode
        ? "ready"
        : "unavailable";
  const runtimeReadinessNotice = runtimeReadinessStatus === "loading"
    ? t("runtime.loading")
    : runtimeReadinessStatus === "error"
      ? t("runtime.loadFailed")
      : runtimeReadinessStatus === "unavailable"
        ? t("runtime.modeUnavailable")
        : "";
  const runtimeReadinessContextValue = useMemo<RuntimeReadinessContextValue>(
    () => ({
      status: runtimeReadinessStatus,
      notice: runtimeReadinessNotice,
      retry: refreshRuntimeOptionsNow
    }),
    [refreshRuntimeOptionsNow, runtimeReadinessNotice, runtimeReadinessStatus]
  );
  const runtimeSummaryText = runtimeReadinessStatus === "ready"
    ? `${appliedConfig.model} · ${selectedModeLabel}`
    : runtimeReadinessNotice;
  const topbarRuntimeSummaryText = runtimeReadinessStatus === "ready" && isMobile
    ? selectedModeLabel
    : runtimeSummaryText;
  const composerPlaceholder = canUpload
    ? isMobile
      ? t("thread.placeholderMobile")
      : t("thread.placeholder")
    : isMobile
      ? t("thread.placeholderNoUploadMobile")
      : t("thread.placeholderNoUpload");
  const welcomeMessageTemplate = isMobile
    ? behavior.portalWelcomeMessageMobile
    : behavior.portalWelcomeMessageDesktop;
  const welcomeMessage =
    locale === "zh-CN" &&
    (welcomeMessageTemplate === "Ask about products, versions, deployment, alarms, or troubleshooting." ||
      welcomeMessageTemplate === "Hello, I'm your {{assistantName}}. Ask about products, versions, deployment, alarms, or troubleshooting.")
      ? isMobile
        ? t("welcome.subtitle")
        : `${t("welcome.greeting", { assistant: assistantDisplayName })} ${t("welcome.subtitle")}`
      : applyPortalWelcomeTemplate(welcomeMessageTemplate, {
          assistantName: assistantDisplayName,
          platformName: branding.platformName.trim() || "Workspace"
        }) ||
        (isMobile
          ? t("welcome.subtitle")
          : `${t("welcome.greeting", { assistant: assistantDisplayName })} ${t("welcome.subtitle")}`);
  const welcomeSuggestions = useMemo(
    () => behavior.portalWelcomeSuggestions.map((item) => {
      if (locale !== "zh-CN") return { text: item.label, prompt: item.prompt };
      if (item.label === "Check product & version fit") return { text: t("welcome.fit"), prompt: t("welcome.fitPrompt") };
      if (item.label === "Review deployment plan") return { text: t("welcome.deployment"), prompt: t("welcome.deploymentPrompt") };
      if (item.label === "Analyze alarm or KPI issue") return { text: t("welcome.alarm"), prompt: t("welcome.alarmPrompt") };
      if (item.label === "Recommend solution design") return { text: t("welcome.solution"), prompt: t("welcome.solutionPrompt") };
      return { text: item.label, prompt: item.prompt };
    }),
    [behavior.portalWelcomeSuggestions, locale, t]
  );
  const isInternalAnswerFeedbackAudience = !isExternalPortalUser;
  const answerFeedbackConfig = useMemo<AnswerFeedbackUiConfig>(
    () => ({
      enabled: isInternalAnswerFeedbackAudience
        ? behavior.answerFeedback.enabledForInternalUsers
        : behavior.answerFeedback.enabledForExternalUsers,
      prompt:
        locale === "zh-CN" && (!behavior.answerFeedback.prompt.trim() || behavior.answerFeedback.prompt.trim() === "Was this answer helpful?")
          ? t("welcome.answerHelpful")
          : behavior.answerFeedback.prompt.trim() || t("welcome.answerHelpful")
    }),
    [
      behavior.answerFeedback.enabledForExternalUsers,
      behavior.answerFeedback.enabledForInternalUsers,
      behavior.answerFeedback.prompt,
      isInternalAnswerFeedbackAudience,
      locale,
      t
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
        modeId: effectiveRuntimeMode,
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
    effectiveRuntimeMode,
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

  const requestPreviewForPath = useCallback((filePath: string, options?: PreviewRequestOptions) => {
    const normalizedPath = normalizePreviewFilePath(filePath);
    if (!normalizedPath) return;
    setSelectedWorkspaceFile(null);
    setRequestedPreviewPath(normalizedPath);
    setRequestedDirectPreview(options?.contentUrl ? options : null);
    setPreviewRequestNonce((value) => value + 1);
    setLayoutState((prev) => switchWorkbenchTab(openWorkbenchDrawer(prev), "preview"));
  }, []);

  useEffect(() => {
    if (!activeRemoteThreadId || pendingServerThreads.has(activeRemoteThreadId)) {
      setActiveTaskFiles([]);
      return undefined;
    }
    let cancelled = false;
    setActiveTaskFiles([]);
    void workspaceDataSource.fetchTaskFiles(activeRemoteThreadId)
      .then((files) => {
        if (!cancelled) setActiveTaskFiles(files);
      })
      .catch(() => {
        if (!cancelled) setActiveTaskFiles([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeRemoteThreadId, serverThreadRevision, workspaceDataSource]);
  const attachmentWorkspaceFilesValue = useMemo<AttachmentWorkspaceFilesContextValue | null>(
    () => activeRemoteThreadId ? { apiBasePath: workspaceDataSource.apiBasePath, files: activeTaskFiles } : null,
    [activeRemoteThreadId, activeTaskFiles, workspaceDataSource.apiBasePath]
  );

  const requestPortalRunCancel = useCallback(() => {
    const run = activePortalRunRef.current;
    if (run && !run.sessionId) {
      // A single-request send still starting its session: the server finds it by run id.
      composerWorkflowController.markInterrupted(run.threadId);
      void api<{ cancelled: boolean }>("/api/chat/cancel", {
        method: "POST",
        json: {
          client_run_id: run.runId,
          thread_id: run.threadId,
          user_message_id: run.userMessageId,
          client_cancel_clicked_at: new Date().toISOString(),
          client_cancel_source: "portal_stop_button_preflight"
        }
      }).catch((error) => {
        console.warn("portal chat cancel failed", error);
      });
      return;
    }
    if (!run?.sessionId) {
      // Background response (this tab reloaded or lost the stream): cancel by thread.
      const threadId = activeRemoteThreadIdRef.current;
      if (!threadId) return;
      composerWorkflowController.markInterrupted(threadId);
      void api<{ cancelled: boolean }>("/api/chat/cancel", {
        method: "POST",
        json: {
          thread_id: threadId,
          client_cancel_clicked_at: new Date().toISOString(),
          client_cancel_source: "portal_stop_button_background"
        }
      }).catch((error) => {
        console.warn("portal chat cancel failed", error);
      });
      return;
    }
    composerWorkflowController.markInterrupted(run.threadId);
    void api<{ cancelled: boolean }>("/api/chat/cancel", {
      method: "POST",
      json: {
        session_id: run.sessionId,
        client_run_id: run.runId,
        thread_id: run.threadId,
        user_message_id: run.userMessageId,
        client_cancel_clicked_at: new Date().toISOString(),
        client_cancel_source: "portal_stop_button"
      }
    }).catch((error) => {
      console.warn("portal chat cancel failed", error);
    });
  }, [composerWorkflowController.markInterrupted]);

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
      const displayName = (anchor.textContent || "").trim() || fileNameFromPreviewPath(previewPath);
      requestPreviewForPath(previewPath, workspaceFilePreviewOptions(attachmentWorkspaceFilesValue, displayName));
    },
    [activeRemoteThreadId, attachmentWorkspaceFilesValue, requestPreviewForPath]
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
        if (trainingReadOnly) {
          throw new Error("Training catalog is read-only.");
        }
        const sendFailureContext = sendFailureContextFromMessages(options.messages);
        const knownThreadId = () =>
          String(activeRemoteThreadIdRef.current || options.unstable_threadId || activeLocalThreadIdRef.current || "").trim();
        if (!findRuntimeMode(runtimeOptionsRef.current, runtimeModeRef.current)) {
          const error = new Error(t("runtime.sendBlocked"));
          reportSendFailure({ stage: "run_blocked", threadId: knownThreadId(), error, errorCode: "runtime_mode_unavailable", ...sendFailureContext });
          throw error;
        }
        const prompt = extractLatestPrompt(options.messages);
        if (!prompt) {
          const error = new Error("No user input text detected");
          reportSendFailure({ stage: "run_blocked", threadId: knownThreadId(), error, errorCode: "empty_prompt", ...sendFailureContext });
          throw error;
        }
        const latestUserMessage = findLatestUserMessageForStream(options.messages);
        const latestUserMessageId = latestUserMessage?.message.id;
        const latestUserMessageForPersistence = latestUserMessage
          ? sanitizeMessageForPersistence(latestUserMessage.message)
          : undefined;
        const isSkillCreationRequest = !isExternalPortalUser && isSkillCreationIntent(prompt);
        const runtimePrompt = isSkillCreationRequest ? buildSkillCreatorReviewPrompt(prompt) : prompt;

        const threadId = await resolveRunThreadId({
          unstableThreadId: String(options.unstable_threadId || "").trim(),
          getActiveRemoteThreadId: () => String(activeRemoteThreadIdRef.current || "").trim(),
          getActiveLocalThreadId: () => String(activeLocalThreadIdRef.current || "").trim(),
          listThreads: async () => {
            const out = await api<ThreadListOut>("/api/threads");
            return out.threads || [];
          },
          findPendingRemoteThreadId: (localThreadId) => pendingServerThreads.findByLocalId(localThreadId)?.remoteId,
          attempts: 8,
          waitMs: 80
        });
        if (!threadId) {
          const error = new Error("Unable to resolve the current thread ID (the thread may still be initializing, please try again).");
          reportSendFailure({ stage: "thread_resolve", threadId: knownThreadId(), error, ...sendFailureContext });
          throw error;
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
            updateRunningStage("Checking thread access");
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

        setErrorText("");
        setPortalChatRecoveryActive((current) => resolvePortalChatRecoveryActive(current, "run-start"));
        setStatusText(isSkillCreationRequest ? "Creating skill..." : "Generating...");
        updateRunningStage(RUNNING_STAGE_RECEIVED_TEXT, { kind: "text" });
        startRunningStageWaitTimers();

        // Single-request send: the stream request itself creates the task (when new), saves the
        // message and starts the session. Older releases get the separate requests below.
        const singleRequest = singleRequestSendSupported();
        const pendingThread = singleRequest ? pendingServerThreads.get(threadId) : undefined;
        if (!singleRequest) {
          try {
            updateRunningStage("Saving your message", { kind: "text" });
            await api(`/api/threads/${encodeURIComponent(threadId)}/messages`, {
              method: "POST",
              json: pendingPortalUserMessageAppend({
                messageId: latestUserMessageId,
                parentId: latestUserMessage?.parentId ?? null,
                message: latestUserMessageForPersistence
              })
            });
          } catch (error) {
            if (error instanceof ApiError && error.code === "PORTAL_RUN_ACTIVE") {
              // This thread still runs a response this tab does not stream (another tab or a
              // reload). The server kept nothing: queue the message and drop the optimistic copy.
              composerWorkflowController.requeueRejectedSend(threadId, prompt);
              setServerRunningThreadIds((prev) =>
                updateRunningThreadMapForKeys(prev, normalizeThreadIdentityKeys(threadId, localThreadId), true)
              );
              setErrorText(t("thread.runActiveQueued"));
              setStatusText("Ready");
              stopRunningStageWaitTimers();
              updateRunningStage(DEFAULT_RUNNING_STAGE_TEXT, { fallback: false, kind: "text" });
              window.setTimeout(() => void reloadThreadHistoryRef.current?.(threadId).catch(() => undefined), 0);
              return;
            }
            if (shouldBrowserReportSendFailure(error)) {
              reportSendFailure({ stage: "message_save", threadId, error, ...sendFailureContext });
            }
            const notice = formatAssistantErrorNoticeFromError(error, "Failed to save your message", t);
            if (latestUserMessage) window.dispatchEvent(new CustomEvent("bailey-restore-composer", { detail: {
              threadId,
              text: latestUserMessage.message.content.filter(part => part.type === "text").map(part => (part as { text: string }).text).join("\n"),
              attachments: latestUserMessage.message.attachments
            } }));
            setErrorText(notice);
            stopRunningStageWaitTimers();
            updateRunningStage("Request needs attention", { fallback: false, kind: "text" });
            throw new Error(notice);
          }
        }
        updateRunningStage("Preparing response", { kind: "text" });

        const cfg = normalizeRuntimeConfig(appliedConfigRef.current, runtimeOptionsRef.current);
        const knowledgeSetIds = normalizeKnowledgeSetIds(selectedKnowledgeSetIdsRef.current);
        const pendingSkillHydration = skillHydrationRef.current;
        if (pendingSkillHydration?.threadId === threadId) {
          await pendingSkillHydration.promise;
        }
        const turnSelectedSkillIds =
          hydratedSkillThreadIdRef.current === threadId
            ? [...enabledSkillIdsRef.current]
            : undefined;
        const runtimeModeOverride = runtimeModeOverrideRef.current;
        const allowModeChange = Boolean(
          runtimeModeOverride &&
          runtimeModeOverride.threadId === threadId &&
          runtimeModeOverride.modeId === runtimeModeRef.current
        );
        const clientRunId = createPortalRunId();
        const activeRun: PortalActiveRun = {
          sessionId: "",
          runId: clientRunId,
          threadId,
          userMessageId: latestUserMessageId
        };
        let activeSessionModel = "";
        const applyStartedSession = (started: { model?: string; reasoning_effort?: string }) => {
          if (started.model) activeSessionModel = started.model;
          if (!allowModeChange) return;
          runtimeModeOverrideRef.current = null;
          setWorkspaceThreads((current) => current.map((thread) =>
            thread.id === threadId
              ? {
                  ...thread,
                  mode_id: runtimeModeRef.current,
                  model: started.model ?? thread.model,
                  reasoning_effort: (started.reasoning_effort as ThreadOut["reasoning_effort"]) ?? thread.reasoning_effort
                }
              : thread
          ));
        };
        if (!singleRequest) {
          let ensured: ThreadSessionOut;
          try {
            ensured = await api<ThreadSessionOut>(`/api/threads/${encodeURIComponent(threadId)}/session`, {
              method: "POST",
              json: {
                model: cfg.model,
                reasoning_effort: cfg.reasoningEffort,
                knowledge_set_ids: knowledgeSetIds,
                selected_skill_ids: turnSelectedSkillIds,
                codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current),
                allow_mode_change: allowModeChange,
                client_run_id: clientRunId,
                client_user_message_id: latestUserMessageId,
                client_assistant_message_id: options.unstable_assistantMessageId,
                portal_locale: localeRef.current
              }
            });
            applyStartedSession(ensured.session);
          } catch (error) {
            if (shouldBrowserReportSendFailure(error)) {
              reportSendFailure({ stage: "session_start", threadId, error, clientRunId, ...sendFailureContext });
            }
            const notice = formatAssistantErrorNoticeFromError(error, "Failed to initialize the current session", t);
            setErrorText(notice);
            void refreshPortalSubscriptionStatusRef.current({ silent: true });
            stopRunningStageWaitTimers();
            updateRunningStage("Request needs attention", { fallback: false, kind: "text" });
            throw new Error(notice);
          }
          activeRun.sessionId = ensured.session.session_id;
        }
        activePortalRunRef.current = activeRun;

        let hasTextUpdate = false;
        let doneAnswer = "";
        let portalRunCompleted = false;
        let portalRunFailed = false;
        let portalRunRejectedWhileRunning = false;
        const orderedParts: any[] = [];
        let activeTextPart: { type: "text"; text: string } | null = null;
        let activeCommentaryPart:
          | {
              type: "data";
              name: "codex_commentary";
              data: CommentaryPartData;
            }
          | null = null;
        let activeFinalAnswerPart: { type: "text"; text: string } | null = null;
        let currentCommentaryKey = "";
        let commentarySeq = 0;
        let traceBatchSeq = 0;
        let traceRowSeq = 0;
        let seq = 0;
        let firstRuntimeEventSeen = false;
        let finalAnswerStreamStarted = false;
        let activeTraceBatchPart: TraceBatchPart | null = null;
        const agentMessagePhaseById = new Map<string, string>();
        const finalAnswerTextById = new Map<string, string>();
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

        const completeCommentaryParts = (options?: { close?: boolean }): boolean => {
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
            if (payload.status !== "completed") {
              payload.status = "completed";
              changed = true;
            }
            if (options?.close && payload.open !== false) {
              payload.open = false;
              changed = true;
            }
          }
          return changed;
        };

        const appendFinalAnswerText = (key: string, nextText: string, mode: "append" | "replace"): boolean => {
          if (!nextText) return false;
          if (!finalAnswerStreamStarted) {
            finalAnswerStreamStarted = true;
            completeCommentaryParts({ close: false });
          }
          activeCommentaryPart = null;
          currentCommentaryKey = "";
          if (!activeFinalAnswerPart) {
            activeFinalAnswerPart = { type: "text", text: "" };
            orderedParts.push(activeFinalAnswerPart);
          }
          const previousText = finalAnswerTextById.get(key) || "";
          const resolvedText = mode === "replace" ? nextText : `${previousText}${nextText}`;
          if (mode === "replace") {
            if (previousText && nextText.startsWith(previousText)) {
              activeFinalAnswerPart.text += nextText.slice(previousText.length);
            } else if (previousText) {
              activeFinalAnswerPart.text = activeFinalAnswerPart.text.slice(0, -previousText.length) + nextText;
            } else {
              activeFinalAnswerPart.text += nextText;
            }
          } else {
            activeFinalAnswerPart.text += nextText;
          }
          finalAnswerTextById.set(key, resolvedText);
          activeTextPart = activeFinalAnswerPart;
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
              status: finalAnswerStreamStarted ? "completed" : "streaming"
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
              status: finalAnswerStreamStarted ? "completed" : "streaming"
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
          const nextStatus = finalAnswerStreamStarted ? "completed" : "streaming";
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
          entry.status = nextStatus;
          part.data.open = true;
          part.data.last_event_at = now;
          syncCommentaryPartSummary(part);
          if (!finalAnswerStreamStarted) {
            part.data.status = "streaming";
          }
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

        const collapseCommentaryParts = (): boolean => completeCommentaryParts({ close: true });

        const hasStreamedFinalAnswerText = (): boolean => {
          if (activeFinalAnswerPart?.text.trim()) return true;
          for (const text of finalAnswerTextById.values()) {
            if (text.trim()) return true;
          }
          return false;
        };

        const normalizeAgentMessagePhase = (value: unknown): string => {
          return typeof value === "string" ? value.trim().replace(/[-\s]+/g, "_").toLowerCase() : "";
        };

        const rememberAgentMessagePhase = (id: string, phase: string): void => {
          if (!id || !phase) return;
          agentMessagePhaseById.set(id, phase);
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
          let changed = upsertLocalToolParts(orderedParts, parts);
          for (const part of parts) {
            const partObj = asRecord(part);
            if (!partObj || partObj.type !== "data") continue;
            const name = typeof partObj.name === "string" ? partObj.name.trim() : "";
            if (
              name !== "codex_file_change" &&
              name !== "skill_draft_status" &&
              name !== "codex_instruction_reads" &&
              name !== "agent_studio_memory_context" &&
              name !== "codex_connection_recovery" &&
              name !== "codex_recovery_failure" &&
              name !== USER_INPUT_REQUEST_PART_NAME
            ) continue;
            if (isExternalPortalUser && name === "codex_file_change") {
              const dataObj = asRecord(partObj.data);
              if (dataObj?.artifact_only !== true) {
                continue;
              }
            }
            activeTextPart = null;
            activeCommentaryPart = null;
            currentCommentaryKey = "";
            const displayPart = {
              type: "data",
              name,
              data: partObj.data
            };
            if (name === "codex_file_change") {
              const consolidated = consolidateCodexFileChangeParts([...orderedParts, displayPart]);
              orderedParts.splice(0, orderedParts.length, ...(consolidated as any[]));
            } else if (name === USER_INPUT_REQUEST_PART_NAME) {
              const requestId = asRecord(partObj.data)?.id;
              const existingIndex = orderedParts.findIndex((item) => {
                const existing = asRecord(item);
                return existing?.type === "data" && existing.name === name && asRecord(existing.data)?.id === requestId;
              });
              if (existingIndex >= 0) orderedParts.splice(existingIndex, 1, displayPart);
              else orderedParts.push(displayPart);
            } else if (
              name === "codex_instruction_reads" ||
              name === "agent_studio_memory_context" ||
              name === "codex_connection_recovery" ||
              name === "codex_recovery_failure"
            ) {
              const existingIndex = orderedParts.findIndex((item) => {
                const existing = asRecord(item);
                return existing?.type === "data" && existing.name === name;
              });
              if (existingIndex >= 0) orderedParts.splice(existingIndex, 1, displayPart);
              else orderedParts.push(displayPart);
            } else {
              orderedParts.push(displayPart);
            }
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
          return orderAssistantContentParts(orderedParts.map((part) => {
            const item = asRecord(part);
            if (!item) return { ...part };
            if (item.type === "text" && typeof item.text === "string") {
              return { ...part };
            }
            if (item.type !== "data") return { ...part };
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
          }));
        };

        const runningThreadKeys = normalizeThreadIdentityKeys(threadId, localThreadId);
        runningThreadKeys.forEach((key) => completedRunThreadIdsRef.current.delete(key));
        setActiveRunThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, true));
        setRuntimeRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
        setCompletedNoticeThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
        try {
          try {
          const streamRequestBody = JSON.stringify({
            ...(singleRequest
              ? {
                  ...(pendingThread
                    ? {
                        new_thread: {
                          id: threadId,
                          external_id: pendingThread.localId || undefined,
                          title: pendingThread.title || guessThreadTitle(options.messages) || undefined,
                          folder_id: pendingThread.folderId,
                          local_root_id: pendingThread.localRootId,
                          codex_run_config: newThreadRunSettingsRef.current().codex_run_config
                        }
                      }
                    : {}),
                  model: cfg.model,
                  reasoning_effort: cfg.reasoningEffort,
                  knowledge_set_ids: knowledgeSetIds,
                  codex_run_config: buildCodexRunConfig(cfg, runtimeModeRef.current),
                  allow_mode_change: allowModeChange
                }
              : { session_id: activeRun.sessionId }),
            client_run_id: clientRunId,
            client_assistant_message_id: options.unstable_assistantMessageId,
            thread_id: threadId,
            user_message_id: latestUserMessageId,
            client_user_message_id: latestUserMessageId,
            parent_id: latestUserMessage?.parentId ?? null,
            user_message: latestUserMessageForPersistence,
            display_message: prompt,
            selected_skill_ids: turnSelectedSkillIds,
            portal_locale: localeRef.current,
            message: runtimePrompt
          });
          const openStream = () => iterateSSE(`${apiBase()}/api/chat/stream`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              ...authHeaders()
            },
            body: streamRequestBody,
            signal: options.abortSignal
          });
          // Until the server accepts the message, a dropped connection is retried silently with the
          // same run id; the user only sees "reconnecting" while it lasts.
          const streamEvents = singleRequest
            ? streamPortalSendWithRetry({
                open: openStream,
                signal: options.abortSignal,
                onRetry: () => {
                  updateRunningStage(t("thread.sendReconnecting"), { fallback: false, kind: "text" });
                },
                onDelivered: (result: PortalSendAttemptResult) => {
                  if (result.attempts <= 1) return;
                  updateRunningStage("Preparing response", { kind: "text" });
                  reportSendFailure({
                    stage: "chat_stream_recovered",
                    threadId,
                    error: result.lastError,
                    errorCode: "recovered_after_retry",
                    attempts: result.attempts,
                    clientRunId,
                    ...sendFailureContext
                  });
                }
              })
            : openStream();
          for await (const { event, data } of streamEvents) {
            const updates: any[] = [];
            let textChanged = false;
            const payload = asRecord(data);

            if (event === "accepted") {
              const acceptedThread = asRecord(payload?.thread);
              if (pendingThread && acceptedThread && typeof acceptedThread.id === "string") {
                handleServerThreadCreatedRef.current(acceptedThread as unknown as ThreadOut, pendingThread.localId);
              } else if (pendingThread && pendingServerThreads.has(threadId)) {
                pendingServerThreads.confirm(threadId);
                setServerThreadRevision((value) => value + 1);
              }
              if (payload?.duplicate === true) {
                // A retry of a send the server already has: follow that response instead.
                break;
              }
              continue;
            }

            if (event === "session") {
              const startedSessionId = asString(payload?.session_id);
              if (startedSessionId) activeRun.sessionId = startedSessionId;
              applyStartedSession({
                model: asString(payload?.model) || undefined,
                reasoning_effort: asString(payload?.reasoning_effort) || undefined
              });
              continue;
            }

            if (event === "error" && payload?.code === "PORTAL_RUN_ACTIVE") {
              // The previous response is still running on the server (this tab lost its
              // stream). Nothing was persisted: queue the message and show that response.
              portalRunRejectedWhileRunning = true;
              composerWorkflowController.requeueRejectedSend(threadId, prompt);
              setServerRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, true));
              setErrorText(t("thread.runActiveQueued"));
              break;
            }

            if (event === "error") {
              portalRunFailed = true;
              const detail =
                (payload && typeof payload.detail === "string" ? payload.detail : "") || "Request failed";
              const errorCode =
                (payload && typeof payload.code === "string" ? payload.code : "") ||
                (payload && typeof payload.reason_code === "string" ? payload.reason_code : "");
              const autoRecoveryAttempted = payload?.auto_recovery_attempted === true;
              const assistantErrorNotice = formatAssistantErrorNotice(detail, errorCode, t);
              const processDetail = userSafeProcessDetail(detail);
              setErrorText(autoRecoveryAttempted ? "" : assistantErrorNotice);
              void refreshPortalSubscriptionStatusRef.current({ silent: true });
              stopRunningStageWaitTimers();
              updateRunningStage("Request needs attention", { fallback: false, kind: "text" });
              setPortalChatRecoveryActive((current) => resolvePortalChatRecoveryActive(current, "run-failed"));
              if (autoRecoveryAttempted) {
                for (let index = orderedParts.length - 1; index >= 0; index -= 1) {
                  const part = asRecord(orderedParts[index]);
                  if (part?.type === "data" && part.name === "codex_connection_recovery") {
                    orderedParts.splice(index, 1);
                  }
                }
                const recoveryFailureChanged = appendDisplayDataParts([{
                  type: "data",
                  name: "codex_recovery_failure",
                  data: { attempted: true }
                }]);
                if (recoveryFailureChanged) {
                  yield { content: snapshotContent() };
                }
                throw new Error("portal_auto_recovery_exhausted");
              }
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
                    title: "Needs attention",
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
                    title: "Needs attention",
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

            if (event === "recovery") {
              const recoveryStatus = typeof payload?.status === "string" ? payload.status : "retrying";
              if (recoveryStatus === "recovered") {
                setPortalChatRecoveryActive((current) =>
                  resolvePortalChatRecoveryActive(current, "automatic-recovered")
                );
                for (let index = orderedParts.length - 1; index >= 0; index -= 1) {
                  const part = asRecord(orderedParts[index]);
                  if (part?.type === "data" && part.name === "codex_connection_recovery") {
                    orderedParts.splice(index, 1);
                  }
                }
                yield { content: snapshotContent() };
                continue;
              }
              setErrorText("");
              setPortalChatRecoveryActive((current) => resolvePortalChatRecoveryActive(current, "automatic-retry"));
              updateRunningStage(t("thread.connectionRecovering"), { fallback: false, kind: "text" });
              const changed = appendDisplayDataParts([{
                type: "data",
                name: "codex_connection_recovery",
                data: { attempt: 2, maxAttempts: 2 }
              }]);
              if (changed) {
                yield { content: snapshotContent() };
              }
              continue;
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

            if (event === "memory_context") {
              const contentPart = asRecord(payload?.content_part ?? payload?.contentPart);
              if (contentPart?.type !== "data" || contentPart.name !== "agent_studio_memory_context") continue;
              const changed = appendDisplayDataParts([contentPart]);
              if (changed) {
                const content = snapshotContent();
                if (content.length > 0) yield { content };
              }
              continue;
            }

            if (event === "user_input_request") {
              const contentPart = asRecord(payload?.content_part ?? payload?.contentPart);
              if (contentPart?.type !== "data" || contentPart.name !== USER_INPUT_REQUEST_PART_NAME) continue;
              const changed = appendDisplayDataParts([contentPart]);
              if (changed) {
                updateRunningStage(t("userInput.title"), { fallback: false, kind: "text" });
                const content = snapshotContent();
                if (content.length > 0) yield { content };
              }
              continue;
            }

            if (event === "instruction_reads") {
              const contentPart = asRecord(payload?.content_part ?? payload?.contentPart);
              if (contentPart?.type !== "data" || contentPart.name !== "codex_instruction_reads") continue;
              const changed = appendDisplayDataParts([contentPart]);
              if (changed) {
                const content = snapshotContent();
                if (content.length > 0) yield { content };
              }
              continue;
            }

            if (event === "done") {
              portalRunCompleted = true;
              setPortalChatRecoveryActive((current) => resolvePortalChatRecoveryActive(current, "run-complete"));
              for (let index = orderedParts.length - 1; index >= 0; index -= 1) {
                const part = asRecord(orderedParts[index]);
                if (part?.type === "data" && part.name === "codex_connection_recovery") {
                  orderedParts.splice(index, 1);
                  textChanged = true;
                }
              }
              doneAnswer =
                payload && typeof payload.answer === "string" ? payload.answer : "";
              void refreshPortalSubscriptionStatusRef.current({ silent: true });
              updateRunningStage(RUNNING_STAGE_RESULT_TEXT, { fallback: false, kind: "text" });
              if (doneAnswer.trim()) {
                const reconciliation = reconcileAuthoritativeFinalAnswer(
                  orderedParts,
                  doneAnswer,
                  activeFinalAnswerPart
                );
                activeFinalAnswerPart = reconciliation.part;
                activeTextPart = reconciliation.part;
                finalAnswerTextById.clear();
                if (reconciliation.part) {
                  finalAnswerTextById.set("done", reconciliation.part.text);
                }
                hasTextUpdate = true;
                textChanged = textChanged || reconciliation.changed;
                if (reconciliation.corrected) {
                  console.warn("[portal-stream] corrected incomplete final answer from done payload", {
                    threadId,
                    answerLength: doneAnswer.length
                  });
                }
              } else if (hasStreamedFinalAnswerText()) {
                textChanged = true;
              } else {
                const promotedLatestCommentary = promoteLatestCommentaryToFinalText();
                if (promotedLatestCommentary) {
                  textChanged = true;
                }
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
              const hasFileChangePart = orderedParts.some((part) => {
                const partObj = asRecord(part);
                return partObj?.type === "data" && partObj.name === "codex_file_change";
              });
              if (hasFileChangePart) {
                const consolidated = consolidateCodexFileChangeParts(orderedParts);
                orderedParts.splice(0, orderedParts.length, ...(consolidated as any[]));
              }
              if (dataPartChanged || traceChanged || textChanged || commentaryCollapsed || hasFileChangePart) {
                const content = snapshotContent();
                if (content.length > 0) {
                  yield { content };
                }
              }
              continue;
            }

            if (event === "meta") {
              const metaSessionId = asString(payload?.session_id);
              if (metaSessionId && !activeRun.sessionId) activeRun.sessionId = metaSessionId;
              const metaModel = asString(payload?.model);
              if (metaModel && !activeSessionModel) activeSessionModel = metaModel;
              if (processEnabled) {
                const model = payload && typeof payload.model === "string" ? payload.model : "";
                const reasoning =
                  payload && typeof payload.reasoning_effort === "string" ? payload.reasoning_effort : "";
                const preparationDetail = [
                  [model, reasoning].filter(Boolean).join(" / "),
                  "Preparing the first update."
                ]
                  .filter(Boolean)
                  .join("\n");
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "meta",
                    at: new Date().toISOString(),
                    title: "Preparing your workspace",
                    detail: preparationDetail
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
            const agentMessagePhaseFromItem = itemType === "agent_message" ? normalizeAgentMessagePhase(item?.phase) : "";
            if (agentMessagePhaseFromItem) {
              rememberAgentMessagePhase(itemId, agentMessagePhaseFromItem);
            }
            const agentMessagePhase =
              itemType === "agent_message" ? agentMessagePhaseFromItem || agentMessagePhaseById.get(itemId) || "" : "";
            const isFinalAnswerAgentMessage = itemType === "agent_message" && agentMessagePhase === "final_answer";

            if (!firstRuntimeEventSeen) {
              firstRuntimeEventSeen = true;
              updateRunningStage(RUNNING_STAGE_CONTEXT_TEXT, { kind: "text" });
              if (processEnabled) {
                updates.push({
                  type: "data",
                  name: "codex_process",
                  data: {
                    kind: "meta",
                    at: new Date().toISOString(),
                    title: "Analyzing context",
                    detail: "First processing update received."
                  } satisfies ProcessData
                });
              }
            }

            if (eventType === "token_count") {
              const usageInfo = asRecord(raw?.info);
              const runtimeUsage = parseTurnUsage(usageInfo?.last_token_usage ?? usageInfo?.total_token_usage);
              const runtimeContextLimit = toTokenCount(usageInfo?.model_context_window);
              if (runtimeUsage && runtimeContextLimit !== null && runtimeContextLimit > 0) {
                const usageModel = String(activeSessionModel || cfg.model || "").trim();
                const snapshot: ContextUsageSnapshot = {
                  threadId,
                  model: usageModel || "unknown",
                  contextLimit: runtimeContextLimit,
                  ...runtimeUsage,
                  updatedAt: new Date().toISOString()
                };
                usageByThreadRef.current[threadId] = snapshot;
                setContextUsage(snapshot);
              }
            }

            if (eventType === "turn.completed") {
              const usage = parseTurnUsage(raw?.usage ?? payload?.usage);
              if (usage) {
                const usageModel = String(activeSessionModel || cfg.model || "").trim();
                const runtimeSnapshot = usageByThreadRef.current[threadId];
                const snapshot: ContextUsageSnapshot = {
                  threadId,
                  model: usageModel || "unknown",
                  contextLimit:
                    runtimeSnapshot?.model === (usageModel || "unknown")
                      ? runtimeSnapshot.contextLimit
                      : contextLimitForModel(
                          usageModel,
                          modelOptionsFromCatalog(runtimeOptionsRef.current?.modelCatalog)
                        ),
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
              const nextMode = delta ? "append" : "replace";
              if (isFinalAnswerAgentMessage) {
                const finalAnswerKey = itemId || `final-answer-${++seq}`;
                textChanged = appendFinalAnswerText(finalAnswerKey, append, nextMode) || textChanged;
              } else {
                const commentaryKey = itemId || currentCommentaryKey || `commentary-${++commentarySeq}`;
                textChanged = updateCommentaryPart(commentaryKey, append, nextMode) || textChanged;
              }
            }

            const isStarted = eventType === "item.started";
            const isCompleted = eventType === "item.completed";
            if (itemType && (isStarted || isCompleted)) {
              const isImageItemStage = isImageGenerationItem(itemType, item);
              const nextStageText = stageTextForCodexItem(itemType, isStarted ? "started" : "completed", item);
              const isImageStageText = isImageGenerationStageText(nextStageText);
              if (isImageStageText) {
                setStatusText("Generating image...");
                updateRunningStage(nextStageText, { kind: "image" });
              } else if (isImageItemStage && isCompleted) {
                updateRunningStage(nextStageText, { fallback: false, kind: "text" });
              } else if (runningStageKindRef.current !== "image") {
                updateRunningStage(nextStageText);
              }
            }

            if (processEnabled && itemType && (isStarted || isCompleted)) {
              const completedTraceHandledElsewhere = [
                "reasoning",
                "command_execution",
                "mcp_tool_call",
                "web_search",
                "todo_list",
                "file_change",
                "error"
              ];
              if (isStarted || !completedTraceHandledElsewhere.includes(itemType)) {
                const lifecycleTrace = codexLifecycleProcessTrace(itemType, isStarted ? "started" : "completed", item);
                if (lifecycleTrace) {
                  const status = typeof item?.status === "string" ? item.status : undefined;
                  updates.push({
                    type: "data",
                    name: "codex_process",
                    data: {
                      kind: lifecycleTrace.kind,
                      at: new Date().toISOString(),
                      title: lifecycleTrace.title,
                      detail: lifecycleTrace.detail,
                      event: eventType,
                      item_type: itemType,
                      status
                    } satisfies ProcessData
                  });
                }
              }
            }

            if (itemType === "agent_message" && isCompleted && !isFinalAnswerAgentMessage && finalAnswerStreamStarted) {
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
                  title: "Workspace operation completed",
                  detail: [command ? `$ ${command}` : "", exitCode !== undefined ? `exit_code=${exitCode}` : ""]
                    .filter(Boolean)
                    .join("\n"),
                  event: eventType,
                  item_type: itemType,
                  status
                } satisfies ProcessData
              });
            }

            if (itemType === "mcp_tool_call" && (isCompleted || (item?.server === "local_computer" && eventType === "item.started")) && (processEnabled || item?.server === "local_computer")) {
              const server = typeof item?.server === "string" ? item.server : "";
              const tool = typeof item?.tool === "string" ? item.tool : "";
              const args = (item?.arguments && typeof item.arguments === "object" ? item.arguments : {}) as Record<
                string,
                unknown
              >;
              const error = asRecord(item?.error);
              const errMsg = typeof error?.message === "string" ? error.message : "";
              const localDeviceName = server === "local_computer" ? localWorkspace.selectionRef.current?.device_name : undefined;
              // Stamp the computer like the saved card does, so the live card keeps it after the user switches folders.
              const parsedLocalResult = localDeviceName ? localToolResultObject(item?.result) : {};
              const result = Object.keys(parsedLocalResult).length > 0 ? { ...parsedLocalResult, device_name: localDeviceName } : item?.result;
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
                ...(isCompleted && result != null ? { result } : {}),
                ...(errMsg ? { isError: true } : {})
              });
              if (isCompleted && processEnabled) updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: crestTrace?.title ?? "Tool step completed",
                  detail: crestTrace?.detail ?? rawDetail,
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
                    title: "Search completed",
                    detail: query,
                    event: eventType,
                    item_type: itemType
                  } satisfies ProcessData
                });
              }
            }

            if (itemType === "todo_list" && isCompleted && processEnabled) {
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
                  title: "Plan updated",
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
                    title: "Files updated",
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
                  title: "Needs attention",
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
              ![
                "agent_message",
                "user_message",
                "hookPrompt",
                "reasoning",
                "command_execution",
                "mcp_tool_call",
                "web_search",
                "todo_list",
                "plan",
                "file_change",
                "error",
                "contextCompaction",
                "image_generation",
                "image_generation_call",
                "imageGeneration",
                "image_generation_end",
                "image_view",
                "imageView",
                "collabAgentToolCall",
                "subAgentActivity",
                "enteredReviewMode",
                "exitedReviewMode",
                "sleep"
              ].includes(itemType)
            ) {
              const status = typeof item?.status === "string" ? item.status : undefined;
              updates.push({
                type: "data",
                name: "codex_process",
                data: {
                  kind: "process",
                  at: new Date().toISOString(),
                  title: "Processing step",
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
          if (!portalRunCompleted && !portalRunFailed && !portalRunRejectedWhileRunning && !options.abortSignal.aborted) {
            throw new Error("connection closed before response completion");
          }
          } catch (error) {
            if (error instanceof PortalSendNotDeliveredError && !options.abortSignal.aborted) {
              // Never reached the server after the silent retries: nothing was saved there.
              portalRunFailed = true;
              reportSendFailure({
                stage: "chat_stream",
                threadId,
                error: error.lastError,
                errorCode: "send_not_delivered",
                attempts: error.attempts,
                clientRunId,
                ...sendFailureContext
              });
              setErrorText("");
              stopRunningStageWaitTimers();
              updateRunningStage("Request needs attention", { fallback: false, kind: "text" });
              // The empty-answer view turns this error into the "not sent" notice with a resend button.
              throw new Error("portal_send_not_delivered");
            }
            if (options.abortSignal.aborted || portalRunFailed || !isPortalTransportDisconnect(error)) {
              throw error;
            }

            setErrorText("");
            setPortalChatRecoveryActive(true);
            updateRunningStage(t("thread.connectionBackground"), { fallback: false, kind: "text" });
            appendDisplayDataParts([{
              type: "data",
              name: "codex_connection_recovery",
              data: { background: true }
            }]);
            yield { content: snapshotContent() };

            const recoveryDeadline = Date.now() + 10 * 60_000;
            while (!options.abortSignal.aborted && Date.now() < recoveryDeadline) {
              try {
                const history = await api<ThreadMessagesOut>(
                  `/api/threads/${encodeURIComponent(threadId)}/messages`
                );
                const completedContent = completedAssistantContentForParent(
                  history,
                  latestUserMessageId,
                  clientRunId
                );
                if (completedContent) {
                  portalRunCompleted = true;
                  hasTextUpdate = completedContent.some((part) => {
                    const item = asRecord(part);
                    return item?.type === "text" && typeof item.text === "string" && item.text.trim().length > 0;
                  });
                  setPortalChatRecoveryActive(false);
                  setErrorText("");
                  yield { content: completedContent as any[] };
                  break;
                }
                const running = await api<RunningThreadsOut>("/api/threads/running");
                if (!running.thread_ids.includes(threadId)) {
                  throw new Error("portal_background_recovery_finished_without_answer");
                }
              } catch (pollError) {
                if (
                  pollError instanceof Error &&
                  pollError.message === "portal_background_recovery_finished_without_answer"
                ) {
                  throw pollError;
                }
              }
              await new Promise((resolve) => window.setTimeout(resolve, 2000));
            }
            if (!portalRunCompleted && !options.abortSignal.aborted) {
              portalRunFailed = true;
              throw new Error("portal_background_recovery_timeout");
            }
          }

          if (!hasTextUpdate && doneAnswer) {
            appendTextPart(doneAnswer);
            yield {
              content: snapshotContent()
            };
          }
        } finally {
          setPortalChatRecoveryActive((current) => resolvePortalChatRecoveryActive(current, "run-complete"));
          if (portalRunCompleted) {
            composerWorkflowController.markRunCompleted(threadId);
          } else if (portalRunFailed) {
            composerWorkflowController.markRunFailed(threadId);
          }
          if ((portalRunCompleted || portalRunFailed) && !options.abortSignal.aborted) {
            dispatchPortalRunFinished({ threadId, status: portalRunCompleted ? "completed" : "failed" });
          }
          const currentActiveRun = activePortalRunRef.current;
          if (
            currentActiveRun?.sessionId === activeRun.sessionId &&
            currentActiveRun.runId === activeRun.runId &&
            currentActiveRun.threadId === activeRun.threadId &&
            currentActiveRun.userMessageId === activeRun.userMessageId
          ) {
            activePortalRunRef.current = null;
          }
          runningThreadKeys.forEach((key) => completedRunThreadIdsRef.current.add(key));
          const activeThreadKeys = normalizeThreadIdentityKeys(
            activeThreadIdentityRef.current.remoteId,
            activeThreadIdentityRef.current.localId
          );
          const completedInActiveThread = runningThreadKeys.some((key) => activeThreadKeys.includes(key));
          if (completedInActiveThread) {
            void markPortalThreadRead(threadId);
          }
          setActiveRunThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
          setRuntimeRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
          if (portalRunRejectedWhileRunning) {
            // Drop the optimistic user message: the server did not accept it.
            window.setTimeout(() => void reloadThreadHistoryRef.current?.(threadId).catch(() => undefined), 0);
          } else {
            // The finished run is no longer running; don't wait for the next status poll.
            setServerRunningThreadIds((prev) => updateRunningThreadMapForKeys(prev, runningThreadKeys, false));
          }
          setCompletedNoticeThreadIds((prev) =>
            updateRunningThreadMapForKeys(prev, runningThreadKeys, !completedInActiveThread)
          );
          setStatusText("Ready");
          stopRunningStageWaitTimers();
          updateRunningStage(DEFAULT_RUNNING_STAGE_TEXT, { fallback: false, kind: "text" });
        }
      }
    }),
    [
      composerWorkflowController.markRunCompleted,
      composerWorkflowController.markRunFailed,
      composerWorkflowController.requeueRejectedSend,
      markPortalThreadRead,
      t,
      trainingReadOnly
    ]
  );

  const runtime = useRemoteThreadListRuntime({
    adapter: threadListAdapter,
    runtimeHook: function RuntimeHook() {
      return useLocalRuntime(chatAdapter);
    }
  });

  // A response can keep running on the server while this tab does not stream it
  // (page reload, lost connection, another tab). The composer then queues/steers
  // instead of starting a run, and the history reloads once that response ends.
  const activeThreadBackgroundRunning = Boolean(
    !trainingReadOnly &&
      activeRemoteThreadId &&
      serverRunningThreadIds[activeRemoteThreadId] &&
      !activeRunThreadIds[activeRemoteThreadId]
  );
  // Until the finished response is loaded, keep queued messages from being sent on
  // top of stale history (they would branch off the previous user message).
  const [backgroundHistorySyncThreadId, setBackgroundHistorySyncThreadId] = useState("");
  const backgroundRunContextValue = useMemo(
    () => ({
      backgroundRunning:
        activeThreadBackgroundRunning ||
        Boolean(activeRemoteThreadId && backgroundHistorySyncThreadId === activeRemoteThreadId)
    }),
    [activeRemoteThreadId, activeThreadBackgroundRunning, backgroundHistorySyncThreadId]
  );
  const reloadThreadHistory = useCallback(async (threadId: string) => {
    if (!threadId || trainingReadOnly) return;
    const out = await api<ThreadMessagesOut>(`/api/threads/${encodeURIComponent(threadId)}/messages`);
    // A rejected send is still settling its local run when the reload starts; wait briefly
    // so the optimistic message is replaced instead of lingering as a branch.
    for (let attempt = 0; attempt < 30 && runtime.thread.getState().isRunning; attempt += 1) {
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
    if (activeRemoteThreadIdRef.current !== threadId) return;
    if (runtime.thread.getState().isRunning) return;
    runtime.thread.import(threadMessagesOutToRepository(out));
  }, [runtime, trainingReadOnly]);
  reloadThreadHistoryRef.current = reloadThreadHistory;
  const previousBackgroundRunRef = useRef({ threadId: "", running: false });
  useEffect(() => {
    const previous = previousBackgroundRunRef.current;
    previousBackgroundRunRef.current = { threadId: activeRemoteThreadId, running: activeThreadBackgroundRunning };
    if (
      previous.threadId === activeRemoteThreadId &&
      previous.running &&
      !activeThreadBackgroundRunning &&
      !activeRunThreadIds[activeRemoteThreadId]
    ) {
      const threadId = activeRemoteThreadId;
      setBackgroundHistorySyncThreadId(threadId);
      void reloadThreadHistory(threadId)
        .catch(() => undefined)
        .finally(() => setBackgroundHistorySyncThreadId((current) => (current === threadId ? "" : current)));
    }
  }, [activeRemoteThreadId, activeRunThreadIds, activeThreadBackgroundRunning, reloadThreadHistory]);

  const pendingComposerAttachmentsRef = useRef(0);
  const setPendingComposerAttachments = useCallback((count: number) => {
    pendingComposerAttachmentsRef.current = count;
  }, []);
  // Unsent attachments stay in the task's draft, but users who never come back leave an
  // empty task behind; ask before switching away from them.
  const confirmLeavingPendingAttachments = useCallback((targetThreadId?: string) => {
    const count = pendingComposerAttachmentsRef.current;
    if (count <= 0) return true;
    const target = String(targetThreadId || "").trim();
    if (target && (target === activeRemoteThreadIdRef.current || target === activeLocalThreadIdRef.current)) return true;
    return window.confirm(tRef.current("thread.leavePendingAttachments", { count: String(count) }));
  }, []);

  const switchToExistingThread = useCallback((
    threadId: string,
    options: { switchToThread?: () => Promise<void> | void; errorFallback: string }
  ) => {
    navigationViewRef.current = "task";
    const normalizedThreadId = threadId.trim();
    return switchToExistingWorkspaceTask(threadSwitchGateRef.current, {
      isActive: Boolean(
        normalizedThreadId &&
          (normalizedThreadId === activeRemoteThreadIdRef.current ||
            normalizedThreadId === activeLocalThreadIdRef.current)
      ),
      unmountThreadView: () => flushSync(() => setThreadSwitchPending(true)),
      switchToThread: async () => {
        await (options.switchToThread ? options.switchToThread() : runtime.threads.switchToThread(normalizedThreadId));
      },
      remountThreadView: () => setThreadSwitchPending(false),
      reportError: (error) => setErrorText(error instanceof Error ? error.message : options.errorFallback)
    });
  }, [runtime]);

  const openWorkspaceTask = useCallback(async (task: PortalWorkspaceTask | { id: string; folder_id?: string | null }) => {
    if (!confirmLeavingPendingAttachments(task.id)) return;
    const folderId = task.folder_id || selectedWorkspaceFolderId;
    if (task.folder_id) setSelectedWorkspaceFolderId(task.folder_id);
    setWorkspaceMainView("task");
    setSelectedWorkspaceFile(null);
    writePortalWorkspaceLocation({ folderId, threadId: task.id }, "push");
    await switchToExistingThread(task.id, { errorFallback: "Failed to open task" });
  }, [confirmLeavingPendingAttachments, selectedWorkspaceFolderId, switchToExistingThread]);

  const attentionThreadsRef = useRef(workspaceThreads);
  attentionThreadsRef.current = workspaceThreads;
  const runAttentionHolder = useRunCompletionAttention({
    enabled: !trainingReadOnly,
    resolveThreadTitle: (threadId) =>
      attentionThreadsRef.current.find((thread) => thread.id === threadId || thread.external_id === threadId)?.title ?? undefined,
    onOpenThread: (threadId) => void openWorkspaceTask({ id: threadId })
  });

  const startWorkspaceTask = useCallback(async () => {
    if (!confirmLeavingPendingAttachments()) return false;
    navigationViewRef.current = "task";
    const folderId = selectedWorkspaceFolderIdRef.current;
    setWorkspaceErrorText("");
    return startWorkspaceTaskInFolder(folderId, {
      prepareForSwitch: () => {
        flushSync(() => {
          setThreadSwitchPending(true);
          syncActiveThreadIdentity({});
          setSelectedWorkspaceFile(null);
          setWorkspaceMainView("folder");
        });
      },
      showTask: () => { setThreadSwitchPending(false); setWorkspaceMainView("task"); },
      showFolder: () => { setThreadSwitchPending(false); setWorkspaceMainView("folder"); },
      writeFolderLocation: (nextFolderId, mode) => {
        writePortalWorkspaceLocation({ folderId: nextFolderId }, mode);
      },
      switchToNewThread: () => runtime.threads.switchToNewThread(),
      reportError: () => setWorkspaceErrorText(t("workspace.createTaskFailed"))
    }, threadSwitchGateRef.current);
  }, [confirmLeavingPendingAttachments, runtime, syncActiveThreadIdentity, t]);

  // The tour points at the composer, which only exists in a task view.
  const prepareOnboardingTour = useCallback(async () => {
    if (tourTarget("steer")) return;
    await startWorkspaceTask();
  }, [startWorkspaceTask]);

  const openWorkspaceFile = useCallback((file: PortalWorkspaceNode) => {
    setSelectedWorkspaceFile(file);
    setRequestedPreviewPath("");
    setRequestedDirectPreview(null);
    writePortalWorkspaceLocation({
      folderId: selectedWorkspaceFolderId,
      threadId: workspaceMainView === "task" ? activeRemoteThreadId || undefined : undefined,
      fileId: file.id,
      query: sessionSearchValue
    }, "push");
    setLayoutState((prev) => openWorkbenchDrawer(prev, "preview"));
  }, [activeRemoteThreadId, selectedWorkspaceFolderId, sessionSearchValue, workspaceMainView]);

  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    // `fromHistory` is false for the initial restore: nothing is mounted yet, and unmounting
    // synchronously is not allowed while React is still committing this effect.
    const restoreFromLocation = (fromHistory: boolean) => {
      const location = readPortalWorkspaceLocation(window.location.search);
      const threadId = readPortalThreadIdFromLocation(window.location.search);
      setSelectedWorkspaceFolderId(location.folderId);
      setSessionSearchValue(location.query);
      setRequestedPreviewPath("");
      const restoreFile = () => {
        if (!location.fileId || location.folderId.startsWith("__")) {
          setSelectedWorkspaceFile(null);
          return;
        }
        void workspaceDataSource.fetchNodes(location.folderId, { includeMigrated: true })
          .then((nodes) => {
            const file = nodes.find((node) => node.id === location.fileId && node.kind === "file");
            setSelectedWorkspaceFile(file || null);
            if (file) setLayoutState((previous) => openWorkbenchDrawer(previous, "preview"));
          })
          .catch(() => setSelectedWorkspaceFile(null));
      };
      if (threadId) {
        setWorkspaceMainView("task");
        setSelectedWorkspaceFile(null);
        if (fromHistory) {
          void switchToExistingThread(threadId, { errorFallback: "Failed to restore task" });
        } else {
          // Initial restore below uses the same serialized navigation queue.
        }
        restoreFile();
        return;
      }
      navigationViewRef.current = "folder";
      threadSwitchGateRef.current.current += 1;
      setThreadSwitchPending(false);
      setWorkspaceMainView("folder");
      restoreFile();
    };
    const handlePopState = () => restoreFromLocation(true);
    window.addEventListener("popstate", handlePopState);
    const initialLocation = readPortalWorkspaceLocation(window.location.search);
    if (initialLocation.fileId || readPortalThreadIdFromLocation(window.location.search)) {
      restoreFromLocation(false);
    }
    return () => window.removeEventListener("popstate", handlePopState);
  }, [runtime, switchToExistingThread, workspaceDataSource]);

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
        const started = await startWorkspaceTask();
        if (!started) return;
        setStatusText(`New chat ready with ${targetSkill.label || targetSkill.name}`);
      },
      async installSkillFromPath(input: { threadId: string; path: string; prompt?: string; conflictAction?: "fork" }) {
        const threadId = input.threadId.trim();
        const skillPath = input.path.trim();
        if (!threadId || !skillPath) return null;
        const response = await installPortalSkillFromThreadPath({
          threadId,
          path: skillPath,
          prompt: input.prompt,
          modeId: runtimeModeRef.current,
          conflictAction: input.conflictAction
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
    [refreshRuntimeOptionsNow, startWorkspaceTask]
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
    void Promise.resolve().then(() => switchToExistingThread(requestedThreadId, { errorFallback: "Failed to restore current session" }))
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
  }, [portalThreadRestoreSettled, switchToExistingThread]);

  useEffect(() => {
    if (!portalThreadRestoreSettled || threadSwitchPending || workspaceMainView !== "task") return;
    replacePortalThreadIdInLocation(activeRemoteThreadId);
  }, [activeRemoteThreadId, portalThreadRestoreSettled, threadSwitchPending, workspaceMainView]);

  const subscriptionAccessContextValue = useMemo(
    () => ({
      status: subscriptionStatus,
      loading: subscriptionStatusLoading,
      errorText: subscriptionStatusError
    }),
    [subscriptionStatus, subscriptionStatusError, subscriptionStatusLoading]
  );
  const blockedSubscriptionStatus = isSubscriptionAccessBlocked(subscriptionStatus) ? subscriptionStatus : null;
  const subscriptionReminderStatus = canUseCustomerBilling && !blockedSubscriptionStatus && shouldShowPortalSubscriptionReminder(subscriptionStatus)
    ? subscriptionStatus
    : null;
  const subscriptionReminderKey = canUseCustomerBilling
    ? portalSubscriptionReminderKey(blockedSubscriptionStatus ?? subscriptionReminderStatus)
    : "";
  const externalInlineErrorText = isExternalPortalUser && !blockedSubscriptionStatus ? errorText : "";

  useEffect(() => {
    if (!canUseCustomerBilling) return;
    if (!subscriptionReminderKey || subscriptionReminderKey === dismissedSubscriptionReminderKey) return;
    setSubscriptionReminderModalOpen(true);
  }, [canUseCustomerBilling, dismissedSubscriptionReminderKey, subscriptionReminderKey]);

  const threadViewKey = `thread-view-${String(
    activeThreadIdentity.localId || activeThreadIdentity.remoteId || "empty"
  )}${trainingReadOnly ? `-${locale}` : ""}`;
  const threadContent = (
    <div
      className={threadReadOnly ? "thread-dropzone thread-dropzone-readonly" : "thread-dropzone"}
      aria-disabled={threadReadOnlyPresentation.contentAriaDisabled || undefined}
      data-read-only={threadReadOnly ? "true" : undefined}
      onClickCapture={handleThreadLinkClickCapture}
    >
      {trainingReadOnly ? (
        <div className="training-readonly-notice" role="status">
          <span>{t("training.readOnlyNotice")}</span>
        </div>
      ) : sharedThreadReadonly ? (
        <div className="thread-readonly-banner" role="status">
          <strong>{t("readonly.title")}</strong>
          <span>{t("readonly.detail")}</span>
        </div>
      ) : null}
      {billingReturnNotice && canUseCustomerBilling ? (
        <PortalBillingReturnBanner
          notice={billingReturnNotice}
          onOpenBilling={openCustomerBillingPanel}
          onDismiss={() => setBillingReturnNotice(null)}
        />
      ) : null}
      {blockedSubscriptionStatus ? (
        <PortalAccessBlockedBanner
          status={blockedSubscriptionStatus}
          onOpenBilling={canUseCustomerBilling ? openCustomerBillingPanel : undefined}
        />
      ) : subscriptionReminderStatus ? (
        <PortalSubscriptionReminderBanner status={subscriptionReminderStatus} onOpenBilling={openCustomerBillingPanel} />
      ) : (
        <PortalInlineErrorBanner message={externalInlineErrorText} />
      )}
      <RunningThreadIdsContext.Provider value={runningThreadIds}>
        <PortalBackgroundRunContext.Provider value={backgroundRunContextValue}>
        <UserInputReadOnlyContext.Provider value={threadReadOnly}>
        <ThreadPublicShareControls
          threadId={activeRemoteThreadId}
          disabled={threadReadOnly}
          skipStatusLookup={trainingReadOnly}
          onStatusChange={setStatusText}
        >
        <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
          <AnswerFeedbackConfigContext.Provider value={answerFeedbackConfig}>
          <ExternalPortalUserContext.Provider value={isExternalPortalUser}>
          <ThreadMutationReadOnlyContext.Provider value={threadReadOnly}>
          <AttachmentWorkspaceFilesContext.Provider
            value={attachmentWorkspaceFilesValue}
          >
          <PreviewRequestContext.Provider value={requestPreviewForPath}>
            <PortalThreadErrorBoundary
              resetKey={threadViewKey}
              autoRetryLimit={1}
              onError={(error, errorInfo) =>
                reportClientError({
                  source: "portal-thread",
                  error,
                  componentStack: errorInfo.componentStack,
                  threadId: activeRemoteThreadId || activeThreadIdentity.localId,
                  locale,
                  context: { running: Boolean(activeRemoteThreadId && runningThreadIds[activeRemoteThreadId]) }
                })
              }
              fallback={({ retry }) => (
                <div className="thread-access-banner thread-access-banner-secondary" role="alert">
                  <div className="thread-access-banner-head">
                    <AlertCircleIcon size={18} aria-hidden="true" />
                    <strong>{t("thread.renderFailed")}</strong>
                  </div>
                  <p>{t("thread.renderFailedHelp")}</p>
                  <div className="thread-access-banner-actions">
                    <Button size="small" type="primary" onClick={retry}>
                      {t("thread.renderRetry")}
                    </Button>
                    <Button
                      size="small"
                      onClick={() => selectWorkspaceFolder(selectedWorkspaceFolderId, selectedWorkspaceFolderName)}
                    >
                      {t("workspace.returnToFolder")}
                    </Button>
                  </div>
                </div>
              )}
            >
            {threadSwitchPending ? (
              <PortalThreadSwitchingPlaceholder label={t("thread.loadingConversation")} />
            ) : (
            <PortalThread
              key={threadViewKey}
              readingPositionKey={`${portalPreferenceUser?.id || "anonymous"}:${String(
                activeThreadIdentity.remoteId || activeThreadIdentity.localId || "empty"
              )}`}
              loadingLabel={t("thread.loadingConversation")}
              positioningLabel={t("thread.positioning")}
              scrollToBottomLabel={t("thread.returnToLatest")}
              strings={{
                threadList: {
                  new: { label: t("sessions.new") },
                  item: {
                    title: { fallback: t("sessions.newConversation") }
                  }
                },
                thread: {
                  scrollToBottom: { tooltip: t("thread.returnToLatest") }
                },
                composer: {
                  input: {
                    placeholder: composerPlaceholder
                  },
                  send: { tooltip: t("thread.send") },
                  cancel: { tooltip: t("thread.stop") },
                  addAttachment: { tooltip: t("thread.attach") },
                  removeAttachment: { tooltip: t("thread.removeAttachment") }
                },
                assistantMessage: {
                  copy: { tooltip: t("thread.copy") },
                  feedback: {
                    positive: { tooltip: t("thread.goodResponse") },
                    negative: { tooltip: t("thread.badResponse") }
                  }
                },
                editComposer: {
                  send: { label: t("thread.saveEdit") },
                  cancel: { label: t("common.cancel") }
                }
              }}
              welcome={{
                message: welcomeMessage,
                suggestions: welcomeSuggestions
              }}
              assistantAvatar={assistantAvatar}
              components={{
                Composer: trainingReadOnly ? ReadOnlyComposer : canUpload ? UploadAwareComposer : MobileAwareComposer,
                UserMessage: AgentUserMessage,
                EditComposer: InlineEditComposer,
                AssistantMessage: AgentAssistantMessage,
                MessagesFooter: PortalSteerEventsFooter,
                ThreadWelcome: DraftOnlyThreadWelcome
              }}
              assistantMessage={{
                allowCopy: true,
                allowReload: false,
                allowFeedbackPositive: !threadReadOnly,
                allowFeedbackNegative: !threadReadOnly,
                components: {
                  ToolFallback: HiddenToolFallback as any
                }
              }}
              userMessage={{ allowEdit: !threadReadOnly }}
            />
            )}
            </PortalThreadErrorBoundary>
          </PreviewRequestContext.Provider>
          </AttachmentWorkspaceFilesContext.Provider>
          </ThreadMutationReadOnlyContext.Provider>
          </ExternalPortalUserContext.Provider>
          </AnswerFeedbackConfigContext.Provider>
        </ActiveThreadIdContext.Provider>
        </ThreadPublicShareControls>
        </UserInputReadOnlyContext.Provider>
        </PortalBackgroundRunContext.Provider>
      </RunningThreadIdsContext.Provider>
      {sharedThreadReadonly && !trainingReadOnly ? (
        <div className="thread-readonly-shield" aria-hidden="true">
          <div className="thread-readonly-card">
            <p>{t("readonly.changed")}</p>
            <p>{t("readonly.browse")}</p>
          </div>
        </div>
      ) : null}
    </div>
  );

  const workspaceRailFooter = props.currentUser ? (
    <AccountMenu
      user={props.currentUser}
      onSignOut={props.onSignOut}
      accessStatus={subscriptionStatus}
      accessStatusLoading={subscriptionStatusLoading}
      accessStatusError={subscriptionStatusError}
      onOpenAccessStatus={() => {
        void refreshPortalSubscriptionStatus();
      }}
      onOpenBilling={canUseCustomerBilling && !trainingReadOnly ? openCustomerBillingPanel : undefined}
      onOpenFeedback={trainingReadOnly ? undefined : openProductFeedbackModal}
      onOpenAdvancedSettings={
        isExternalPortalUser || trainingReadOnly
          ? undefined
          : () => setLayoutState((prev) => ({ ...prev, isAdvancedSettingsOpen: true }))
      }
    />
  ) : (
    <p className="session-rail-user-fallback">{currentUserName}</p>
  );

  const workspaceTaskList = (
    <SessionSearchContext.Provider value={sessionSearchValue}>
      <SessionGroupLabelContext.Provider value={{ groupHeaderByRemoteId: {} }}>
        <RunningThreadIdsContext.Provider value={runningThreadIds}>
          <ThreadCompletionNoticeContext.Provider value={threadCompletionNoticeContext}>
            <ActiveThreadIdContext.Provider value={activeRemoteThreadId}>
              <StableThreadListItems
                visibleRemoteIds={visibleWorkspaceThreadIds}
                orderedRemoteIds={orderedWorkspaceThreadIds}
                onSelectThread={(threadId, switchToThread) => {
                  if (!confirmLeavingPendingAttachments(threadId)) return;
                  setWorkspaceMainView("task");
                  setSelectedWorkspaceFile(null);
                  const thread = workspaceThreads.find((item) => item.id === threadId || item.external_id === threadId);
                  if (thread?.folder_id) setSelectedWorkspaceFolderId(thread.folder_id);
                  void switchToExistingThread(threadId, { switchToThread, errorFallback: "Failed to open task" });
                }}
                readOnly={trainingReadOnly}
              />
            </ActiveThreadIdContext.Provider>
          </ThreadCompletionNoticeContext.Provider>
        </RunningThreadIdsContext.Provider>
      </SessionGroupLabelContext.Provider>
    </SessionSearchContext.Provider>
  );

  const workspaceRail = (
    <WorkspaceRail
      dataSource={workspaceDataSource}
      readOnly={trainingReadOnly}
      title={trainingReadOnly ? t("training.title") : undefined}
      workspace={portalWorkspace}
      rootNodes={workspaceRootNodes}
      selectedFolderPath={selectedWorkspaceFolderPath}
      selectedFolderId={selectedWorkspaceFolderId}
      searchValue={sessionSearchValue}
      runningFolderIds={runningWorkspaceFolderIds}
      unreadFolderIds={unreadWorkspaceFolderIds}
      loading={workspaceLoading}
      errorText={workspaceErrorText}
      taskList={workspaceTaskList}
      taskCount={selectedWorkspaceThreads.length}
      footer={workspaceRailFooter}
      sections={<AutomationRailSection />}
      refreshKey={workspaceRefreshToken}
      onSearchChange={(value) => {
        setSessionSearchValue(value);
        writePortalWorkspaceLocation({
          folderId: selectedWorkspaceFolderId,
          query: value,
          fileId: undefined,
          threadId: undefined
        });
        if (value.trim()) {
          setWorkspaceMainView("folder");
          setSelectedWorkspaceFile(null);
          setRequestedPreviewPath("");
        }
      }}
      onSelectFolder={selectWorkspaceFolder}
      onCreateFolder={() => setCreateRootFolderOpen(true)}
      onNewTask={() => void startWorkspaceTask()}
      onViewAllTasks={() => {
        setWorkspaceMainView("folder");
        setSelectedWorkspaceFile(null);
        setRequestedPreviewPath("");
        writePortalWorkspaceLocation({ folderId: selectedWorkspaceFolderId }, "push");
        if (isMobile) {
          setLayoutState((prev) => ({ ...prev, isSessionRailCollapsed: true }));
        }
      }}
      onFolderChanged={(action, folder) => {
        if (action === "trash" && selectedWorkspaceFolderPath.some((item) => item.id === folder.id)) {
          setSelectedWorkspaceFolderId(RECENT_WORKSPACE_VIEW);
          setSelectedWorkspaceFolderPath([]);
          setWorkspaceMainView("folder");
          writePortalWorkspaceLocation({ folderId: RECENT_WORKSPACE_VIEW }, "replace");
        }
        setWorkspaceRefreshToken((value) => value + 1);
      }}
    />
  );

  const workspaceCenterContent =
    workspaceMainView === "folder" ? (
      <WorkspaceFolderHome
        dataSource={workspaceDataSource}
        readOnly={trainingReadOnly}
        key={`${selectedWorkspaceFolderId}-${workspaceRefreshToken}`}
        folderId={selectedWorkspaceFolderId}
        folderName={selectedWorkspaceFolderName}
        folderSystemKey={selectedWorkspaceFolder?.system_key}
        folderPath={selectedWorkspaceFolderPath}
        activeThreadId={activeRemoteThreadId || undefined}
        searchQuery={sessionSearchValue}
        rootFolders={workspaceRootNodes}
        onOpenFolder={(folder) => selectWorkspaceFolder(folder.id, folder.name)}
        onOpenFile={openWorkspaceFile}
        onOpenTask={(task) => void openWorkspaceTask(task)}
        onNewTask={() => void startWorkspaceTask()}
        onWorkspaceChanged={() => setWorkspaceRefreshToken((value) => value + 1)}
      />
    ) : (
      <div className="workspace-task-shell">
        <div className="workspace-task-breadcrumb" aria-label={t("workspace.taskLocation")}>
          <button
            type="button"
            className="workspace-task-folder-link"
            onClick={() => selectWorkspaceFolder(selectedWorkspaceFolderId, selectedWorkspaceFolderName)}
          >
            <Folder size={15} />
            <span>{selectedWorkspaceFolderName}</span>
          </button>
          <ChevronRight size={14} />
          <strong title={workspaceThreads.find((thread) => thread.id === activeRemoteThreadId)?.title || t("workspace.newTask")}>
            {workspaceThreads.find((thread) => thread.id === activeRemoteThreadId)?.title ||
              t("workspace.newTask")}
          </strong>
          <span className="workspace-task-breadcrumb-actions" ref={setThreadHeaderActionsSlot} />
        </div>
        <div className="thread-wrap">
          <ThreadHeaderActionsSlotContext.Provider value={threadHeaderActionsSlot}>
            {canUpload && !threadReadOnly ? (
              <ComposerPrimitive.AttachmentDropzone asChild>{threadContent}</ComposerPrimitive.AttachmentDropzone>
            ) : (
              threadContent
            )}
          </ThreadHeaderActionsSlotContext.Provider>
        </div>
      </div>
    );

  const workspacePreviewPanel =
    workspaceMainView === "task" && activeRemoteThreadId && !selectedWorkspaceFile && !requestedPreviewPath ? (
      <WorkspaceTaskFilesPanel
        threadId={activeRemoteThreadId}
        onOpenFile={openWorkspaceFile}
        dataSource={workspaceDataSource}
      />
    ) : (
      <PreviewWorkbenchPanel
        workspaceApiBasePath={workspaceDataSource.apiBasePath}
        workspaceFileReadOnly={trainingReadOnly}
        threadId={activeRemoteThreadId}
        requestedFilePath={selectedWorkspaceFile ? undefined : requestedPreviewPath}
        requestedContentUrl={selectedWorkspaceFile ? undefined : requestedDirectPreview?.contentUrl}
        requestedDownloadUrl={selectedWorkspaceFile ? undefined : requestedDirectPreview?.downloadUrl}
        requestedFileName={selectedWorkspaceFile ? undefined : requestedDirectPreview?.displayName}
        requestedFileMimeType={selectedWorkspaceFile ? undefined : requestedDirectPreview?.mimeType}
        requestNonce={previewRequestNonce}
        allowDownload
        externalArtifactMode={isExternalPortalUser && !selectedWorkspaceFile}
        workspaceFileId={selectedWorkspaceFile?.id}
        workspaceFileName={selectedWorkspaceFile?.name}
        workspaceFileMimeType={selectedWorkspaceFile?.mime_type || undefined}
      />
    );



  return (
    <LocalWorkspaceContext.Provider value={{ ...localWorkspace, showEntry: showLocalBridgeEntry, running: Boolean(runningThreadIds[activeRemoteThreadId]) }}>
    <AgentRuntimeAdapterSettingsContext.Provider value={runtimeAdapterSettings}>
    <ComposerPendingAttachmentsContext.Provider value={setPendingComposerAttachments}>
    <AssistantRuntimeProvider runtime={runtime}>
      <PortalComposerWorkflowProvider value={composerWorkflowController.contextValue}>
      <PortalChatRecoveryContext.Provider value={portalChatRecoveryContextValue}>
      <PortalRunCancelContext.Provider value={requestPortalRunCancel}>
      <PortalSubscriptionAccessContext.Provider value={subscriptionAccessContextValue}>
      <RuntimeReadinessContext.Provider value={runtimeReadinessContextValue}>
      <SkillComposerContext.Provider value={skillComposerContext}>
      <SkillDraftActionContext.Provider value={skillDraftActionContext}>
        <ActiveThreadIdentityBridge onChange={syncActiveThreadIdentity} />
        {!trainingReadOnly ? <ComposerActivationGuard runtime={runtime} /> : null}
        <ThreadRuntimeSubscriptionBridge runtime={runtime} />
        <BuildVersionRefreshActivityBridge hasRunningSessions={hasRunningSessions} />
        <RunningStageTextContext.Provider value={runningStageContextValue}>
        <ProcessTracePreferencesContext.Provider value={processTracePreferences}>
        <MobileWorkbenchContext.Provider value={isMobile}>
          <ConfigProvider theme={portalAntdTheme} locale={antdLocale}>
          <HomeProfileProvider enabled={!isExternalPortalUser && !trainingReadOnly} userId={portalPreferenceUser?.id}>
          <PortalRoadmapProvider
            personalFeaturesEnabled={!isExternalPortalUser && !trainingReadOnly}
            usageEnabled={!isExternalPortalUser && !trainingReadOnly && Boolean(portalPreferenceUser?.id)}
            tourEnabled={!isExternalPortalUser && !trainingReadOnly}
            onboardingCompletedAt={portalPreferenceUser?.portalPreferences?.onboardingCompletedAt}
            userLoaded={Boolean(portalPreferenceUser?.id)}
            theme={portalThemeApi}
            scheduledTaskContext={scheduledTaskContext}
            modeLabel={roadmapModeLabel}
            onOpenThread={(threadId) => void openWorkspaceTask({ id: threadId })}
            prepareTour={prepareOnboardingTour}
            initialView={
              typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "scheduled-tasks"
                ? "scheduled-tasks"
                : null
            }
          >
            {runAttentionHolder}
            <div className={`portal-workbench-root${trainingReadOnly ? " is-training-readonly" : ""}`}>
              <PortalTopBar
                sessionRailCollapsed={layoutState.isSessionRailCollapsed}
                onToggleRail={toggleRail}
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
                onOpenAdmin={trainingReadOnly ? undefined : props.onOpenAdmin}
                onOpenFeedback={trainingReadOnly ? undefined : openProductFeedbackModal}
                onOpenBilling={canUseCustomerBilling ? openCustomerBillingPanel : undefined}
                runtimeSummary={topbarRuntimeSummaryText}
                showRuntimeSummary={!isExternalPortalUser && !trainingReadOnly}
                showAdvancedSettings={!isExternalPortalUser && !trainingReadOnly}
                showRightPanelToggle={!isExternalPortalUser}
                drawerOpen={layoutState.isRightDrawerOpen}
                mobile={isMobile}
                trainingMode={trainingReadOnly}
                onOpenTraining={props.onOpenTraining}
                onExitTraining={props.onExitTraining}
              />
              <LocalWorkspaceDialogs />

              <div className="portal-workbench-body">
                {isMobile ? (
                  <div className="mobile-workbench-layout">
                    <Drawer
                      placement="left"
                      title={portalWorkspace?.name || t("workspace.mine")}
                      open={!layoutState.isSessionRailCollapsed}
                      width="100%"
                      styles={{ header: { padding: "12px 16px" }, body: { padding: 0 } }}
                      closable
                      closeIcon={<ChevronLeft size={22} />}
                      push={false}
                      rootClassName="workbench-mobile-session-drawer"
                      onClose={() => setLayoutState((prev) => ({ ...prev, isSessionRailCollapsed: true }))}
                    >
                      <ThreadList.Root>{workspaceRail}</ThreadList.Root>
                    </Drawer>

                    <main className="portal-workbench-chat flex-1" style={{ minHeight: 0 }}>
                      {workspaceCenterContent}
                    </main>

                    {layoutState.isRightDrawerOpen && (!isExternalPortalUser || requestedPreviewPath || selectedWorkspaceFile) && (
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
                          previewContent={workspacePreviewPanel}
                          mobile
                        />
                      </Drawer>
                    )}
                  </div>
                ) : (
                  <>
                    <PanelGroup orientation="horizontal" className="portal-workbench-layout">
                      {!layoutState.isSessionRailCollapsed && (
                        <>
                          <Panel defaultSize="20" minSize="15" maxSize="30" collapsible>
                            <ThreadList.Root>{workspaceRail}</ThreadList.Root>
                          </Panel>
                          <PanelResizeHandle className="Resizer" />
                        </>
                      )}

                      <Panel minSize="30">
                        <main className="portal-workbench-chat">
                          {workspaceCenterContent}
                        </main>
                      </Panel>

                      {!isCompactDesktop &&
                        layoutState.isRightDrawerOpen &&
                        (!isExternalPortalUser || requestedPreviewPath || selectedWorkspaceFile) && (
                          <>
                            <PanelResizeHandle className="Resizer" />
                            <Panel defaultSize="25" minSize="20" maxSize="40" className="right-drawer-panel">
                              <RightWorkbenchDrawer
                                open={layoutState.isRightDrawerOpen}
                                onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                                previewContent={workspacePreviewPanel}
                              />
                            </Panel>
                          </>
                        )}
                    </PanelGroup>

                    {isCompactDesktop &&
                      layoutState.isRightDrawerOpen &&
                      (!isExternalPortalUser || requestedPreviewPath || selectedWorkspaceFile) && (
                        <Drawer
                          placement="right"
                          open={layoutState.isRightDrawerOpen}
                          width={440}
                          styles={{ body: { padding: 0 } }}
                          closable={false}
                          push={false}
                          rootClassName="workbench-compact-right-drawer"
                          onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                        >
                          <RightWorkbenchDrawer
                            open={layoutState.isRightDrawerOpen}
                            onClose={() => setLayoutState((prev) => closeWorkbenchDrawer(prev))}
                            previewContent={workspacePreviewPanel}
                          />
                        </Drawer>
                      )}
                  </>
              )}
            </div>

            {!trainingReadOnly ? (
              <CreateWorkspaceFolderModal
                open={createRootFolderOpen}
                onCancel={() => setCreateRootFolderOpen(false)}
                onCreate={createRootWorkspaceFolder}
              />
            ) : null}
            <Modal
              open={productFeedbackOpen}
              title={t("feedback.title")}
              className="product-feedback-modal"
              okText={productFeedbackSubmitted ? t("feedback.submitted") : t("thread.feedbackSubmit")}
              cancelText={t("common.cancel")}
              okButtonProps={{
                disabled: !productFeedbackDescription.trim() || productFeedbackSubmitted,
                loading: productFeedbackSubmitting
              }}
              onOk={() => void submitProductFeedback()}
              onCancel={closeProductFeedbackModal}
              destroyOnHidden
            >
              <p className="product-feedback-modal-help">
                {t("feedback.help", { platform: branding.platformName })}
              </p>
              <label className="field product-feedback-field">
                <span className="field-label">{t("feedback.type")}</span>
                <select
                  className="field-input"
                  value={productFeedbackType}
                  onChange={(event) => setProductFeedbackType(event.target.value as ProductFeedbackType)}
                  disabled={productFeedbackSubmitting}
                >
                  {PRODUCT_FEEDBACK_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {productFeedbackTypeLabel(option.value)}
                    </option>
                  ))}
                </select>
              </label>
              {productFeedbackType === "bug" ? (
                <label className="field product-feedback-field">
                  <span className="field-label">{t("feedback.impact")}</span>
                  <select
                    className="field-input"
                    value={productFeedbackSeverity}
                    onChange={(event) => setProductFeedbackSeverity(event.target.value as ProductFeedbackSeverity)}
                    disabled={productFeedbackSubmitting}
                  >
                    {PRODUCT_FEEDBACK_SEVERITY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {productFeedbackSeverityLabel(option.value)}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="field product-feedback-field">
                <span className="field-label">{t("feedback.details")}</span>
                <Input.TextArea
                  value={productFeedbackDescription}
                  onChange={(event) => setProductFeedbackDescription(event.target.value)}
                  placeholder={t("feedback.detailsPlaceholder")}
                  rows={5}
                  maxLength={4000}
                  showCount
                  disabled={productFeedbackSubmitting}
                />
              </label>
              <div className="product-feedback-field">
                <span className="field-label">{t("feedback.screenshots")}</span>
                <div className="product-feedback-upload-row">
                  <button
                    type="button"
                    className="product-feedback-upload-button"
                    onClick={() => productFeedbackImageInputRef.current?.click()}
                    disabled={productFeedbackSubmitting || productFeedbackImages.length >= PRODUCT_FEEDBACK_MAX_IMAGES}
                  >
                    <ImageIcon size={16} />
                    <span>{t("feedback.addImage")}</span>
                  </button>
                  <span className="product-feedback-upload-hint">
                    {t("feedback.imageLimit", { count: PRODUCT_FEEDBACK_MAX_IMAGES, size: formatFileSize(PRODUCT_FEEDBACK_MAX_IMAGE_BYTES) })}
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
                          aria-label={t("feedback.previewImage", { name: image.file.name || t("feedback.screenshot") })}
                        >
                          <img src={image.previewUrl} alt={image.file.name || "Feedback screenshot"} />
                        </button>
                        <div className="product-feedback-image-meta">
                          <span>{image.file.name || t("feedback.screenshot")}</span>
                          <small>{formatFileSize(image.file.size)}</small>
                        </div>
                        <button
                          type="button"
                          className="product-feedback-image-remove"
                          title={t("feedback.removeImage")}
                          aria-label={t("feedback.removeImage")}
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
                <span>{t("feedback.includeContext")}</span>
              </label>
              {productFeedbackError ? <p className="product-feedback-error">{productFeedbackError}</p> : null}
              {productFeedbackSubmitted ? <p className="product-feedback-success">{t("feedback.success")}</p> : null}
            </Modal>
            <Modal
              open={Boolean(productFeedbackPreviewImage)}
              title={productFeedbackPreviewImage?.file.name || t("feedback.previewTitle")}
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

            {canUseCustomerBilling ? (
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
            ) : null}

            {canUseCustomerBilling ? (
              <Modal
                open={subscriptionReminderModalOpen}
                title={blockedSubscriptionStatus ? t("access.expired") : t("access.renewPlatform", { platform: branding.platformName.trim() || "Workspace" })}
                okText={blockedSubscriptionStatus ? t("access.renewNow") : t("access.chooseRenewal")}
                cancelText={t("access.later")}
                onOk={() => {
                  setSubscriptionReminderModalOpen(false);
                  openCustomerBillingPanel();
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
                    <p>{t("access.expiresAt", { date: new Date((blockedSubscriptionStatus ?? subscriptionReminderStatus)!.expiresAt!).toLocaleString(intlLocale) })}</p>
                  ) : null}
                  <p>{t("access.planHelp")}</p>
                </div>
              </Modal>
            ) : null}

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
                      <p className="field-help knowledge-set-loading">{t("settings.knowledgeLoading")}</p>
                    )}
                    {resourceErrorText ? <p className="err-text knowledge-set-error">{resourceErrorText}</p> : null}
                  </div>

                  <label className="field checkbox-field">
                    <span className="field-label">{t("settings.showTrace")}</span>
                    <input
                      type="checkbox"
                      checked={effectiveShowProcessTrace}
                      onChange={(e) => void handleShowProcessTraceChange(e.target.checked)}
                      disabled={portalPreferenceSaving}
                    />
                    <span className="field-help">{t("settings.showTraceHelp")}</span>
                  </label>

                  <label className="field checkbox-field">
                    <span className="field-label">{t("settings.collapseTrace")}</span>
                    <input
                      type="checkbox"
                      checked={collapseFinalTraceOnDone}
                      onChange={(e) => void handleCollapseFinalTraceOnDoneChange(e.target.checked)}
                      disabled={!effectiveShowProcessTrace || portalPreferenceSaving}
                    />
                    <span className="field-help">{t("settings.collapseTraceHelp")}</span>
                  </label>

                  {portalPreferenceErrorText ? <p className="err-text">{portalPreferenceErrorText}</p> : null}

                  <label className="field">
                    <span className="field-label">{t("settings.policyMode")}</span>
                    <select
                      className="field-input"
                      value={runtimeMode}
                      onChange={(e) => {
                        runtimeModeOverrideRef.current = {
                          threadId: String(activeRemoteThreadIdRef.current || "").trim(),
                          modeId: e.target.value
                        };
                        setRuntimeMode(e.target.value);
                      }}
                      disabled={!runtimeOptions}
                    >
                      {modeOptions.map((mode) => (
                        <option key={mode.id} value={mode.id}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                    <span className="field-help">{t("settings.policyModeHelp")}</span>
                  </label>

                  {selectedMode ? (
                    <div className="field">
                      <span className="field-label">{t("settings.policySnapshot")}</span>
                      <RuntimeProfileView profile={selectedMode.runtimeProfile} />
                      <span className="field-help">{t("settings.policySnapshotHelp")}</span>
                    </div>
                  ) : null}

                  <div className="status-box">
                    <p>
                      <strong>{t("settings.status")} </strong>
                      {statusText}
                    </p>
                    <p>
                      <strong>{t("settings.attachmentPolicy")} </strong>
                      {runtimeOptions?.canUpload ? t("settings.uploadAllowed") : t("settings.uploadDisabled")}
                    </p>
                    <p className="field-help">{t("settings.nextTurn")}</p>
                    {errorText ? <p className="err-text">{errorText}</p> : null}
                  </div>
                </div>
              </AdvancedSettingsPanel>
            ) : null}
          </div>
          </PortalRoadmapProvider>
          </HomeProfileProvider>
        </ConfigProvider>
        {pickerOpen ? (
          <div className="dir-modal-mask" onClick={() => setPickerOpen(false)}>
            <div className="dir-modal" onClick={(e) => e.stopPropagation()}>
            <div className="dir-modal-head">
              <h3>{pickerTarget === "workspace" ? t("directory.workspace") : t("directory.additional")}</h3>
              <button type="button" className="picker-btn" onClick={() => setPickerOpen(false)}>
                {t("common.close")}
              </button>
            </div>
            <div className="dir-path-input-row">
              <input
                className="field-input dir-path-input"
                value={pickerPathInput}
                onChange={(e) => onPickerPathInputChange(e.target.value)}
                onKeyDown={onPickerPathInputKeyDown}
                placeholder={t("directory.placeholder")}
              />
              <button
                type="button"
                className="picker-btn"
                onClick={jumpToDirectoryFromInput}
                disabled={pickerLoading}
              >
                {t("directory.jump")}
              </button>
            </div>
            <p className="dir-modal-current">{t("directory.current", { path: pickerCwd || "…" })}</p>
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
                {t("directory.up")}
              </button>
              <button
                type="button"
                className="picker-btn"
                onClick={() => selectDirectory(pickerCwd)}
                disabled={!pickerCwd || pickerLoading}
              >
                {pickerTarget === "workspace" ? t("directory.setWorkspace") : t("directory.addCurrent")}
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
              {pickerLoading ? <p className="trace-empty">{t("directory.loading")}</p> : null}
              {!pickerLoading && pickerDirectories.length === 0 ? (
                <p className="trace-empty">{t("directory.empty")}</p>
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
                        {t("directory.select")}
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
        </ProcessTracePreferencesContext.Provider>
        </RunningStageTextContext.Provider>
      </SkillDraftActionContext.Provider>
      </SkillComposerContext.Provider>
      </RuntimeReadinessContext.Provider>
      </PortalSubscriptionAccessContext.Provider>
      </PortalRunCancelContext.Provider>
      </PortalChatRecoveryContext.Provider>
      </PortalComposerWorkflowProvider>
    </AssistantRuntimeProvider>
    </ComposerPendingAttachmentsContext.Provider>
    </AgentRuntimeAdapterSettingsContext.Provider>
    </LocalWorkspaceContext.Provider>
  );
}

export default PortalShell;
