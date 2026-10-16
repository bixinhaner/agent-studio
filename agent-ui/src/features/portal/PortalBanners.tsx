import { type FC, useContext } from "react";
import { AlertCircleIcon, CheckIcon, CreditCardIcon } from "lucide-react";
import { Button } from "antd";
import { type PortalSubscriptionStatus } from "./api";
import { usePortalI18n } from "./i18n";
import { shorten } from "./portal-value-utils";
import {
  buildSubscriptionAccessNotice,
  buildSubscriptionResetLine,
  daysUntilSubscriptionExpiry,
  isSubscriptionAccessBlocked
} from "./portal-subscription";
import { PortalSubscriptionAccessContext } from "./portal-contexts";

export function useSubscriptionAccessBlock() {
  const access = useContext(PortalSubscriptionAccessContext);
  const blocked = isSubscriptionAccessBlocked(access.status);
  return {
    blocked,
    status: access.status,
    notice: blocked ? buildSubscriptionAccessNotice(access.status) : ""
  };
}

export const AssistantErrorNoticeCard: FC<{
  notice: string;
  rawDetail?: string;
}> = ({ notice, rawDetail }) => {
  const { t } = usePortalI18n();
  return (
    <div className="assistant-error-card" role="alert" aria-live="polite">
      <div className="assistant-error-card-head">
        <AlertCircleIcon size={16} aria-hidden="true" />
        <span>{t("thread.requestFailed")}</span>
      </div>
      <p>{notice || t("thread.errorGeneric")}</p>
      {rawDetail && rawDetail !== notice ? <span className="assistant-error-card-detail">{shorten(rawDetail, 260)}</span> : null}
    </div>
  );
};

export const PortalAccessBlockedBanner: FC<{ status: PortalSubscriptionStatus; onOpenBilling?: () => void }> = ({ status, onOpenBilling }) => {
  const { t } = usePortalI18n();
  return (
    <div className="thread-access-banner" role="alert" aria-live="polite">
      <div className="thread-access-banner-head">
        <AlertCircleIcon size={18} aria-hidden="true" />
        <strong>{status.title || t("thread.requestFailed")}</strong>
      </div>
      <p>{status.detail || t("thread.sendFailed")}</p>
      {status.cycleEndsAt || (onOpenBilling && status.actionLabel) ? (
        <p className="thread-access-banner-meta">
          {[buildSubscriptionResetLine(status), onOpenBilling ? status.actionLabel : null].filter(Boolean).join(" ")}
        </p>
      ) : null}
      {onOpenBilling ? (
        <Button size="small" type="primary" icon={<CreditCardIcon size={15} />} onClick={onOpenBilling}>
          {t("access.renew")}
        </Button>
      ) : null}
    </div>
  );
};

export const PortalSubscriptionReminderBanner: FC<{ status: PortalSubscriptionStatus; onOpenBilling: () => void }> = ({ status, onOpenBilling }) => {
  const { intlLocale, t } = usePortalI18n();
  const days = daysUntilSubscriptionExpiry(status);
  return (
    <div className="thread-access-banner thread-access-banner-subscription" role="status" aria-live="polite">
      <div className="thread-access-banner-head">
        <CreditCardIcon size={18} aria-hidden="true" />
        <strong>{days === null ? status.title : days <= 0 ? t("access.expiresToday") : t("access.expiresDays", { days })}</strong>
      </div>
      <p>{status.expiresAt ? t("access.endsAt", { date: new Date(status.expiresAt).toLocaleString(intlLocale) }) : status.summary}</p>
      <Button size="small" type="primary" icon={<CreditCardIcon size={15} />} onClick={onOpenBilling}>
        {t("access.chooseRenewal")}
      </Button>
    </div>
  );
};

export type PortalBillingReturnNotice = {
  tone: "success" | "warning";
  title: string;
  detail: string;
};

export const PortalBillingReturnBanner: FC<{
  notice: PortalBillingReturnNotice;
  onOpenBilling: () => void;
  onDismiss: () => void;
}> = ({ notice, onOpenBilling, onDismiss }) => {
  const { t } = usePortalI18n();
  return (
    <div className={`thread-access-banner thread-access-banner-billing-${notice.tone}`} role="status" aria-live="polite">
    <div className="thread-access-banner-head">
      {notice.tone === "success" ? <CheckIcon size={18} aria-hidden="true" /> : <AlertCircleIcon size={18} aria-hidden="true" />}
      <strong>{notice.title}</strong>
    </div>
    <p>{notice.detail}</p>
    <div className="thread-access-banner-actions">
      <Button size="small" type="primary" icon={<CreditCardIcon size={15} />} onClick={onOpenBilling}>
        {t("access.reviewBilling")}
      </Button>
      <Button size="small" type="text" onClick={onDismiss}>
        {t("access.dismiss")}
      </Button>
    </div>
    </div>
  );
};

export const PortalInlineErrorBanner: FC<{ message: string }> = ({ message }) => {
  const { t } = usePortalI18n();
  const normalized = message.trim();
  if (!normalized) return null;
  return (
    <div className="thread-access-banner thread-access-banner-secondary" role="alert" aria-live="polite">
      <div className="thread-access-banner-head">
        <AlertCircleIcon size={18} aria-hidden="true" />
        <strong>{t("thread.sendFailed")}</strong>
      </div>
      <p>{normalized}</p>
    </div>
  );
};
