import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode
} from "react";
import {
  AlertCircleIcon,
  CheckCircle2Icon,
  GripVerticalIcon,
  PencilIcon,
  PlayIcon,
  RotateCcwIcon,
  Trash2Icon,
  Undo2Icon,
  XIcon
} from "lucide-react";

import {
  PORTAL_COMPOSER_MAX_QUEUE_ITEMS,
  createPortalQueueItem,
  loadPortalComposerStoredState,
  savePortalComposerStoredState,
  type PortalComposerStoredState,
  type PortalQueueItem,
  type PortalQueuePauseReason
} from "./composer-workflow-state";
import { usePortalI18n } from "./i18n";

type QueueState = Pick<PortalComposerStoredState, "queue" | "pausedReason">;

type RemovedQueueItem = {
  item: PortalQueueItem;
  index: number;
};

export type PortalComposerWorkflowContextValue = {
  userId: string;
  threadId: string;
  queue: PortalQueueItem[];
  pausedReason: PortalQueuePauseReason;
  isSteering: boolean;
  steerNotice: string;
  steerError: string;
  enqueue(text: string): PortalQueueItem;
  updateItem(itemId: string, text: string): void;
  removeItem(itemId: string): RemovedQueueItem | null;
  restoreItem(removed: RemovedQueueItem): void;
  moveItem(itemId: string, direction: -1 | 1): void;
  reorderItem(itemId: string, beforeItemId: string): void;
  retryItem(itemId: string): void;
  beginDispatch(itemId: string): void;
  markOrphanedDispatch(itemId: string): void;
  steer(text: string, queuedItemId?: string): Promise<void>;
  resumeQueue(): void;
  clearPause(): void;
  readDraft(): string;
  writeDraft(text: string): void;
};

const EMPTY_CONTEXT: PortalComposerWorkflowContextValue = {
  userId: "",
  threadId: "",
  queue: [],
  pausedReason: null,
  isSteering: false,
  steerNotice: "",
  steerError: "",
  enqueue: (text) => createPortalQueueItem(text),
  updateItem: () => undefined,
  removeItem: () => null,
  restoreItem: () => undefined,
  moveItem: () => undefined,
  reorderItem: () => undefined,
  retryItem: () => undefined,
  beginDispatch: () => undefined,
  markOrphanedDispatch: () => undefined,
  steer: async () => undefined,
  resumeQueue: () => undefined,
  clearPause: () => undefined,
  readDraft: () => "",
  writeDraft: () => undefined
};

export const PortalComposerWorkflowContext = createContext<PortalComposerWorkflowContextValue>(EMPTY_CONTEXT);

function browserStorage(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function queueStateFromStored(state: PortalComposerStoredState): QueueState {
  return {
    queue: state.queue,
    pausedReason: state.pausedReason
  };
}

export function usePortalComposerWorkflowController(input: {
  userId: string;
  activeThreadId: string;
  onSteer(text: string): Promise<void>;
}) {
  const { userId, activeThreadId, onSteer } = input;
  const [states, setStates] = useState<Record<string, QueueState>>({});
  const statesRef = useRef(states);
  const [steeringThreadId, setSteeringThreadId] = useState("");
  const [steerNoticeByThread, setSteerNoticeByThread] = useState<Record<string, string>>({});
  const [steerErrorByThread, setSteerErrorByThread] = useState<Record<string, string>>({});
  statesRef.current = states;

  const readStored = useCallback(
    (threadId: string, recoverSending = true) =>
      loadPortalComposerStoredState(browserStorage(), userId, threadId, Date.now(), { recoverSending }),
    [userId]
  );

  const commit = useCallback(
    (threadId: string, next: QueueState) => {
      if (!userId.trim() || !threadId.trim()) return;
      const currentStored = readStored(threadId, false);
      savePortalComposerStoredState(browserStorage(), userId, threadId, {
        ...currentStored,
        queue: next.queue,
        pausedReason: next.pausedReason
      });
      statesRef.current = { ...statesRef.current, [threadId]: next };
      setStates(statesRef.current);
    },
    [readStored, userId]
  );

  const updateThread = useCallback(
    (threadId: string, updater: (state: QueueState) => QueueState) => {
      if (!threadId.trim()) return;
      const current = statesRef.current[threadId] ?? queueStateFromStored(readStored(threadId));
      commit(threadId, updater(current));
    },
    [commit, readStored]
  );

  useEffect(() => {
    statesRef.current = {};
    setStates({});
    setSteeringThreadId("");
    setSteerNoticeByThread({});
    setSteerErrorByThread({});
  }, [userId]);

  useEffect(() => {
    if (!activeThreadId || statesRef.current[activeThreadId]) return;
    const next = queueStateFromStored(readStored(activeThreadId));
    statesRef.current = { ...statesRef.current, [activeThreadId]: next };
    setStates(statesRef.current);
  }, [activeThreadId, readStored]);

  const activeState = useMemo(
    () => states[activeThreadId] ?? queueStateFromStored(readStored(activeThreadId)),
    [activeThreadId, readStored, states]
  );

  const enqueue = useCallback(
    (text: string) => {
      const item = createPortalQueueItem(text);
      updateThread(activeThreadId, (state) => {
        if (state.queue.length >= PORTAL_COMPOSER_MAX_QUEUE_ITEMS) {
          throw new Error("queue_limit_reached");
        }
        return { ...state, queue: [...state.queue, item] };
      });
      return item;
    },
    [activeThreadId, updateThread]
  );

  const updateItem = useCallback(
    (itemId: string, text: string) => {
      const nextText = text.trim();
      if (!nextText) return;
      updateThread(activeThreadId, (state) => ({
        ...state,
        queue: state.queue.map((item) => (item.id === itemId ? { ...item, text: nextText } : item))
      }));
    },
    [activeThreadId, updateThread]
  );

  const removeItem = useCallback(
    (itemId: string): RemovedQueueItem | null => {
      const state = statesRef.current[activeThreadId] ?? queueStateFromStored(readStored(activeThreadId));
      const index = state.queue.findIndex((item) => item.id === itemId);
      if (index < 0) return null;
      const item = state.queue[index];
      const queue = state.queue.filter((candidate) => candidate.id !== itemId);
      commit(activeThreadId, {
        ...state,
        queue,
        pausedReason:
          state.pausedReason === "failed" && !queue.some((candidate) => candidate.status === "failed")
            ? null
            : state.pausedReason
      });
      return { item, index };
    },
    [activeThreadId, commit, readStored]
  );

  const restoreItem = useCallback(
    (removed: RemovedQueueItem) => {
      updateThread(activeThreadId, (state) => {
        const queue = [...state.queue];
        queue.splice(Math.min(removed.index, queue.length), 0, { ...removed.item, status: "queued" });
        return { ...state, queue };
      });
    },
    [activeThreadId, updateThread]
  );

  const moveItem = useCallback(
    (itemId: string, direction: -1 | 1) => {
      updateThread(activeThreadId, (state) => {
        const index = state.queue.findIndex((item) => item.id === itemId);
        const target = index + direction;
        if (index < 0 || target < 0 || target >= state.queue.length) return state;
        const queue = [...state.queue];
        const [item] = queue.splice(index, 1);
        queue.splice(target, 0, item);
        return { ...state, queue };
      });
    },
    [activeThreadId, updateThread]
  );

  const reorderItem = useCallback(
    (itemId: string, beforeItemId: string) => {
      if (itemId === beforeItemId) return;
      updateThread(activeThreadId, (state) => {
        const sourceIndex = state.queue.findIndex((item) => item.id === itemId);
        const targetIndex = state.queue.findIndex((item) => item.id === beforeItemId);
        if (sourceIndex < 0 || targetIndex < 0) return state;
        const queue = [...state.queue];
        const [item] = queue.splice(sourceIndex, 1);
        queue.splice(sourceIndex < targetIndex ? targetIndex - 1 : targetIndex, 0, item);
        return { ...state, queue };
      });
    },
    [activeThreadId, updateThread]
  );

  const retryItem = useCallback(
    (itemId: string) => {
      updateThread(activeThreadId, (state) => ({
        queue: state.queue.map((item) => (item.id === itemId ? { ...item, status: "queued" } : item)),
        pausedReason: null
      }));
    },
    [activeThreadId, updateThread]
  );

  const beginDispatch = useCallback(
    (itemId: string) => {
      updateThread(activeThreadId, (state) => ({
        ...state,
        queue: state.queue.map((item) => (item.id === itemId ? { ...item, status: "sending" } : item))
      }));
    },
    [activeThreadId, updateThread]
  );

  const markOrphanedDispatch = useCallback(
    (itemId: string) => {
      updateThread(activeThreadId, (state) => ({
        queue: state.queue.map((item) => (item.id === itemId ? { ...item, status: "failed" } : item)),
        pausedReason: "failed"
      }));
    },
    [activeThreadId, updateThread]
  );

  const steer = useCallback(
    async (text: string, queuedItemId?: string) => {
      if (!activeThreadId) throw new Error("missing_thread");
      setSteeringThreadId(activeThreadId);
      setSteerErrorByThread((current) => ({ ...current, [activeThreadId]: "" }));
      try {
        await onSteer(text);
        if (queuedItemId) removeItem(queuedItemId);
        setSteerNoticeByThread((current) => ({ ...current, [activeThreadId]: text.trim() }));
        window.setTimeout(() => {
          setSteerNoticeByThread((current) => {
            if (current[activeThreadId] !== text.trim()) return current;
            return { ...current, [activeThreadId]: "" };
          });
        }, 6000);
      } catch (error) {
        setSteerErrorByThread((current) => ({
          ...current,
          [activeThreadId]: error instanceof Error ? error.message : "steer_failed"
        }));
        throw error;
      } finally {
        setSteeringThreadId((current) => (current === activeThreadId ? "" : current));
      }
    },
    [activeThreadId, onSteer, removeItem]
  );

  const resumeQueue = useCallback(() => {
    updateThread(activeThreadId, (state) => ({ ...state, pausedReason: null }));
  }, [activeThreadId, updateThread]);

  const clearPause = useCallback(() => {
    updateThread(activeThreadId, (state) => ({
      ...state,
      pausedReason: state.pausedReason === "interrupted" ? null : state.pausedReason
    }));
  }, [activeThreadId, updateThread]);

  const readDraft = useCallback(
    () => readStored(activeThreadId, false).draft,
    [activeThreadId, readStored]
  );

  const writeDraft = useCallback(
    (draft: string) => {
      if (!activeThreadId) return;
      const current = readStored(activeThreadId, false);
      savePortalComposerStoredState(browserStorage(), userId, activeThreadId, { ...current, draft });
    },
    [activeThreadId, readStored, userId]
  );

  const markRunCompleted = useCallback(
    (threadId: string) => {
      updateThread(threadId, (state) => ({
        queue: state.queue.filter((item) => item.status !== "sending"),
        pausedReason: state.pausedReason
      }));
    },
    [updateThread]
  );

  const markRunFailed = useCallback(
    (threadId: string) => {
      updateThread(threadId, (state) => ({
        queue: state.queue.map((item) => (item.status === "sending" ? { ...item, status: "failed" } : item)),
        pausedReason:
          state.pausedReason === "interrupted"
            ? "interrupted"
            : state.queue.length > 0
              ? "failed"
              : state.pausedReason
      }));
    },
    [updateThread]
  );

  const markInterrupted = useCallback(
    (threadId: string) => {
      updateThread(threadId, (state) => ({
        queue: state.queue.filter((item) => item.status !== "sending"),
        pausedReason: "interrupted"
      }));
    },
    [updateThread]
  );

  const contextValue = useMemo<PortalComposerWorkflowContextValue>(
    () => ({
      userId,
      threadId: activeThreadId,
      queue: activeState.queue,
      pausedReason: activeState.pausedReason,
      isSteering: steeringThreadId === activeThreadId,
      steerNotice: steerNoticeByThread[activeThreadId] ?? "",
      steerError: steerErrorByThread[activeThreadId] ?? "",
      enqueue,
      updateItem,
      removeItem,
      restoreItem,
      moveItem,
      reorderItem,
      retryItem,
      beginDispatch,
      markOrphanedDispatch,
      steer,
      resumeQueue,
      clearPause,
      readDraft,
      writeDraft
    }),
    [
      activeState.pausedReason,
      activeState.queue,
      activeThreadId,
      beginDispatch,
      clearPause,
      enqueue,
      markOrphanedDispatch,
      moveItem,
      readDraft,
      removeItem,
      reorderItem,
      restoreItem,
      resumeQueue,
      retryItem,
      steer,
      steerErrorByThread,
      steerNoticeByThread,
      steeringThreadId,
      updateItem,
      userId,
      writeDraft
    ]
  );

  return {
    contextValue,
    markRunCompleted,
    markRunFailed,
    markInterrupted
  };
}

export function PortalComposerWorkflowProvider(props: {
  value: PortalComposerWorkflowContextValue;
  children: ReactNode;
}) {
  return (
    <PortalComposerWorkflowContext.Provider value={props.value}>
      {props.children}
    </PortalComposerWorkflowContext.Provider>
  );
}

export function usePortalComposerWorkflow() {
  return useContext(PortalComposerWorkflowContext);
}

export function usePortalComposerDraftPersistence(input: {
  text: string;
  threadId: string;
  readDraft(): string;
  writeDraft(text: string): void;
  restoreText(text: string): void;
}) {
  const { text, threadId, readDraft, writeDraft, restoreText } = input;
  const textByThreadRef = useRef<Record<string, string>>({});
  const persistTimerRef = useRef<number | null>(null);
  const hydrationRef = useRef<{ threadId: string; expected: string; pending: boolean }>({
    threadId: "",
    expected: "",
    pending: false
  });
  if (threadId) textByThreadRef.current[threadId] = text;

  const flush = useCallback(() => {
    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
      persistTimerRef.current = null;
    }
    writeDraft(textByThreadRef.current[threadId] ?? "");
  }, [threadId, writeDraft]);

  const clear = useCallback(() => {
    if (threadId) textByThreadRef.current[threadId] = "";
    writeDraft("");
  }, [threadId, writeDraft]);

  useEffect(() => {
    if (!threadId) return undefined;
    const savedDraft = readDraft();
    hydrationRef.current = { threadId, expected: savedDraft, pending: text !== savedDraft };
    textByThreadRef.current[threadId] = savedDraft;
    if (text !== savedDraft) restoreText(savedDraft);
    return flush;
  }, [flush, readDraft, restoreText, threadId]);

  useEffect(() => {
    if (!threadId) return;
    const hydration = hydrationRef.current;
    if (hydration.threadId === threadId && hydration.pending) {
      if (text === hydration.expected) hydration.pending = false;
      return;
    }
    if (persistTimerRef.current !== null) window.clearTimeout(persistTimerRef.current);
    persistTimerRef.current = window.setTimeout(flush, 180);
  }, [flush, text, threadId]);

  useEffect(() => {
    const handlePageHide = () => flush();
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", handlePageHide);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("pagehide", handlePageHide);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [flush]);

  return { clearStoredDraft: clear, flushStoredDraft: flush };
}

export function usePortalQueueDispatcher(input: {
  workflow: PortalComposerWorkflowContextValue;
  threadRunning: boolean;
  blocked: boolean;
  getComposerText(): string;
  setComposerText(text: string): void;
  send(): void;
}) {
  const { workflow, threadRunning, blocked, getComposerText, setComposerText, send } = input;
  const dispatchLockRef = useRef("");
  const orphanTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (threadRunning) {
      if (orphanTimerRef.current !== null) {
        window.clearTimeout(orphanTimerRef.current);
        orphanTimerRef.current = null;
      }
      return;
    }
    const sendingItem = workflow.queue.find((item) => item.status === "sending");
    if (sendingItem) {
      if (orphanTimerRef.current === null) {
        orphanTimerRef.current = window.setTimeout(() => {
          orphanTimerRef.current = null;
          workflow.markOrphanedDispatch(sendingItem.id);
        }, 1200);
      }
      return;
    }
    dispatchLockRef.current = "";
    if (workflow.pausedReason || blocked) return;
    const nextItem = workflow.queue.find((item) => item.status === "queued");
    if (!nextItem) return;
    dispatchLockRef.current = nextItem.id;
    workflow.beginDispatch(nextItem.id);
    const preservedDraft = getComposerText();
    try {
      setComposerText(nextItem.text);
      send();
      window.setTimeout(() => setComposerText(preservedDraft), 0);
    } catch {
      dispatchLockRef.current = "";
      workflow.markOrphanedDispatch(nextItem.id);
      setComposerText(preservedDraft);
    }
  }, [blocked, getComposerText, send, setComposerText, threadRunning, workflow]);

  useEffect(() => () => {
    if (orphanTimerRef.current !== null) window.clearTimeout(orphanTimerRef.current);
  }, []);
}

export function PortalQueueTray(props: {
  threadRunning: boolean;
  onContinueAnswer(): void;
  onContinueQueue(): void;
}) {
  const { t } = usePortalI18n();
  const workflow = usePortalComposerWorkflow();
  const [editingId, setEditingId] = useState("");
  const [editingText, setEditingText] = useState("");
  const [draggingId, setDraggingId] = useState("");
  const [removed, setRemoved] = useState<RemovedQueueItem | null>(null);

  const removeItem = (itemId: string) => {
    const nextRemoved = workflow.removeItem(itemId);
    if (nextRemoved) setRemoved(nextRemoved);
  };

  const saveEdit = () => {
    if (!editingId || !editingText.trim()) return;
    workflow.updateItem(editingId, editingText);
    setEditingId("");
    setEditingText("");
  };

  const handleMoveKey = (event: KeyboardEvent<HTMLButtonElement>, itemId: string) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
    event.preventDefault();
    workflow.moveItem(itemId, event.key === "ArrowUp" ? -1 : 1);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, beforeItemId: string) => {
    event.preventDefault();
    if (draggingId) workflow.reorderItem(draggingId, beforeItemId);
    setDraggingId("");
  };

  if (
    workflow.queue.length === 0 &&
    !workflow.pausedReason &&
    !workflow.steerNotice &&
    !workflow.steerError &&
    !removed
  ) {
    return null;
  }

  return (
    <div className="portal-composer-workflow" aria-live="polite">
      {workflow.pausedReason === "interrupted" ? (
        <div className="portal-composer-recovery" role="status">
          <div className="portal-composer-recovery-copy">
            <AlertCircleIcon size={16} aria-hidden="true" />
            <span>{t("thread.queueInterrupted", { count: workflow.queue.length })}</span>
          </div>
          <div className="portal-composer-recovery-actions">
            <button
              type="button"
              className="portal-queue-action"
              disabled={props.threadRunning}
              onClick={props.onContinueAnswer}
            >
              <PlayIcon size={14} aria-hidden="true" />
              {t("thread.continueAnswer")}
            </button>
            {workflow.queue.length > 0 ? (
              <button
                type="button"
                className="portal-queue-action is-primary"
                disabled={props.threadRunning}
                onClick={props.onContinueQueue}
              >
                {t("thread.continueQueue")}
              </button>
            ) : null}
          </div>
        </div>
      ) : workflow.pausedReason === "failed" ? (
        <div className="portal-composer-queue-alert" role="alert">
          <AlertCircleIcon size={15} aria-hidden="true" />
          <span>{t("thread.queuePausedAfterFailure")}</span>
        </div>
      ) : null}

      {workflow.steerNotice ? (
        <div className="portal-composer-steer-notice" role="status">
          <CheckCircle2Icon size={15} aria-hidden="true" />
          <span>{t("thread.steerAccepted")}</span>
        </div>
      ) : null}
      {workflow.steerError ? (
        <div className="portal-composer-queue-alert" role="alert">
          <AlertCircleIcon size={15} aria-hidden="true" />
          <span>{t("thread.steerFailed")}</span>
        </div>
      ) : null}

      {workflow.queue.length > 0 ? (
        <div className="portal-queue-tray">
          <div className="portal-queue-tray-header">
            <strong>{t("thread.queueTitle", { count: workflow.queue.length })}</strong>
            <span>{t("thread.queueHelp")}</span>
          </div>
          <div className="portal-queue-list">
            {workflow.queue.map((item, index) => {
              const editing = editingId === item.id;
              const busy = item.status === "sending";
              return (
                <div
                  key={item.id}
                  className={`portal-queue-row is-${item.status}`}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => handleDrop(event, item.id)}
                >
                  <button
                    type="button"
                    className="portal-queue-drag"
                    draggable={!busy}
                    disabled={busy}
                    aria-label={t("thread.queueReorder", { index: index + 1 })}
                    title={t("thread.queueReorderHelp")}
                    onDragStart={() => setDraggingId(item.id)}
                    onDragEnd={() => setDraggingId("")}
                    onKeyDown={(event) => handleMoveKey(event, item.id)}
                  >
                    <GripVerticalIcon size={15} aria-hidden="true" />
                  </button>
                  <span className="portal-queue-index" aria-hidden="true">{index + 1}</span>
                  {editing ? (
                    <input
                      className="portal-queue-edit-input"
                      value={editingText}
                      autoFocus
                      onChange={(event) => setEditingText(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          event.stopPropagation();
                          saveEdit();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          event.stopPropagation();
                          setEditingId("");
                        }
                      }}
                      aria-label={t("thread.queueEditLabel")}
                    />
                  ) : (
                    <span className="portal-queue-text">{item.text}</span>
                  )}
                  <div className="portal-queue-row-actions">
                    {editing ? (
                      <>
                        <button type="button" className="portal-queue-icon-btn" onClick={saveEdit} aria-label={t("common.confirm")}>
                          <CheckCircle2Icon size={15} aria-hidden="true" />
                        </button>
                        <button type="button" className="portal-queue-icon-btn" onClick={() => setEditingId("")} aria-label={t("common.cancel")}>
                          <XIcon size={15} aria-hidden="true" />
                        </button>
                      </>
                    ) : item.status === "failed" ? (
                      <>
                        <button type="button" className="portal-queue-action" onClick={() => workflow.retryItem(item.id)}>
                          <RotateCcwIcon size={14} aria-hidden="true" />
                          {t("common.retry")}
                        </button>
                        <button
                          type="button"
                          className="portal-queue-icon-btn is-danger"
                          onClick={() => removeItem(item.id)}
                          aria-label={t("thread.queueDelete")}
                        >
                          <Trash2Icon size={14} aria-hidden="true" />
                        </button>
                      </>
                    ) : (
                      <>
                        {props.threadRunning ? (
                          <button
                            type="button"
                            className="portal-queue-action is-primary"
                            disabled={workflow.isSteering || busy}
                            onClick={() => void workflow.steer(item.text, item.id).catch(() => undefined)}
                          >
                            {t("thread.steerNow")}
                          </button>
                        ) : null}
                        <button
                          type="button"
                          className="portal-queue-icon-btn"
                          disabled={busy}
                          onClick={() => {
                            setEditingId(item.id);
                            setEditingText(item.text);
                          }}
                          aria-label={t("thread.queueEdit")}
                        >
                          <PencilIcon size={14} aria-hidden="true" />
                        </button>
                        <button
                          type="button"
                          className="portal-queue-icon-btn is-danger"
                          disabled={busy}
                          onClick={() => removeItem(item.id)}
                          aria-label={t("thread.queueDelete")}
                        >
                          <Trash2Icon size={14} aria-hidden="true" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}

      {removed ? (
        <div className="portal-queue-undo" role="status">
          <span>{t("thread.queueRemoved")}</span>
          <button
            type="button"
            onClick={() => {
              workflow.restoreItem(removed);
              setRemoved(null);
            }}
          >
            <Undo2Icon size={14} aria-hidden="true" />
            {t("thread.undo")}
          </button>
        </div>
      ) : null}
    </div>
  );
}
