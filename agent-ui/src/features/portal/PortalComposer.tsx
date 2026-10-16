import {
  type FC,
  type FormEvent as ReactFormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from "react";
import { useAui } from "@assistant-ui/react";
import { Composer } from "@assistant-ui/react-ui";
import { PlusIcon, SendHorizontalIcon, SquareIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/store";
import { useAuth } from "../auth/AuthProvider";
import { isInternalOrganization } from "../auth/portal-experience";
import { LocalWorkspaceControls, useLocalWorkspaceReadiness } from "./workbench/LocalWorkspace";
import { usePortalThreadUserSendIntent } from "./PortalThread";
import { reportSendFailure, type SendFailureAttachment } from "../../lib/send-failure-report";
import { type AttachmentNotReady, attachmentNotReadyReason } from "./attachment-send-readiness";
import { usePortalI18n } from "./i18n";
import {
  PortalQueueTray,
  usePortalComposerDraftPersistence,
  usePortalComposerWorkflow,
  usePortalQueueDispatcher
} from "./composer-workflow";
import { PortalBackgroundRunContext } from "./user-input-request";
import { PortalSkillPicker } from "./workbench/SkillPicker";
import { type InlineAttachment, missingInlineAttachments } from "./inline-attachments";
import { hasInlineComposerRequest } from "./inline-references";
import { resolvePortalComposerKeyDownAction } from "./composer-keyboard";
import { THREAD_ATTACHMENT_MAX_BYTES } from "./attachment-upload-messages";
import { InlineAttachmentComposer } from "./InlineAttachmentComposer";
import { asRecord } from "./portal-value-utils";
import {
  buildUploadedAttachmentDownloadHref,
  COMPOSER_ATTACHMENT_SEND_FAILED_EVENT,
  type ComposerAttachmentSendFailure,
  formatFileSize,
  normalizeUploadedAttachmentDownloadMeta,
  uploadedAttachmentDownloadMetaFromAttachment
} from "./portal-attachment-upload";
import { userTextFromUnknownMessage } from "./thread-title";
import { DIRECT_MESSAGE_TEXT_MAX_CHARS } from "./portal-formatting";
import {
  ComposerPendingAttachmentsContext,
  MobileWorkbenchContext,
  PortalRunCancelContext,
  PreviewRequestContext,
  RuntimeReadinessContext,
  SkillComposerContext
} from "./portal-contexts";
import { composerUploadBlockReason } from "./UploadAwareAttachment";
import { useSubscriptionAccessBlock } from "./PortalBanners";

export function formatCharacterCount(value: number): string {
  return new Intl.NumberFormat(undefined).format(value);
}

export function largeDirectMessageNotice(characters: number, baseNotice: string): string {
  return [
    baseNotice,
    `Current message: ${formatCharacterCount(characters)} characters.`
  ].join(" ");
}

export function largePasteFileName(now = new Date()): string {
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0")
  ].join("");
  return `pasted-text-${stamp}.txt`;
}

export function largePasteAttachedNotice(
  fileName: string,
  t: ReturnType<typeof usePortalI18n>["t"]
): string {
  return t("thread.pastedTextAttached", { name: fileName });
}

export function useComposerMultilineRef(composerText: string) {
  const composerWrapRef = useRef<HTMLDivElement>(null);
  const composerTextRef = useRef(composerText);
  composerTextRef.current = composerText;

  const syncMultilineState = useCallback(() => {
    const wrap = composerWrapRef.current;
    if (!wrap) return;
    const textarea = wrap.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    if (!textarea) return;
    const hasMultipleLines = composerTextRef.current.includes("\n") || textarea.scrollHeight > (textarea.isContentEditable ? 60 : 44);
    wrap.dataset.multiline = String(hasMultipleLines);
  }, []);

  useEffect(() => {
    const wrap = composerWrapRef.current;
    if (!wrap) return;
    const textarea = wrap.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
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

export function useLargeTextPasteAttachmentGuard(input: {
  composerWrapRef: MutableRefObject<HTMLDivElement | null>;
  aui: ReturnType<typeof useAui>;
  enabled: boolean;
  onNotice: (notice: string) => void;
  t: ReturnType<typeof usePortalI18n>["t"];
}) {
  const { composerWrapRef, aui, enabled, onNotice, t } = input;

  useEffect(() => {
    const wrap = composerWrapRef.current;
    if (!wrap || !enabled) return;
    const textarea = wrap.querySelector<HTMLElement>('textarea, [contenteditable="true"]');
    if (!textarea) return;

    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented) return;
      const pastedText = event.clipboardData?.getData("text/plain") ?? "";
      if (pastedText.length <= DIRECT_MESSAGE_TEXT_MAX_CHARS) return;

      event.preventDefault();
      event.stopPropagation();

      const pastedBytes = new Blob([pastedText]).size;
      if (pastedBytes > THREAD_ATTACHMENT_MAX_BYTES) {
        onNotice(t("thread.pastedTextTooLarge", { limit: formatFileSize(THREAD_ATTACHMENT_MAX_BYTES) }));
        return;
      }

      const fileName = largePasteFileName();
      const file = new File([pastedText], fileName, { type: "text/plain" });
      const currentText = aui.composer().getState().text.trim();
      if (!currentText) {
        aui.composer().setText(t("thread.pastedTextFallback"));
      }
      onNotice(largePasteAttachedNotice(fileName, t));
      void aui.composer().addAttachment(file).catch(() => {
        onNotice(t("thread.pastedTextAttachFailed"));
      });
    };

    textarea.addEventListener("paste", handlePaste, true);
    return () => textarea.removeEventListener("paste", handlePaste, true);
  }, [aui, composerWrapRef, enabled, onNotice, t]);
}

export const SkillComposerControls: FC = () => {
  const aui = useAui();
  const auth = useAuth();
  const { availableSkills, automaticSkills, enabledSkillIds, recentSkillIds, setSkills } = useContext(SkillComposerContext);
  if (availableSkills.length === 0 && automaticSkills.length === 0) return null;
  const dismissedFeatureAnnouncementIds = auth.user?.portalPreferences?.dismissedFeatureAnnouncements ?? [];
  const featureAnnouncementsEnabled = isInternalOrganization(auth.activeOrganization?.type);
  return (
    <PortalSkillPicker
      availableSkills={availableSkills}
      automaticSkills={automaticSkills}
      enabledSkillIds={enabledSkillIds}
      recentSkillIds={recentSkillIds}
      onEnabledSkillIdsChange={setSkills}
      onFillPrompt={(prompt) => aui.composer().setText(prompt)}
      featureAnnouncements={{
        enabled: featureAnnouncementsEnabled,
        dismissedIds: dismissedFeatureAnnouncementIds,
        onDismiss: async (id) => {
          if (dismissedFeatureAnnouncementIds.includes(id)) return;
          await auth.updatePortalPreferences({
            dismissedFeatureAnnouncements: [...dismissedFeatureAnnouncementIds, id].slice(-50)
          });
        }
      }}
    />
  );
};

export function usePortalComposerKeyDown(threadRunning: boolean) {
  return useCallback((event: ReactKeyboardEvent<HTMLTextAreaElement | HTMLDivElement>) => {
    const action = resolvePortalComposerKeyDownAction({
      key: event.key,
      keyCode: event.nativeEvent.keyCode,
      shiftKey: event.shiftKey,
      isComposing: event.nativeEvent.isComposing,
      threadRunning
    });
    if (action !== "submit") return;
    event.preventDefault();
    event.currentTarget.closest("form")?.requestSubmit();
  }, [threadRunning]);
}

export function sendFailureAttachmentsFrom(attachments: unknown): SendFailureAttachment[] {
  if (!Array.isArray(attachments)) return [];
  return attachments.flatMap((item) => {
    const record = asRecord(item);
    const name = typeof record?.name === "string" ? record.name : "";
    if (!name) return [];
    const status = asRecord(record?.status)?.type;
    const failureCode = record?.uploadFailureCode;
    const file = record?.file;
    return [{
      name,
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof failureCode === "string" ? { failureCode } : {}),
      ...(typeof File !== "undefined" && file instanceof File ? { sizeBytes: file.size } : {})
    }];
  });
}

export function sendFailureContextFromMessages(messages: readonly unknown[]): {
  messagePreview?: string;
  attachments: SendFailureAttachment[];
} {
  const latestUser = [...messages].reverse().find((message) => asRecord(message)?.role === "user");
  if (!latestUser) return { attachments: [] };
  return {
    messagePreview: userTextFromUnknownMessage(latestUser) || undefined,
    attachments: sendFailureAttachmentsFrom(asRecord(latestUser)?.attachments)
  };
}

export type ComposerSendSnapshot = {
  at: number;
  threadId: string;
  text: string;
  attachments: readonly unknown[];
  restored: boolean;
};

export const UploadAwareComposer: FC = () => {
  const aui = useAui();
  const notifyUserSendIntent = usePortalThreadUserSendIntent();
  const { t } = usePortalI18n();
  const workflow = usePortalComposerWorkflow();
  const isMobileWorkbench = useContext(MobileWorkbenchContext);
  const requestPortalRunCancel = useContext(PortalRunCancelContext);
  const accessBlock = useSubscriptionAccessBlock();
  const baseRuntimeReadiness = useContext(RuntimeReadinessContext);
  const localWorkspaceReadiness = useLocalWorkspaceReadiness();
  const runtimeReadiness = localWorkspaceReadiness ?? baseRuntimeReadiness;
  const localThreadRunning = useAuiState((state) => state.thread.isRunning);
  // The server may still run a response this tab is not streaming (reload, lost
  // connection, another tab). Treat it as running so input is queued or steered
  // instead of starting a new run.
  const { backgroundRunning } = useContext(PortalBackgroundRunContext);
  const threadRunning = localThreadRunning || backgroundRunning;
  const runtimeThreadId = useAuiState(state => state.threadListItem.id);
  const composerText = useAuiState((state) => (state.composer.isEditing ? state.composer.text : ""));
  const composerEmpty = useAuiState((state) => !hasInlineComposerRequest(state.composer.text, state.composer.attachments.length));
  const composerSkills = useContext(SkillComposerContext);
  const composerEditing = useAuiState((state) => state.composer.isEditing);
  const uploadBlockReason = useAuiState((state) => composerUploadBlockReason(state.composer.attachments));
  const composerAttachments = useAuiState((state) => state.composer.attachments);
  const missingAttachments = missingInlineAttachments(composerText, composerAttachments);
  const requestPreview = useContext(PreviewRequestContext);
  const previewInlineAttachment = useCallback((attachment: InlineAttachment) => {
    const meta = attachment.uploadedMeta
      ? normalizeUploadedAttachmentDownloadMeta(attachment.uploadedMeta)
      : uploadedAttachmentDownloadMetaFromAttachment(attachment);
    if (!meta) return;
    const href = buildUploadedAttachmentDownloadHref(workflow.threadId, meta);
    requestPreview(meta.relativePath, { contentUrl: href, downloadUrl: href, displayName: meta.name, mimeType: meta.mimeType });
  }, [requestPreview, workflow.threadId]);
  const sendBlockedByUpload = uploadBlockReason !== "" || missingAttachments;
  const sendBlockedByLargeText = composerText.length > DIRECT_MESSAGE_TEXT_MAX_CHARS;
  const sendBlockedByRuntime = runtimeReadiness.status !== "ready";
  const sendDisabled =
    !composerEditing || composerEmpty || composerSkills.busy || sendBlockedByUpload || sendBlockedByLargeText || accessBlock.blocked || sendBlockedByRuntime;
  const sendTitle = accessBlock.blocked
    ? accessBlock.notice
    : sendBlockedByRuntime
      ? runtimeReadiness.notice
    : uploadBlockReason === "uploading"
      ? t("thread.waitUploads")
      : uploadBlockReason === "failed" || missingAttachments
        ? t("thread.fixUploads")
        : sendBlockedByLargeText
          ? t("thread.errorMessageTooLarge")
          : t("thread.send");
  const [composerSending, setComposerSending] = useState(false);
  const [largeTextNotice, setLargeTextNotice] = useState("");
  const [workflowNotice, setWorkflowNotice] = useState("");
  const composerSendingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const composerWrapRef = useComposerMultilineRef(composerText);
  useLargeTextPasteAttachmentGuard({
    composerWrapRef,
    aui,
    enabled: !accessBlock.blocked,
    onNotice: setLargeTextNotice,
    t
  });

  useEffect(() => {
    return () => {
      if (composerSendingTimerRef.current !== null) clearTimeout(composerSendingTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!largeTextNotice || sendBlockedByLargeText) return;
    const timer = window.setTimeout(() => setLargeTextNotice(""), 9000);
    return () => window.clearTimeout(timer);
  }, [largeTextNotice, sendBlockedByLargeText]);

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

  const getComposerText = useCallback(() => aui.composer().getState().text, [aui]);
  const setComposerText = useCallback((text: string) => aui.composer().setText(text), [aui]);
  const sendComposer = useCallback(() => aui.composer().send(), [aui]);
  const { clearStoredDraft } = usePortalComposerDraftPersistence({
    text: composerText,
    threadId: workflow.threadId,
    runtimeThreadId,
    readDraft: workflow.readDraft,
    writeDraft: workflow.writeDraft,
    restoreText: setComposerText
  });
  const hasAttachments = composerAttachments.length > 0;

  usePortalQueueDispatcher({
    workflow,
    threadRunning,
    blocked: accessBlock.blocked || sendBlockedByRuntime || sendBlockedByUpload || sendBlockedByLargeText || hasAttachments || composerSkills.busy,
    getComposerText,
    setComposerText,
    send: sendComposer
  });

  const showWorkflowNotice = useCallback((notice: string) => {
    setWorkflowNotice(notice);
    window.setTimeout(() => setWorkflowNotice((current) => (current === notice ? "" : current)), 7000);
  }, []);

  const lastSendSnapshotRef = useRef<ComposerSendSnapshot | null>(null);
  // assistant-ui empties the composer before it finishes attachments and silently drops the
  // message if one is not ready, so readiness is checked here before handing over.
  const attachmentsBlockSend = useCallback((): boolean => {
    const state = aui.composer().getState();
    const blocked = state.attachments
      .map((attachment) => attachmentNotReadyReason(attachment))
      .find((reason): reason is AttachmentNotReady => reason !== null);
    if (blocked) {
      showWorkflowNotice(blocked.code === "uploading" ? t("thread.waitUploads") : t("thread.fixUploads"));
      reportSendFailure({
        stage: "attachment_not_ready",
        threadId: workflow.threadId,
        errorCode: blocked.code,
        error: blocked.message,
        messagePreview: state.text,
        attachments: sendFailureAttachmentsFrom(state.attachments)
      });
      return true;
    }
    return false;
  }, [aui, showWorkflowNotice, t, workflow.threadId]);
  const sendComposerWithSnapshot = useCallback(() => {
    const state = aui.composer().getState();
    lastSendSnapshotRef.current = {
      at: Date.now(),
      threadId: workflow.threadId,
      text: state.text,
      attachments: state.attachments,
      restored: false
    };
    aui.composer().send();
  }, [aui, workflow.threadId]);

  useEffect(() => {
    const restoreDroppedSend = (event: Event) => {
      const detail = (event as CustomEvent<ComposerAttachmentSendFailure>).detail;
      const snapshot = lastSendSnapshotRef.current;
      if (!snapshot || snapshot.restored || Date.now() - snapshot.at > 15_000) return;
      if (!snapshot.attachments.some((attachment) => asRecord(attachment)?.id === detail.attachmentId)) return;
      snapshot.restored = true;
      reportSendFailure({
        stage: "composer_send",
        threadId: snapshot.threadId,
        errorCode: detail.reason,
        error: detail.detail,
        messagePreview: snapshot.text,
        attachments: sendFailureAttachmentsFrom(snapshot.attachments)
      });
      // The adapter runs before assistant-ui clears the composer; restore after that.
      window.setTimeout(() => {
        window.dispatchEvent(new CustomEvent("bailey-restore-composer", {
          detail: { threadId: snapshot.threadId, text: snapshot.text, attachments: snapshot.attachments }
        }));
        showWorkflowNotice(t("thread.sendRestored"));
      }, 0);
    };
    window.addEventListener(COMPOSER_ATTACHMENT_SEND_FAILED_EVENT, restoreDroppedSend);
    return () => window.removeEventListener(COMPOSER_ATTACHMENT_SEND_FAILED_EVENT, restoreDroppedSend);
  }, [showWorkflowNotice, t]);

  const reportPendingAttachments = useContext(ComposerPendingAttachmentsContext);
  useEffect(() => {
    reportPendingAttachments(composerAttachments.length);
    return () => reportPendingAttachments(0);
  }, [composerAttachments.length, reportPendingAttachments]);
  useEffect(() => {
    if (!hasAttachments) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeUnload);
    return () => window.removeEventListener("beforeunload", warnBeforeUnload);
  }, [hasAttachments]);

  const enqueueCurrent = useCallback(() => {
    const text = getComposerText().trim();
    if (!hasInlineComposerRequest(text) || composerSkills.busy || accessBlock.blocked || sendBlockedByRuntime || sendBlockedByLargeText) return;
    if (hasAttachments) {
      showWorkflowNotice(t("thread.queueTextOnly"));
      return;
    }
    try {
      workflow.enqueue(text);
      setComposerText("");
      clearStoredDraft();
      setWorkflowNotice("");
    } catch {
      showWorkflowNotice(t("thread.queueLimit"));
    }
  }, [accessBlock.blocked, clearStoredDraft, composerSkills.busy, getComposerText, hasAttachments, sendBlockedByLargeText, sendBlockedByRuntime, setComposerText, showWorkflowNotice, t, workflow]);

  const steerCurrent = useCallback(async () => {
    const text = getComposerText().trim();
    if (!hasInlineComposerRequest(text) || composerSkills.busy || accessBlock.blocked || sendBlockedByRuntime || sendBlockedByLargeText) return;
    if (hasAttachments) {
      showWorkflowNotice(t("thread.queueTextOnly"));
      return;
    }
    setComposerText("");
    clearStoredDraft();
    setWorkflowNotice("");
    notifyUserSendIntent();
    try {
      await workflow.steer(text);
    } catch {
      // The persistent steer event keeps the text visible and offers retry/edit recovery.
    }
  }, [accessBlock.blocked, clearStoredDraft, composerSkills.busy, getComposerText, hasAttachments, notifyUserSendIntent, sendBlockedByLargeText, sendBlockedByRuntime, setComposerText, showWorkflowNotice, t, workflow]);

  const continueAnswer = useCallback(() => {
    if (accessBlock.blocked || sendBlockedByRuntime || threadRunning) return;
    const preservedDraft = getComposerText();
    workflow.clearPause();
    setComposerText(t("thread.resumePrompt"));
    triggerComposerSendAnimation();
    notifyUserSendIntent();
    sendComposer();
    window.setTimeout(() => setComposerText(preservedDraft), 0);
  }, [accessBlock.blocked, getComposerText, notifyUserSendIntent, sendBlockedByRuntime, sendComposer, setComposerText, t, threadRunning, triggerComposerSendAnimation, workflow]);

  const continueQueue = useCallback(() => workflow.resumeQueue(), [workflow]);

  const preventBlockedSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    if (threadRunning) {
      event.preventDefault();
      event.stopPropagation();
      enqueueCurrent();
      return;
    }
    if (sendDisabled) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    // Send here instead of letting the primitive send, so attachment readiness is checked first.
    event.preventDefault();
    event.stopPropagation();
    sendCurrentDraft();
  };

  const sendCurrentDraft = () => {
    if (sendDisabled || attachmentsBlockSend()) return;
    workflow.clearPause();
    clearStoredDraft();
    triggerComposerSendAnimation();
    notifyUserSendIntent();
    sendComposerWithSnapshot();
  };

  const sendCurrentMessage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    sendCurrentDraft();
  };

  return (
    <div ref={composerWrapRef} data-tour="steer" className={composerSending ? "portal-composer-wrap is-sending" : "portal-composer-wrap"}>
      <Composer.Root onSubmit={preventBlockedSubmit}>
        <PortalQueueTray threadRunning={threadRunning} onContinueAnswer={continueAnswer} onContinueQueue={continueQueue} />
        {accessBlock.blocked ? (
          <p className="portal-upload-composer-hint portal-access-composer-hint" role="alert">
            {accessBlock.notice}
          </p>
        ) : sendBlockedByRuntime ? (
          <div className="portal-upload-composer-hint portal-runtime-readiness-hint" role={runtimeReadiness.status === "loading" ? "status" : "alert"}>
            <span>{runtimeReadiness.notice}</span>
            {runtimeReadiness.status === "error" ? (
              <button type="button" onClick={() => void runtimeReadiness.retry()}>
                {localWorkspaceReadiness?.actionLabel ?? t("runtime.retry")}
              </button>
            ) : null}
          </div>
        ) : sendBlockedByUpload ? (
          <div className="portal-upload-composer-hint" role="status">
            {uploadBlockReason === "uploading" ? (
              t("thread.uploadingHelp")
            ) : (
              t("thread.uploadFailedHelp")
            )}
          </div>
        ) : sendBlockedByLargeText ? (
          <p className="portal-upload-composer-hint" role="alert">
            {largeDirectMessageNotice(composerText.length, t("thread.errorMessageTooLarge"))}
          </p>
        ) : largeTextNotice ? (
          <p className="portal-upload-composer-hint" role="status">
            {largeTextNotice}
          </p>
        ) : workflowNotice ? (
          <p className="portal-upload-composer-hint" role="status">
            {workflowNotice}
          </p>
        ) : backgroundRunning && !localThreadRunning ? (
          <p className="portal-upload-composer-hint" role="status">
            {t("thread.backgroundRunning")}
          </p>
        ) : null}
        <div className="portal-composer-input-row">
          <InlineAttachmentComposer
            key={`${workflow.userId}:${runtimeThreadId}`}
            draftKey={`${workflow.userId}:${workflow.threadId}`}
            threadId={workflow.threadId}
            autoFocus={!isMobileWorkbench}
            onPreview={previewInlineAttachment}
            skills={{ availableSkills: composerSkills.availableSkills, enabledSkillIds: composerSkills.enabledSkillIds,
              ready: composerSkills.ready, busy: composerSkills.busy, onChange: composerSkills.setSkills }}
          />
        </div>
        <div className="portal-composer-tools-row">
          <div className="portal-composer-tools-left">
            <Composer.AddAttachment data-tour="attach"><PlusIcon /></Composer.AddAttachment>
            <LocalWorkspaceControls />
            <span className="portal-tour-anchor" data-tour="skills"><SkillComposerControls /></span>
          </div>
          {threadRunning ? (
            <div className="portal-running-composer-actions">
              {!composerEmpty ? (
                <>
                  <button
                    type="button"
                    className="portal-running-action"
                    disabled={sendDisabled || hasAttachments || workflow.isSteering}
                    title={hasAttachments ? t("thread.queueTextOnly") : t("thread.steerHelp")}
                    onClick={() => void steerCurrent()}
                  >
                    {t("thread.steerNow")}
                  </button>
                  <button
                    type="button"
                    className="portal-running-action is-primary"
                    disabled={sendDisabled || hasAttachments}
                    title={hasAttachments ? t("thread.queueTextOnly") : t("thread.addQueue")}
                    onClick={enqueueCurrent}
                  >
                    {t("thread.addQueue")}
                  </button>
                </>
              ) : null}
              {localThreadRunning ? (
                <Composer.Cancel className="portal-stop-btn" onClick={requestPortalRunCancel}>
                  <SquareIcon size={13} />
                </Composer.Cancel>
              ) : (
                <button
                  type="button"
                  className="portal-stop-btn"
                  aria-label={t("thread.stopBackground")}
                  title={t("thread.stopBackground")}
                  onClick={requestPortalRunCancel}
                >
                  <SquareIcon size={13} />
                </button>
              )}
            </div>
          ) : (
            <div className="portal-idle-composer-actions">
              {!isMobileWorkbench ? (
                <span className="portal-composer-keyboard-hint">{t("thread.keyboardHint")}</span>
              ) : null}
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
            </div>
          )}
        </div>
      </Composer.Root>
    </div>
  );
};

export const MobileAwareComposer: FC = () => {
  const aui = useAui();
  const notifyUserSendIntent = usePortalThreadUserSendIntent();
  const { t } = usePortalI18n();
  const workflow = usePortalComposerWorkflow();
  const isMobileWorkbench = useContext(MobileWorkbenchContext);
  const requestPortalRunCancel = useContext(PortalRunCancelContext);
  const accessBlock = useSubscriptionAccessBlock();
  const baseRuntimeReadiness = useContext(RuntimeReadinessContext);
  const localWorkspaceReadiness = useLocalWorkspaceReadiness();
  const runtimeReadiness = localWorkspaceReadiness ?? baseRuntimeReadiness;
  const localThreadRunning = useAuiState((state) => state.thread.isRunning);
  // The server may still run a response this tab is not streaming (reload, lost
  // connection, another tab). Treat it as running so input is queued or steered
  // instead of starting a new run.
  const { backgroundRunning } = useContext(PortalBackgroundRunContext);
  const threadRunning = localThreadRunning || backgroundRunning;
  const handleComposerKeyDown = usePortalComposerKeyDown(threadRunning);
  const runtimeThreadId = useAuiState(state => state.threadListItem.id);
  const composerText = useAuiState((state) => (state.composer.isEditing ? state.composer.text : ""));
  const composerEmpty = useAuiState((state) => state.composer.isEmpty);
  const composerEditing = useAuiState((state) => state.composer.isEditing);
  const sendBlockedByLargeText = composerText.length > DIRECT_MESSAGE_TEXT_MAX_CHARS;
  const sendBlockedByRuntime = runtimeReadiness.status !== "ready";
  const sendDisabled = !composerEditing || composerEmpty || sendBlockedByLargeText || accessBlock.blocked || sendBlockedByRuntime;
  const sendTitle = accessBlock.blocked
    ? accessBlock.notice
    : sendBlockedByRuntime
      ? runtimeReadiness.notice
      : sendBlockedByLargeText
        ? t("thread.errorMessageTooLarge")
        : t("thread.send");
  const composerWrapRef = useComposerMultilineRef(composerText);
  const [workflowNotice, setWorkflowNotice] = useState("");
  const getComposerText = useCallback(() => aui.composer().getState().text, [aui]);
  const setComposerText = useCallback((text: string) => aui.composer().setText(text), [aui]);
  const sendComposer = useCallback(() => aui.composer().send(), [aui]);
  const { clearStoredDraft } = usePortalComposerDraftPersistence({
    text: composerText,
    threadId: workflow.threadId,
    runtimeThreadId,
    readDraft: workflow.readDraft,
    writeDraft: workflow.writeDraft,
    restoreText: setComposerText
  });

  usePortalQueueDispatcher({
    workflow,
    threadRunning,
    blocked: accessBlock.blocked || sendBlockedByRuntime || sendBlockedByLargeText,
    getComposerText,
    setComposerText,
    send: sendComposer
  });

  const enqueueCurrent = useCallback(() => {
    const text = getComposerText().trim();
    if (!text || sendDisabled) return;
    try {
      workflow.enqueue(text);
      setComposerText("");
      clearStoredDraft();
      setWorkflowNotice("");
    } catch {
      setWorkflowNotice(t("thread.queueLimit"));
    }
  }, [clearStoredDraft, getComposerText, sendDisabled, setComposerText, t, workflow]);

  const steerCurrent = useCallback(async () => {
    const text = getComposerText().trim();
    if (!text || sendDisabled) return;
    setComposerText("");
    clearStoredDraft();
    setWorkflowNotice("");
    notifyUserSendIntent();
    try {
      await workflow.steer(text);
    } catch {
      // The persistent steer event keeps the text visible and offers retry/edit recovery.
    }
  }, [clearStoredDraft, getComposerText, notifyUserSendIntent, sendDisabled, setComposerText, workflow]);

  const continueAnswer = useCallback(() => {
    if (accessBlock.blocked || sendBlockedByRuntime || threadRunning) return;
    const preservedDraft = getComposerText();
    workflow.clearPause();
    setComposerText(t("thread.resumePrompt"));
    notifyUserSendIntent();
    sendComposer();
    window.setTimeout(() => setComposerText(preservedDraft), 0);
  }, [accessBlock.blocked, getComposerText, notifyUserSendIntent, sendBlockedByRuntime, sendComposer, setComposerText, t, threadRunning, workflow]);

  const preventBlockedSubmit = (event: ReactFormEvent<HTMLFormElement>) => {
    if (threadRunning) {
      event.preventDefault();
      event.stopPropagation();
      enqueueCurrent();
      return;
    }
    if (accessBlock.blocked || sendBlockedByRuntime || sendBlockedByLargeText) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    workflow.clearPause();
    clearStoredDraft();
    notifyUserSendIntent();
  };

  const sendCurrentMessage = (event: ReactMouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    if (sendDisabled) return;
    workflow.clearPause();
    clearStoredDraft();
    notifyUserSendIntent();
    aui.composer().send();
  };

  return (
    <div ref={composerWrapRef} className="portal-composer-wrap">
      <Composer.Root onSubmit={preventBlockedSubmit}>
        <PortalQueueTray
          threadRunning={threadRunning}
          onContinueAnswer={continueAnswer}
          onContinueQueue={workflow.resumeQueue}
        />
        {accessBlock.blocked ? (
          <p className="portal-upload-composer-hint portal-access-composer-hint" role="alert">
            {accessBlock.notice}
          </p>
        ) : sendBlockedByRuntime ? (
          <div className="portal-upload-composer-hint portal-runtime-readiness-hint" role={runtimeReadiness.status === "loading" ? "status" : "alert"}>
            <span>{runtimeReadiness.notice}</span>
            {runtimeReadiness.status === "error" ? (
              <button type="button" onClick={() => void runtimeReadiness.retry()}>
                {localWorkspaceReadiness?.actionLabel ?? t("runtime.retry")}
              </button>
            ) : null}
          </div>
        ) : sendBlockedByLargeText ? (
          <p className="portal-upload-composer-hint" role="alert">
            {largeDirectMessageNotice(composerText.length, t("thread.errorMessageTooLarge"))}
          </p>
        ) : workflowNotice ? (
          <p className="portal-upload-composer-hint" role="status">{workflowNotice}</p>
        ) : backgroundRunning && !localThreadRunning ? (
          <p className="portal-upload-composer-hint" role="status">{t("thread.backgroundRunning")}</p>
        ) : null}
        <div className="portal-composer-input-row">
          <Composer.Input
            autoFocus={!isMobileWorkbench}
            cancelOnEscape={false}
            submitMode="none"
            onKeyDown={handleComposerKeyDown}
            unstable_focusOnRunStart={!isMobileWorkbench}
            unstable_focusOnScrollToBottom={!isMobileWorkbench}
            unstable_focusOnThreadSwitched={!isMobileWorkbench}
          />
        </div>
        <div className="portal-composer-tools-row">
          <div className="portal-composer-tools-left">
            <LocalWorkspaceControls />
            <span className="portal-tour-anchor" data-tour="skills"><SkillComposerControls /></span>
          </div>
          {threadRunning ? (
            <div className="portal-running-composer-actions">
              {!composerEmpty ? (
                <>
                  <button
                    type="button"
                    className="portal-running-action"
                    disabled={sendDisabled || workflow.isSteering}
                    title={t("thread.steerHelp")}
                    onClick={() => void steerCurrent()}
                  >
                    {t("thread.steerNow")}
                  </button>
                  <button
                    type="button"
                    className="portal-running-action is-primary"
                    disabled={sendDisabled}
                    onClick={enqueueCurrent}
                  >
                    {t("thread.addQueue")}
                  </button>
                </>
              ) : null}
              {localThreadRunning ? (
                <Composer.Cancel className="portal-stop-btn" onClick={requestPortalRunCancel}>
                  <SquareIcon size={13} />
                </Composer.Cancel>
              ) : (
                <button
                  type="button"
                  className="portal-stop-btn"
                  aria-label={t("thread.stopBackground")}
                  title={t("thread.stopBackground")}
                  onClick={requestPortalRunCancel}
                >
                  <SquareIcon size={13} />
                </button>
              )}
            </div>
          ) : (
            <div className="portal-idle-composer-actions">
              {!isMobileWorkbench ? (
                <span className="portal-composer-keyboard-hint">{t("thread.keyboardHint")}</span>
              ) : null}
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
            </div>
          )}
        </div>
      </Composer.Root>
    </div>
  );
};
