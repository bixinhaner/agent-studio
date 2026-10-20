import { AlertCircleIcon, RefreshCcwIcon } from "lucide-react";

import { usePortalI18n } from "./i18n";

type PortalChatRecoveryNoticeProps =
  | { state: "recovering" }
  | { state: "failed"; canRerun: boolean; onRerun: () => void; reason?: "send_not_delivered" };

export function PortalChatRecoveryNotice(props: PortalChatRecoveryNoticeProps) {
  const { t } = usePortalI18n();

  if (props.state === "recovering") {
    return (
      <div className="assistant-recovery-card" role="status" aria-live="polite">
        <span className="assistant-running-spinner" aria-hidden="true" />
        <div>
          <strong>{t("thread.connectionRecovering")}</strong>
          <p>{t("thread.connectionRecoveringHelp")}</p>
        </div>
      </div>
    );
  }

  const notDelivered = props.reason === "send_not_delivered";
  return (
    <div className="assistant-error-card" role="alert" aria-live="polite">
      <div className="assistant-error-card-head">
        <AlertCircleIcon size={16} aria-hidden="true" />
        <strong>{t(notDelivered ? "thread.sendNotDelivered" : "thread.recoveryFailed")}</strong>
      </div>
      <p>{t(notDelivered ? "thread.sendNotDeliveredHelp" : "thread.recoveryFailedHelp")}</p>
      {props.canRerun ? (
        <button type="button" className="assistant-error-retry" onClick={props.onRerun}>
          <RefreshCcwIcon size={15} aria-hidden="true" />
          <span>{t(notDelivered ? "thread.resend" : "thread.rerun")}</span>
        </button>
      ) : null}
    </div>
  );
}
