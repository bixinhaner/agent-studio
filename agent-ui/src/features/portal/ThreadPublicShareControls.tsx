import { type FC, type PropsWithChildren, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Share2Icon, Trash2Icon, XIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/store";
import {
  createThreadPublicShare,
  fetchThreadPublicShareStatus,
  resolveThreadPublicShareUrl,
  revokeThreadPublicShare
} from "../public-share/api";
import { type ThreadPublicShareStatus } from "../public-share/types";
import { pendingServerThreads } from "./pending-server-threads";
import { groupThreadMessagesIntoPublicShareTurns } from "../public-share/turns";
import { usePortalI18n } from "./i18n";
import { formatUserLocalDateTime } from "./portal-formatting";
import {
  MessageEntryAnimationContext,
  type MessageEntryAnimationContextValue,
  ThreadHeaderActionsSlotContext,
  ThreadPublicShareSelectionContext,
  type ThreadPublicShareSelectionContextValue
} from "./portal-contexts";
import { copyTextToClipboard, portalIntoSlot } from "./portal-dom";
import { ThreadQuestionNavigator } from "./ThreadQuestionNavigator";

export const ThreadPublicShareControls: FC<
  PropsWithChildren<{
    threadId: string;
    disabled: boolean;
    skipStatusLookup?: boolean;
    onStatusChange?: (text: string) => void;
  }>
> = ({ threadId, disabled, skipStatusLookup = false, onStatusChange, children }) => {
  const { t } = usePortalI18n();
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
  const [activeShare, setActiveShare] = useState<ThreadPublicShareStatus | null>(null);

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
    let cancelled = false;
    setActiveShare(null);
    // A new task the server has not created yet has no share.
    if (!threadId || skipStatusLookup || pendingServerThreads.has(threadId)) return;
    void fetchThreadPublicShareStatus(threadId)
      .then((share) => {
        if (!cancelled) setActiveShare(share);
      })
      .catch(() => {
        if (!cancelled) setActiveShare(null);
      });
    return () => {
      cancelled = true;
    };
  }, [skipStatusLookup, threadId]);

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
      setActiveShare({
        id: share.id,
        title: share.title,
        selected_turn_count: share.selected_turn_count,
        public_path: share.public_path,
        expires_at: share.expires_at,
        created_at: share.created_at,
        updated_at: share.updated_at
      });
      onStatusChange?.(t("share.createdCopied"));
      cancelSelectionMode();
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("share.failed"));
    } finally {
      setSubmitting(false);
    }
  };

  const revokePublicLink = async () => {
    if (!threadId || !activeShare || submitting) return;
    if (!window.confirm(t("share.revokeConfirm"))) return;
    setSubmitting(true);
    try {
      await revokeThreadPublicShare(threadId);
      setActiveShare(null);
      onStatusChange?.(t("share.revoked"));
    } catch (error) {
      onStatusChange?.(error instanceof Error ? error.message : t("share.revokeFailed"));
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
  const threadHeaderActionsSlot = useContext(ThreadHeaderActionsSlotContext);

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
            portalIntoSlot(threadHeaderActionsSlot, <div className={`thread-public-share-toolbar${threadHeaderActionsSlot ? " is-in-header" : ""}`}>
              <button
                type="button"
                className="thread-public-share-toolbar-btn"
                onClick={enterSelectionMode}
                disabled={shareActionDisabled}
                title={threadRunning ? t("share.running") : t("share.create")}
              >
                <Share2Icon size={16} />
                <span>{t("share.create")}</span>
              </button>
              {activeShare ? (
                <button
                  type="button"
                  className="thread-public-share-toolbar-btn thread-public-share-toolbar-btn-danger"
                  onClick={() => void revokePublicLink()}
                  disabled={submitting}
                  title={t("share.revokeWithExpiry", { date: formatUserLocalDateTime(activeShare.expires_at) })}
                  aria-label={t("share.revoke")}
                >
                  <Trash2Icon size={16} />
                  <span>{t("share.revoke")}</span>
                </button>
              ) : null}
            </div>)
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
                  {t("share.selectAll")}
                </button>
                <span>{t(selectedTurnIds.length === 1 ? "share.selected" : "share.selectedPlural", { count: selectedTurnIds.length })}</span>
              </div>
              <div className="thread-public-share-actionbar-actions">
                <button type="button" className="thread-public-share-secondary-btn" onClick={cancelSelectionMode} disabled={submitting}>
                  {t("common.cancel")}
                </button>
                <button
                  type="button"
                  className="thread-public-share-primary-btn"
                  onClick={() => setConfirmOpen(true)}
                  disabled={submitting || selectedTurnIds.length === 0}
                >
                  {t("share.create")}
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
                  <h3>{t("share.create")}</h3>
                  <button
                    type="button"
                    className="thread-public-share-close-btn"
                    onClick={() => setConfirmOpen(false)}
                    disabled={submitting}
                    aria-label={t("share.closeDialog")}
                  >
                    <XIcon size={18} />
                  </button>
                </div>
                <p className="thread-public-share-modal-copy">
                  {t("share.warning")}
                </p>
                {errorText ? <p className="field-error thread-public-share-modal-error">{errorText}</p> : null}
                <button
                  type="button"
                  className="thread-public-share-modal-primary"
                  onClick={() => void createAndCopyPublicLink()}
                  disabled={submitting || selectedTurnIds.length === 0}
                >
                  {submitting ? t("share.creating") : t("share.createCopy")}
                </button>
              </div>
            </div>
          ) : null}
        </div>
      </MessageEntryAnimationContext.Provider>
    </ThreadPublicShareSelectionContext.Provider>
  );
};
