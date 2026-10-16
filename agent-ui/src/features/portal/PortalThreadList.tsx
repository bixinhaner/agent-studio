import {
  type FC,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PropsWithChildren,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { ThreadListItemPrimitive, useAui } from "@assistant-ui/react";
import { CheckIcon, MoreHorizontalIcon, PencilIcon, Trash2Icon, XIcon } from "lucide-react";
import { AuiProvider, Derived, useAuiState } from "@assistant-ui/store";
import { Dropdown } from "antd";
import { usePortalI18n } from "./i18n";
import { normalizeThreadIdentityKeys } from "./running-thread-map";
import { resolveThreadGroupHeader } from "./thread-group-labels";
import {
  MobileWorkbenchContext,
  RunningThreadIdsContext,
  SessionGroupLabelContext,
  SessionSearchContext,
  ThreadCompletionNoticeContext
} from "./portal-contexts";

export type SelectThreadHandler = (threadId: string, switchToThread: () => Promise<void>) => void;

export const AgentThreadListItem: FC<{ onSelectThread?: SelectThreadHandler; readOnly?: boolean }> = ({
  onSelectThread,
  readOnly = false
}) => {
  const aui = useAui();
  const { locale, t } = usePortalI18n();
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
  const rawGroupLabel = resolveThreadGroupHeader(groupHeaderByRemoteId, remoteId, externalId, localId);
  const groupLabel = locale === "zh-CN"
    ? rawGroupLabel === "Today"
      ? t("sessions.today")
      : rawGroupLabel === "Yesterday"
        ? t("sessions.yesterday")
        : rawGroupLabel === "Last 7 days"
          ? t("sessions.last7Days")
          : rawGroupLabel === "Last 30 days"
            ? t("sessions.last30Days")
            : rawGroupLabel
    : rawGroupLabel;
  const threadTitleForFilter = threadTitle.trim() || t("sessions.newConversation");

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
    if (readOnly || renameSaving) return;
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
      const detail = error instanceof Error ? error.message : t("sessions.renameFailed");
      window.alert(detail);
    } finally {
      setRenameSaving(false);
    }
  };

  const deleteCurrentThread = async () => {
    if (renameSaving) return;
    const confirmed = window.confirm(t("sessions.deleteConfirm"));
    if (!confirmed) return;
    try {
      await aui.threadListItem().delete();
    } catch (error) {
      const detail = error instanceof Error ? error.message : t("sessions.deleteFailed");
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
              placeholder={t("sessions.enterName")}
              disabled={renameSaving}
            />
          </div>
        ) : (
          <ThreadListItemPrimitive.Trigger
            className="aui-thread-list-item-trigger"
            onClick={(event) => {
              clearCompletedThreadNotice(...identityKeys);
              if (!onSelectThread) return;
              // The shell unmounts the current messages before switching (see switchToExistingThread).
              event.preventDefault();
              onSelectThread(remoteId || externalId || localId, async () => {
                await aui.threadListItem().switchTo();
              });
            }}
          >
            <p className="aui-thread-list-item-title">
              <ThreadListItemPrimitive.Title fallback={t("sessions.newConversation")} />
            </p>
          </ThreadListItemPrimitive.Trigger>
        )}
        {!readOnly ? <div className="agent-thread-item-actions">
          {isRenaming ? (
            <>
              <button
                type="button"
                className="thread-item-action-btn thread-item-save-btn"
                title={t("sessions.saveName")}
                aria-label={t("sessions.saveName")}
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
                title={t("sessions.cancelEdit")}
                aria-label={t("sessions.cancelEdit")}
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
                  { key: "rename", label: t("sessions.rename") },
                  { key: "delete", label: t("sessions.delete"), danger: true }
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
                title={t("sessions.more")}
                aria-label={t("sessions.more")}
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
                title={t("sessions.rename")}
                aria-label={t("sessions.rename")}
                onClick={beginRename}
              >
                <PencilIcon size={14} />
              </button>
              <ThreadListItemPrimitive.Delete
                className="thread-item-action-btn thread-item-delete-btn"
                title={t("sessions.delete")}
                aria-label={t("sessions.delete")}
                disabled={isRenaming}
                onClick={(e) => {
                  const confirmed = window.confirm(t("sessions.deleteConfirm"));
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
        </div> : null}
      </ThreadListItemPrimitive.Root>
    </>
  );
};

export const ThreadListItemByIdProvider: FC<PropsWithChildren<{ threadId: string }>> = ({ threadId, children }) => {
  const aui = useAui({
    threadListItem: Derived({
      source: "threads",
      query: { type: "id", id: threadId },
      get: (aui) => aui.threads().item({ id: threadId })
    })
  });

  return <AuiProvider value={aui}>{children}</AuiProvider>;
};

export const StableThreadListItems: FC<{
  visibleRemoteIds?: ReadonlySet<string>;
  orderedRemoteIds?: readonly string[];
  maxItems?: number;
  onSelectThread?: SelectThreadHandler;
  readOnly?: boolean;
}> = ({ visibleRemoteIds, orderedRemoteIds, maxItems, onSelectThread, readOnly = false }) => {
  const threadIds = useAuiState((s) => s.threads.threadIds);
  const threadItems = useAuiState((s) => s.threads.threadItems);
  const stableThreadIds = useMemo(() => {
    const itemById = new Map(threadItems.map((item) => [item.id, item]));
    const itemIdByIdentity = new Map<string, string>();
    for (const item of threadItems) {
      for (const identity of [item.externalId, item.remoteId, item.id]
        .map((value) => String(value || "").trim())
        .filter(Boolean)) {
        itemIdByIdentity.set(identity, item.id);
      }
    }
    const seen = new Set<string>();
    const result: string[] = [];
    const candidateThreadIds = orderedRemoteIds?.length
      ? orderedRemoteIds.map((identity) => itemIdByIdentity.get(String(identity || "").trim())).filter(Boolean)
      : threadIds;
    for (const threadId of candidateThreadIds) {
      if (!threadId) continue;
      const item = itemById.get(threadId);
      const identities = [item?.externalId, item?.remoteId, threadId]
        .map((value) => String(value || "").trim())
        .filter(Boolean);
      if (identities.length === 0 || identities.some((identity) => seen.has(identity))) continue;
      if (visibleRemoteIds && !identities.some((identity) => visibleRemoteIds.has(identity))) continue;
      identities.forEach((identity) => seen.add(identity));
      result.push(threadId);
      if (maxItems && result.length >= maxItems) break;
    }
    return result;
  }, [maxItems, orderedRemoteIds, threadIds, threadItems, visibleRemoteIds]);

  return (
    <>
      {stableThreadIds.map((threadId) => (
        <ThreadListItemByIdProvider key={threadId} threadId={threadId}>
          <AgentThreadListItem onSelectThread={onSelectThread} readOnly={readOnly} />
        </ThreadListItemByIdProvider>
      ))}
    </>
  );
};
