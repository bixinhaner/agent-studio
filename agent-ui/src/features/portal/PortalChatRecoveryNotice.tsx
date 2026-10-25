import { AlertCircleIcon, RefreshCcwIcon } from "lucide-react";

import { usePortalI18n } from "./i18n";

export type PortalChatRecoveryDetail = {
  reason?: "upstream_busy" | "connection";
  attempt?: number;
  maxAttempts?: number;
};

/** Reads the `codex_connection_recovery` data part written by the chat stream. */
export function recoveryNoticeDetail(data: unknown): PortalChatRecoveryDetail {
  const record = data && typeof data === "object" && !Array.isArray(data) ? (data as Record<string, unknown>) : {};
  const count = (value: unknown) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined);
  return {
    reason: record.reason === "upstream_busy" ? "upstream_busy" : "connection",
    attempt: count(record.attempt),
    maxAttempts: count(record.maxAttempts)
  };
}

type PortalChatRecoveryNoticeProps =
  | { state: "recovering"; detail?: PortalChatRecoveryDetail }
  | { state: "failed"; canRerun: boolean; onRerun: () => void; reason?: "send_not_delivered" };

export function PortalChatRecoveryNotice(props: PortalChatRecoveryNoticeProps) {
  const { t } = usePortalI18n();

  if (props.state === "recovering") {
    const { reason, attempt, maxAttempts } = props.detail ?? {};
    const upstreamBusy = reason === "upstream_busy" && attempt && maxAttempts;
    return (
      <div className="assistant-recovery-card" role="status" aria-live="polite">
        <span className="assistant-running-spinner" aria-hidden="true" />
        <div>
          <strong>
            {upstreamBusy
              ? t("thread.upstreamBusyRetrying", { attempt, count: maxAttempts })
              : t("thread.connectionRecovering")}
          </strong>
          <p>{t(upstreamBusy ? "thread.upstreamBusyRetryingHelp" : "thread.connectionRecoveringHelp")}</p>
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
