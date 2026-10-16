import { type FC, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import {
  ActionBarPrimitive,
  MessagePrimitive,
  type ThreadMessage,
  useAttachment,
  useAui,
  useMessagePartText
} from "@assistant-ui/react";
import { AssistantActionBar, AssistantMessage, BranchPicker, UserMessage } from "@assistant-ui/react-ui";
import { CheckIcon, CopyIcon, ThumbsDownIcon, XIcon } from "lucide-react";
import { useAuiState } from "@assistant-ui/store";
import { Input, Modal } from "antd";
import { api } from "../../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { usePortalI18n } from "./i18n";
import { type PortalSteerEvent, PortalSteerEventList, usePortalComposerWorkflow } from "./composer-workflow";
import { type InlineAttachment, inlineAttachmentIds } from "./inline-attachments";
import { InlineMessageReferences } from "./InlineMessageReferences";
import { formatRelativeMessageTime } from "./message-time";
import { InlineAttachmentEditComposer } from "./InlineAttachmentComposer";
import { asRecord } from "./portal-value-utils";
import {
  buildUploadedAttachmentDownloadHref,
  normalizeUploadedAttachmentDownloadMeta,
  uploadedAttachmentDownloadMetaFromAttachment
} from "./portal-attachment-upload";
import { type ThreadFeedbackOut } from "./portal-api-types";
import { coerceDate, formatPortalMessageTime } from "./portal-formatting";
import {
  ActiveThreadIdContext,
  AnswerFeedbackConfigContext,
  ExternalPortalUserContext,
  FeedbackCommentDraftContext,
  feedbackCommentKey,
  feedbackCommentMemory,
  MessageEntryAnimationContext,
  PreviewRequestContext,
  ThreadMutationReadOnlyContext,
  ThreadPublicShareSelectionContext
} from "./portal-contexts";
import { AssistantMarkdownText } from "./AssistantMarkdown";
import { UPLOAD_AWARE_ATTACHMENT_COMPONENTS, UploadAwareAttachment } from "./UploadAwareAttachment";
import { ReasoningPart, SourcePart, useNowTicker } from "./AssistantProcessSummary";
import { AssistantMessageEmpty } from "./AssistantRunningState";
import { ProcessDataFallback } from "./ProcessDataPart";

export function messageTextForSuggestions(message: ThreadMessage): string {
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

export const ThreadPublicShareTurnCheckbox: FC = () => {
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

export const MessageTimestamp: FC = () => {
  const { intlLocale, t } = usePortalI18n();
  const createdAt = useAuiState((s) => (s.message as ThreadMessage & { createdAt?: unknown }).createdAt);
  const timestamp = useMemo(() => formatPortalMessageTime(createdAt), [createdAt]);
  const date = useMemo(() => coerceDate(createdAt), [createdAt]);
  const now = useNowTicker(Boolean(date), 60_000);

  if (!timestamp || !date) return null;

  return (
    <time
      className="portal-message-timestamp"
      dateTime={timestamp.iso}
      title={timestamp.fullLabel}
      aria-label={`Sent ${timestamp.fullLabel}`}
    >
      {formatRelativeMessageTime(date, now, intlLocale, {
        justNow: t("time.justNow"),
        yesterday: (time) => t("time.yesterday", { time })
      })}
    </time>
  );
};

/** User message footer: time + copy, right aligned under the bubble. */
export const UserMessageFooter: FC = () => {
  const { t } = usePortalI18n();
  return (
    <div className="portal-user-message-footer">
      <MessageTimestamp />
      <ActionBarPrimitive.Root className="portal-user-message-actions">
        <ActionBarPrimitive.Copy className="portal-message-action-btn" aria-label={t("message.copy")} title={t("message.copy")}>
          <CopyIcon className="portal-copy-icon" size={15} aria-hidden="true" />
          <CheckIcon className="portal-copied-icon" size={15} aria-hidden="true" />
        </ActionBarPrimitive.Copy>
      </ActionBarPrimitive.Root>
    </div>
  );
};

export const ThreadPublicShareMessageShell: FC<{ tone: "user" | "assistant"; children: ReactNode }> = ({ tone, children }) => {
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
    </div>
  );
};

export function useInlineAttachmentPreview() {
  const requestPreview = useContext(PreviewRequestContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const external = useContext(ExternalPortalUserContext);
  const preview = useCallback((attachment: InlineAttachment) => {
    const meta = attachment.uploadedMeta ? normalizeUploadedAttachmentDownloadMeta(attachment.uploadedMeta)
      : uploadedAttachmentDownloadMetaFromAttachment(attachment);
    if (!meta) return;
    const href = buildUploadedAttachmentDownloadHref(activeThreadId, meta);
    requestPreview(meta.relativePath, { contentUrl: href, downloadUrl: href, displayName: meta.name, mimeType: meta.mimeType });
  }, [activeThreadId, requestPreview]);
  return external ? undefined : preview;
}
export const InlineUserMessageText: FC = () => {
  const { text } = useMessagePartText();
  const attachments = useAuiState(state => state.message.attachments) as readonly InlineAttachment[];
  const preview = useInlineAttachmentPreview();
  return <InlineMessageReferences text={text} attachments={attachments} onPreview={preview} />;
};
export const InlineEditComposer: FC = () => {
  const messageId = useAuiState(state => state.message.id);
  const preview = useInlineAttachmentPreview();
  const threadId = useContext(ActiveThreadIdContext);
  const auth = useAuth();
  return <InlineAttachmentEditComposer draftKey={"edit:" + auth.user?.id + ":" + messageId} threadId={threadId} onPreview={preview} />;
};

export const UnreferencedMessageAttachment: FC = () => {
  const attachment = useAttachment();
  const referenced = useAuiState(state => state.message.content.some(part => part.type === "text" && inlineAttachmentIds(part.text).has(attachment.id)));
  return referenced ? null : <UploadAwareAttachment />;
};
export const AgentUserMessage: FC = () => {
  const inline = useAuiState(state => state.message.content.some(part => part.type === "text" && inlineAttachmentIds(part.text).size > 0));
  if (inline) return <ThreadPublicShareMessageShell tone="user"><UserMessage.Root><MessagePrimitive.Attachments components={{ Attachment: UnreferencedMessageAttachment }} /><UserMessage.Content components={{ Text: InlineUserMessageText }} /><BranchPicker /></UserMessage.Root><UserMessageFooter /></ThreadPublicShareMessageShell>;
  return (
    <ThreadPublicShareMessageShell tone="user">
      <MessagePrimitive.If hasAttachments>
        <div className="aui-user-message-attachments portal-user-message-download-attachments">
          <MessagePrimitive.Attachments components={UPLOAD_AWARE_ATTACHMENT_COMPONENTS} />
        </div>
      </MessagePrimitive.If>
      <div className="portal-user-message-default-with-hidden-attachments">
        <UserMessage.Root>
          <UserMessage.Content />
          <BranchPicker />
        </UserMessage.Root>
      </div>
      <UserMessageFooter />
    </ThreadPublicShareMessageShell>
  );
};

export const AgentAssistantFeedbackNegativeButton: FC = () => {
  const aui = useAui();
  const { t } = usePortalI18n();
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
        title={t("thread.badResponse")}
        aria-label={t("thread.badResponse")}
        onClick={openFeedbackDialog}
      >
        <ThumbsDownIcon size={16} strokeWidth={2} />
      </button>
      <Modal
        title={t("thread.feedbackImprove")}
        open={open}
        className="assistant-feedback-modal"
        okText={t("thread.feedbackSubmit")}
        cancelText={t("common.cancel")}
        onOk={submitNegativeFeedback}
        onCancel={() => setOpen(false)}
        destroyOnHidden
      >
        <p className="assistant-feedback-modal-help">
          {t("thread.feedbackHelp")}
        </p>
        <div className="assistant-feedback-textarea-field">
          <Input.TextArea
            value={comment}
            onChange={(event) => setComment(event.target.value.slice(0, 1000))}
            placeholder={t("thread.feedbackPlaceholder")}
            autoSize={{ minRows: 4, maxRows: 7 }}
            maxLength={1000}
            showCount
          />
        </div>
      </Modal>
    </>
  );
};

export const AgentAssistantAnswerFeedback: FC = () => {
  const aui = useAui();
  const { t } = usePortalI18n();
  const config = useContext(AnswerFeedbackConfigContext);
  const draftsRef = useContext(FeedbackCommentDraftContext);
  const activeThreadId = useContext(ActiveThreadIdContext);
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
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

  if (mutationReadOnly || !config.enabled || hidden) {
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
      setErrorText(error instanceof Error ? error.message : t("thread.feedbackFailed"));
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
          <span>{t("thread.feedbackYes")}</span>
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
          <span>{t("thread.feedbackNo")}</span>
        </button>
      </div>
      {submittedType ? <span className="assistant-answer-feedback-thanks">{t("thread.feedbackThanks")}</span> : null}
      {errorText ? <span className="assistant-answer-feedback-error">{errorText}</span> : null}
    </div>
  );
};

export const AgentAssistantActionBar: FC = () => {
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
  return (
    <AssistantActionBar.Root hideWhenRunning autohide="never" autohideFloat="never">
      <AssistantActionBar.Copy />
      {!mutationReadOnly ? (
        <>
          <AssistantActionBar.FeedbackPositive />
          <AgentAssistantFeedbackNegativeButton />
        </>
      ) : null}
    </AssistantActionBar.Root>
  );
};

export const PortalSteerEventsView: FC<{ events: PortalSteerEvent[] }> = ({ events }) => {
  const aui = useAui();
  const workflow = usePortalComposerWorkflow();
  const threadRunning = useAuiState((state) => state.thread.isRunning);
  const editMessage = useCallback((message: string) => {
    aui.composer().setText(message);
  }, [aui]);
  const queueMessage = useCallback((message: string) => {
    try {
      workflow.enqueue(message);
    } catch {
      aui.composer().setText(message);
    }
  }, [aui, workflow]);

  return (
    <PortalSteerEventList
      events={events}
      threadRunning={threadRunning}
      onEdit={editMessage}
      onQueue={queueMessage}
    />
  );
};

export const PortalSteerEventsForAssistantMessage: FC = () => {
  const workflow = usePortalComposerWorkflow();
  const sourceUserMessageId = useAuiState((state) => {
    const previous = state.thread.messages.at(state.message.index - 1);
    return previous?.role === "user" ? previous.id : "";
  });
  const events = useMemo(
    () => workflow.steerEvents.filter(
      (event) => event.sourceUserMessageId === sourceUserMessageId && !event.userInputRequestId
    ),
    [sourceUserMessageId, workflow.steerEvents]
  );
  return <PortalSteerEventsView events={events} />;
};

export const AgentAssistantMessage: FC = () => {
  const isRunning = useAuiState((s) => (s.message as { status?: { type?: string } }).status?.type === "running");
  const hasAnswerText = useAuiState((s) =>
    (s.message.content as readonly unknown[]).some((part) => {
      const item = asRecord(part);
      return item?.type === "text" && typeof item.text === "string" && item.text.trim().length > 0;
    })
  );
  const isLastMessage = useAuiState((s) => Boolean((s.message as { isLast?: boolean }).isLast));
  const rootClassName = [
    "portal-assistant-message-root",
    isLastMessage ? "is-last" : "",
    isRunning ? "is-running" : "",
    isRunning && hasAnswerText ? "is-streaming-text" : ""
  ].filter(Boolean).join(" ");
  return (
    <ThreadPublicShareMessageShell tone="assistant">
      <AssistantMessage.Root className={rootClassName}>
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
        <div className="portal-assistant-message-footer">
          <AgentAssistantActionBar />
          <BranchPicker />
          <MessageTimestamp />
        </div>
        <AgentAssistantAnswerFeedback />
      </AssistantMessage.Root>
      <PortalSteerEventsForAssistantMessage />
    </ThreadPublicShareMessageShell>
  );
};

export const PortalSteerEventsFooter: FC = () => {
  const workflow = usePortalComposerWorkflow();
  const unanchoredEvents = useMemo(
    () => workflow.steerEvents.filter((event) => !event.sourceUserMessageId && !event.userInputRequestId),
    [workflow.steerEvents]
  );
  return <PortalSteerEventsView events={unanchoredEvents} />;
};

export const ReadOnlyComposer: FC = () => null;
