import { createContext, type MutableRefObject } from "react";
import { apiBase } from "../../lib/api";
import { type PortalRuntimeOptions } from "../modes/types";
import { type PortalSubscriptionStatus } from "./api";
import { type CodexManagedSkill } from "../skills/types";
import { type PortalWorkspaceNode } from "./workspace";
import {
  type RunningThreadIdsContextValue,
  type RuntimeSkillOption,
  type SessionGroupLabelContextValue,
  type ThreadCompletionNoticeContextValue
} from "./portal-types";
import { DEFAULT_RUNNING_STAGE_CONTEXT_VALUE, type RunningStageContextValue } from "./portal-constants";

export const RunningStageTextContext = createContext<RunningStageContextValue>(DEFAULT_RUNNING_STAGE_CONTEXT_VALUE);
/** Breadcrumb slot for thread-level actions (share), so they never float over messages. */
export const ThreadHeaderActionsSlotContext = createContext<HTMLElement | null>(null);
export const SessionSearchContext = createContext("");
export const MobileWorkbenchContext = createContext(false);
export const SkillComposerContext = createContext<{
  availableSkills: RuntimeSkillOption[];
  automaticSkills: RuntimeSkillOption[];
  enabledSkillIds: string[];
  recentSkillIds: string[];
  setSkills: (skillIds: string[]) => Promise<void> | void;
  ready: boolean;
  busy: boolean;
}>({
  availableSkills: [],
  automaticSkills: [],
  enabledSkillIds: [],
  recentSkillIds: [],
  setSkills: () => undefined,
  ready: true,
  busy: false
});
export type PortalActiveRun = {
  sessionId: string;
  runId: string;
  threadId: string;
  userMessageId?: string;
};

export function createPortalRunId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `portal-${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
}
export const PortalRunCancelContext = createContext<() => void>(() => undefined);
export const SkillDraftActionContext = createContext<{
  openNewSessionWithSkill: (input: { skillName: string; managedSkillId?: string }) => Promise<void> | void;
  refreshRuntimeOptions: () => Promise<PortalRuntimeOptions | null>;
  installSkillFromPath: (input: {
    threadId: string;
    path: string;
    prompt?: string;
    conflictAction?: "fork";
  }) => Promise<CodexManagedSkill | null>;
  uninstallSkill: (input: { skillId: string }) => Promise<CodexManagedSkill | null>;
}>({
  openNewSessionWithSkill: async () => undefined,
  refreshRuntimeOptions: async () => null,
  installSkillFromPath: async () => null,
  uninstallSkill: async () => null
});
export const SessionGroupLabelContext = createContext<SessionGroupLabelContextValue>({
  groupHeaderByRemoteId: {}
});
export const RunningThreadIdsContext = createContext<RunningThreadIdsContextValue>({});
export const ThreadCompletionNoticeContext = createContext<ThreadCompletionNoticeContextValue>({
  completedThreadIds: {},
  clearCompletedThreadNotice: () => undefined
});
export const ActiveThreadIdContext = createContext("");
export type AnswerFeedbackUiConfig = {
  enabled: boolean;
  prompt: string;
};
export const AnswerFeedbackConfigContext = createContext<AnswerFeedbackUiConfig>({
  enabled: false,
  prompt: "Was this answer helpful?"
});
export type PreviewRequestOptions = {
  contentUrl?: string;
  downloadUrl?: string;
  displayName?: string;
  mimeType?: string;
};
export const PreviewRequestContext = createContext<(
  filePath: string,
  options?: PreviewRequestOptions
) => void>(() => undefined);
export const ExternalPortalUserContext = createContext(false);
export const ThreadMutationReadOnlyContext = createContext(false);
export type AttachmentWorkspaceFilesContextValue = {
  apiBasePath: string;
  files: PortalWorkspaceNode[];
};
export const AttachmentWorkspaceFilesContext = createContext<AttachmentWorkspaceFilesContextValue | null>(null);
export function workspaceFilePreviewOptions(
  context: AttachmentWorkspaceFilesContextValue | null,
  displayName: string
): PreviewRequestOptions | undefined {
  const normalizedName = displayName.trim();
  if (!context || !normalizedName) return undefined;
  const workspaceFile = context.files.find((file) => file.name === normalizedName);
  if (!workspaceFile) return undefined;
  const contentUrl = `${apiBase()}${context.apiBasePath}/files/${encodeURIComponent(workspaceFile.id)}/content`;
  return {
    contentUrl,
    downloadUrl: `${contentUrl}?disposition=attachment`,
    displayName: workspaceFile.name,
    mimeType: workspaceFile.mime_type || undefined
  };
}
export const PortalSubscriptionAccessContext = createContext<{
  status: PortalSubscriptionStatus | null;
  loading: boolean;
  errorText: string;
}>({
  status: null,
  loading: false,
  errorText: ""
});
export type RuntimeReadinessStatus = "loading" | "ready" | "error" | "unavailable";
export type RuntimeReadinessContextValue = {
  status: RuntimeReadinessStatus;
  notice: string;
  retry: () => Promise<PortalRuntimeOptions | null>;
};
export const RuntimeReadinessContext = createContext<RuntimeReadinessContextValue>({
  status: "ready",
  notice: "",
  retry: async () => null
});
export type FeedbackCommentDraftStore = {
  commentsByMessageId: Map<string, string>;
  skipNextSubmit?: {
    messageId: string;
    type: "positive" | "negative";
  };
};
export const FeedbackCommentDraftContext = createContext<MutableRefObject<FeedbackCommentDraftStore> | null>(null);
export const feedbackCommentMemory = new Map<string, string>();

export function feedbackCommentKey(threadId: string, messageId: string): string {
  return `${threadId}::${messageId}`;
}
export type ThreadPublicShareSelectionContextValue = {
  selectionMode: boolean;
  leadTurnIdByMessageId: Record<string, string>;
  selectedTurnIds: Set<string>;
  toggleTurnSelection: (turnId: string) => void;
};
export const ThreadPublicShareSelectionContext = createContext<ThreadPublicShareSelectionContextValue>({
  selectionMode: false,
  leadTurnIdByMessageId: {},
  selectedTurnIds: new Set<string>(),
  toggleTurnSelection: () => undefined
});

export type MessageEntryAnimationContextValue = {
  enteringMessageIds: Set<string>;
};

export const MessageEntryAnimationContext = createContext<MessageEntryAnimationContextValue>({
  enteringMessageIds: new Set<string>()
});

/** Lets the shell warn before leaving a task whose composer still holds unsent attachments. */
export const ComposerPendingAttachmentsContext = createContext<(count: number) => void>(() => undefined);

export type ProcessTracePreferences = { showRawDetail: boolean; collapseOnDone: boolean };
export const ProcessTracePreferencesContext = createContext<ProcessTracePreferences>({ showRawDetail: false, collapseOnDone: true });

export type PortalChatRecoveryState = {
  active: boolean;
};

export const PortalChatRecoveryContext = createContext<PortalChatRecoveryState>({ active: false });
