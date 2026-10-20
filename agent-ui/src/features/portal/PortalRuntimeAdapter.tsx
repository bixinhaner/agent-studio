import { createContext, type FC, type PropsWithChildren, useContext, useEffect, useMemo, useRef } from "react";
import { RuntimeAdapterProvider, type ThreadMessage, useAui } from "@assistant-ui/react";
import { pendingServerThreads } from "./pending-server-threads";
import {
  CompositeAttachmentAdapter,
  type ExportedMessageRepository,
  type ExportedMessageRepositoryItem,
  type ThreadHistoryAdapter
} from "@assistant-ui/core";
import { useAuiState } from "@assistant-ui/store";
import { api } from "../../lib/api";
import { reportAutoRefreshActivityState } from "../../lib/build-version-refresh";
import { asRecord } from "./portal-value-utils";
import { type ThreadFeedbackOut, type ThreadMessagesOut } from "./portal-api-types";
import { type ThreadIdentity } from "./portal-types";
import { guessThreadTitleFromText, isPlaceholderThreadTitle, userTextFromUnknownMessage } from "./thread-title";
import { applyStoredFeedback, reviveMessage, sanitizeMessageForPersistence } from "./thread-message-persistence";
import {
  FeedbackCommentDraftContext,
  type FeedbackCommentDraftStore,
  feedbackCommentKey,
  feedbackCommentMemory
} from "./portal-contexts";
import { WorkspaceFileAttachmentAdapter } from "./UploadAwareAttachment";
import { messageTextForSuggestions } from "./PortalMessages";

export const BuildVersionRefreshActivityBridge: FC<{ hasRunningSessions: boolean }> = ({ hasRunningSessions }) => {
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

export const ComposerActivationGuard: FC<{ runtime: unknown }> = ({ runtime }) => {
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

export const ThreadRuntimeSubscriptionBridge: FC<{ runtime: unknown }> = ({ runtime }) => {
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

export const ActiveThreadIdentityBridge: FC<{ onChange: (identity: ThreadIdentity) => void }> = ({ onChange }) => {
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

export function threadMessagesOutToRepository(out: ThreadMessagesOut): ExportedMessageRepository {
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
  return {
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
}

export type AgentRuntimeAdapterSettings = {
  canUpload: boolean;
  trainingReadOnly: boolean;
  locale: "en" | "zh-CN";
  onThreadIdentityChange?: (identity: ThreadIdentity) => void;
};

export const AgentRuntimeAdapterSettingsContext = createContext<AgentRuntimeAdapterSettings>({
  canUpload: false,
  trainingReadOnly: false,
  locale: "zh-CN"
});

// The thread list adapter's `unstable_Provider` must keep one component identity: assistant-ui
// rebuilds every thread runtime when that type changes, which empties the messages while the
// message views are still mounted (`tapClientLookup: Index N out of bounds`). Settings that can
// change at runtime (locale, upload permission) are read from context instead.
export const AgentRuntimeAdapterBridge: FC<PropsWithChildren> = ({ children }) => {
  const settings = useContext(AgentRuntimeAdapterSettingsContext);
  return (
    <AgentRuntimeAdapterProvider
      // Training transcripts are localized server-side, so a language switch reloads them; the
      // thread view is keyed by the same locale so it remounts instead of reading stale messages.
      key={settings.trainingReadOnly ? settings.locale : "portal"}
      canUpload={settings.canUpload}
      onThreadIdentityChange={settings.onThreadIdentityChange}
      trainingReadOnly={settings.trainingReadOnly}
      locale={settings.locale}
    >
      {children}
    </AgentRuntimeAdapterProvider>
  );
};

export const AgentRuntimeAdapterProvider: FC<
  PropsWithChildren<{
    onThreadIdentityChange?: (identity: ThreadIdentity) => void;
    canUpload?: boolean;
    trainingReadOnly?: boolean;
    locale?: "en" | "zh-CN";
  }>
> = ({ children, onThreadIdentityChange, canUpload = true, trainingReadOnly = false, locale = "zh-CN" }) => {
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
        const out = await api<ThreadMessagesOut>(
          trainingReadOnly
            ? `/api/portal/training/threads/${encodeURIComponent(remoteId)}/messages${locale === "en" ? "?lang=en" : ""}`
            : `/api/threads/${encodeURIComponent(remoteId)}/messages`
        );
        return threadMessagesOutToRepository(out);
      },
      async append(item: ExportedMessageRepositoryItem) {
        const init = await aui.threadListItem().initialize();
        const remoteId = init.remoteId;
        const state = aui.threadListItem().getState();
        const messageForPersistence = sanitizeMessageForPersistence(item.message);
        const messageRole = asRecord(messageForPersistence)?.role;
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
        // User messages are persisted before the runtime starts. Assistant
        // messages are live browser projections; the API persists the final
        // authoritative snapshot so a late history callback cannot overwrite it.
        return;
      }
    }),
    [aui, locale, trainingReadOnly]
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
              const remoteId = current || String((await item.initialize()).remoteId || item.getState().remoteId || "").trim();
              // Uploads are stored under the task, so a new task is created on the server first.
              await pendingServerThreads.ensureCreated(remoteId);
              return remoteId;
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
