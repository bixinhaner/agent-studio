import { type FC, useContext } from "react";
import { type EmptyMessagePartProps, useAui } from "@assistant-ui/react";
import { useAuiState } from "@assistant-ui/store";
import { LocalToolCard } from "./workbench/LocalToolCard";
import { usePortalThreadUserSendIntent } from "./PortalThread";
import { PortalChatRecoveryNotice } from "./PortalChatRecoveryNotice";
import { usePortalI18n } from "./i18n";
import { detailFromUnknown } from "./portal-value-utils";
import { RUNNING_STAGE_IMAGE_HINT_TEXT } from "./portal-constants";
import { formatAssistantErrorNotice } from "./portal-formatting";
import { PortalChatRecoveryContext, RunningStageTextContext, ThreadMutationReadOnlyContext } from "./portal-contexts";
import { AssistantErrorNoticeCard } from "./PortalBanners";
import { isSummarizedProcessContentPart } from "./AssistantProcessSummary";

export const HiddenToolFallback: FC<any> = (props) => <LocalToolCard {...props} />;

export const AssistantLiveStatus: FC<{ title: string; compact?: boolean }> = ({ title, compact }) => {
  const { t } = usePortalI18n();
  return (
    <span className={`assistant-live-status${compact ? " is-compact" : ""}`}>
      <span className="assistant-running-spinner" aria-hidden="true" />
      <span className="assistant-running-title">{title}</span>
      <span className="assistant-running-chip">{t("thread.live")}</span>
    </span>
  );
};

export const RunningMessagePlaceholder: FC<EmptyMessagePartProps> = ({ status }) => {
  const { t } = usePortalI18n();
  const runningStage = useContext(RunningStageTextContext);
  // Once commentary/trace parts exist, the process summary line is the single running signal.
  const hasProcessParts = useAuiState((s) => (s.message.content as readonly unknown[]).some(isSummarizedProcessContentPart));
  if (status.type !== "running" || hasProcessParts) return null;
  const isImageStage = runningStage.kind === "image";
  const ariaStatus = `${t("thread.assistantProcessing", { status: runningStage.text })}${
    runningStage.secondaryText ? `. ${runningStage.secondaryText}` : ""
  }`;

  return (
    <div
      className={`assistant-running-card${isImageStage ? " is-image" : ""}`}
      role="status"
      aria-live="polite"
      aria-label={ariaStatus}
    >
      <div className="assistant-running-head">
        <AssistantLiveStatus title={isImageStage ? t("thread.preparingImage") : t("trace.thinking")} />
      </div>
      {isImageStage ? <p className="assistant-running-hint">{RUNNING_STAGE_IMAGE_HINT_TEXT}</p> : null}
      {isImageStage ? (
        <div className="assistant-image-placeholder" aria-hidden="true">
          <div className="assistant-image-placeholder-frame">
            <span className="assistant-image-placeholder-mark" />
          </div>
        </div>
      ) : null}
      <div className="assistant-running-track" aria-hidden="true">
        <span className="assistant-running-track-bar" />
      </div>
    </div>
  );
};

export const AssistantMessageEmpty: FC<EmptyMessagePartProps> = (props) => {
  const aui = useAui();
  const { t } = usePortalI18n();
  const notifyUserSendIntent = usePortalThreadUserSendIntent();
  const mutationReadOnly = useContext(ThreadMutationReadOnlyContext);
  const recovery = useContext(PortalChatRecoveryContext);
  if (props.status.type === "running" && recovery.active) {
    return <PortalChatRecoveryNotice state="recovering" />;
  }
  if (props.status.type === "incomplete" && (props.status.reason === "error" || props.status.error !== undefined)) {
    const detail = detailFromUnknown(props.status.error);
    const notice = formatAssistantErrorNotice(detail, undefined, t);
    const autoRecoveryAttempted = /portal_auto_recovery_exhausted/i.test(detail);
    const sendNotDelivered = /portal_send_not_delivered/i.test(detail);
    if (autoRecoveryAttempted || sendNotDelivered) {
      return (
        <PortalChatRecoveryNotice
          state="failed"
          reason={sendNotDelivered ? "send_not_delivered" : undefined}
          canRerun={!mutationReadOnly}
          onRerun={() => {
            notifyUserSendIntent();
            aui.message().reload();
          }}
        />
      );
    }
    return <AssistantErrorNoticeCard notice={notice} rawDetail={detail} />;
  }
  return <RunningMessagePlaceholder {...props} />;
};
