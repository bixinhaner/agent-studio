import { Alert, Button, Input, Radio, Space, Spin, Switch, Tag } from "antd";
import { CheckCircle2, CreditCard, Gift, RefreshCw, TicketPercent } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  createPortalBillingCheckout,
  fetchPortalBillingSummary,
  previewPortalPromotion,
  type PortalBillingPlan,
  type PortalBillingSummary,
  type PortalPromotionPreview,
  type PortalSubscriptionStatus
} from "./api";

function formatLocalTime(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleString()} local time`;
}

function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format((cents ?? 0) / 100);
}

function planCycle(plan: PortalBillingPlan): string {
  const count = plan.billingIntervalCount > 1 ? `${plan.billingIntervalCount} ` : "";
  return `${count}${plan.billingInterval}${plan.billingIntervalCount > 1 ? "s" : ""}`;
}

function statusTone(status?: string | null): string {
  switch (status) {
    case "active":
    case "enabled":
    case "paid":
      return "success";
    case "payment_failed":
    case "expired":
    case "failed":
      return "error";
    case "pending_payment":
      return "processing";
    default:
      return "default";
  }
}

function defaultPlanId(summary: PortalBillingSummary | null): string {
  if (!summary) return "";
  const currentPlanId = summary.currentGrant?.planId;
  if (currentPlanId && summary.plans.some((plan) => plan.id === currentPlanId)) return currentPlanId;
  return summary.plans[0]?.id ?? "";
}

export function PortalBillingPanel(props: {
  subscriptionStatus: PortalSubscriptionStatus | null;
  onSubscriptionStatusChange?: (status: PortalSubscriptionStatus | null) => void;
  onClose?: () => void;
}) {
  const [summary, setSummary] = useState<PortalBillingSummary | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState("");
  const [autoRenew, setAutoRenew] = useState(true);
  const [promotionCode, setPromotionCode] = useState("");
  const [promotionPreview, setPromotionPreview] = useState<PortalPromotionPreview | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [checkingPromotion, setCheckingPromotion] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");

  async function loadSummary(silent = false) {
    if (!silent) setLoading(true);
    setRefreshing(silent);
    setErrorText("");
    try {
      const response = await fetchPortalBillingSummary();
      setSummary(response.billing);
      props.onSubscriptionStatusChange?.(response.subscriptionStatus);
      setSelectedPlanId((current) => current || defaultPlanId(response.billing));
      setAutoRenew((current) => current || response.billing.defaults.autoRenew);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Failed to load billing details");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadSummary();
  }, []);

  const selectedPlan = useMemo(() => summary?.plans.find((plan) => plan.id === selectedPlanId) ?? null, [selectedPlanId, summary?.plans]);
  const payableNow = Math.max(0, (selectedPlan?.billingPriceCents ?? 0) - (promotionPreview?.discountCents ?? 0));
  const giftDays = promotionPreview?.giftDays ?? 0;
  const nextRenewalDate = selectedPlan
    ? new Date(Date.now() + (selectedPlan.durationDays + giftDays) * 24 * 60 * 60 * 1000).toISOString()
    : null;

  async function handlePreviewPromotion() {
    if (!selectedPlan || !promotionCode.trim()) {
      setPromotionPreview(null);
      return;
    }
    setCheckingPromotion(true);
    setErrorText("");
    try {
      const preview = await previewPortalPromotion({ planId: selectedPlan.id, code: promotionCode });
      setPromotionPreview(preview);
      setSuccessText(preview.message || "Promotion applied");
    } catch (error) {
      setPromotionPreview(null);
      setErrorText(error instanceof Error ? error.message : "Promotion code is not available");
    } finally {
      setCheckingPromotion(false);
    }
  }

  async function handleCheckout() {
    if (!selectedPlan) return;
    setCheckingOut(true);
    setErrorText("");
    try {
      const result = await createPortalBillingCheckout({
        planId: selectedPlan.id,
        promotionCode: promotionCode.trim() || undefined,
        autoRenew
      });
      if (result.checkoutUrl) {
        window.location.href = result.checkoutUrl;
        return;
      }
      setSuccessText("Subscription updated.");
      await loadSummary(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "Checkout could not be started");
    } finally {
      setCheckingOut(false);
    }
  }

  if (loading) {
    return (
      <div className="portal-billing-panel loading">
        <Spin />
      </div>
    );
  }

  if (!summary) {
    return (
      <div className="portal-billing-panel">
        <Alert type="error" showIcon message={errorText || "Billing details are unavailable"} />
      </div>
    );
  }

  return (
    <div className="portal-billing-panel">
      <div className="portal-billing-head">
        <div>
          <span>Subscription & renewal</span>
          <h2>{summary.organization.name}</h2>
          <p>{summary.billingCustomer.businessEmail || summary.billingCustomer.billingEmail || "Billing email not set"}</p>
        </div>
        <Button type="text" icon={<RefreshCw size={16} />} loading={refreshing} onClick={() => void loadSummary(true)} aria-label="Refresh billing" />
      </div>

      {props.subscriptionStatus?.accessState === "blocked" ? (
        <Alert
          type="error"
          showIcon
          message={props.subscriptionStatus.title}
          description={props.subscriptionStatus.detail}
        />
      ) : props.subscriptionStatus?.tone === "caution" ? (
        <Alert
          type="warning"
          showIcon
          message={props.subscriptionStatus.title}
          description={props.subscriptionStatus.summary}
        />
      ) : null}
      {errorText ? <Alert type="error" showIcon message={errorText} closable onClose={() => setErrorText("")} /> : null}
      {successText ? <Alert type="success" showIcon message={successText} closable onClose={() => setSuccessText("")} /> : null}

      <section className="portal-billing-section">
        <div className="portal-billing-section-title">
          <CheckCircle2 size={16} />
          <span>Current access</span>
          <Tag color={statusTone(summary.currentGrant?.status)}>{summary.currentGrant?.status ?? "not_open"}</Tag>
        </div>
        <div className="portal-billing-facts">
          <div>
            <span>Plan</span>
            <strong>{summary.currentGrant?.planName ?? "No paid plan"}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{formatLocalTime(summary.currentGrant?.expiresAt)}</strong>
          </div>
          <div>
            <span>Auto-renew</span>
            <strong>{summary.autoRenewal?.status ?? "not enabled"}</strong>
          </div>
        </div>
      </section>

      <section className="portal-billing-section">
        <div className="portal-billing-section-title">
          <CreditCard size={16} />
          <span>Choose plan</span>
        </div>
        <Radio.Group className="portal-billing-plan-list" value={selectedPlanId} onChange={(event) => {
          setSelectedPlanId(event.target.value);
          setPromotionPreview(null);
        }}>
          {summary.plans.map((plan) => (
            <Radio.Button key={plan.id} value={plan.id} className="portal-billing-plan-option">
              <span>
                <strong>{plan.name}</strong>
                <small>{plan.description || `${plan.durationDays} days prepaid access`}</small>
              </span>
              <b>{formatMoney(plan.billingPriceCents, plan.billingCurrency)} / {planCycle(plan)}</b>
            </Radio.Button>
          ))}
        </Radio.Group>
      </section>

      <section className="portal-billing-section">
        <div className="portal-billing-section-title">
          <RefreshCw size={16} />
          <span>Automatic renewal</span>
          <Switch checked={autoRenew} onChange={setAutoRenew} />
        </div>
        <p className="portal-billing-muted">
          When enabled, Stripe securely saves the payment method and renews the same plan after the prepaid period. You can use one-time prepaid access by turning it off before checkout.
        </p>
      </section>

      <section className="portal-billing-section">
        <div className="portal-billing-section-title">
          <TicketPercent size={16} />
          <span>Promotion code</span>
        </div>
        <Space.Compact style={{ width: "100%" }}>
          <Input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value)} placeholder="Enter promotion code" />
          <Button loading={checkingPromotion} onClick={() => void handlePreviewPromotion()}>Apply</Button>
        </Space.Compact>
        {promotionPreview?.message ? (
          <div className="portal-billing-promotion-applied">
            <Gift size={16} />
            <span>{promotionPreview.message}</span>
          </div>
        ) : null}
      </section>

      <section className="portal-billing-section portal-billing-checkout">
        <div className="portal-billing-section-title">
          <CreditCard size={16} />
          <span>Checkout summary</span>
        </div>
        <div className="portal-billing-summary-row">
          <span>Pay now</span>
          <strong>{formatMoney(payableNow, selectedPlan?.billingCurrency)}</strong>
        </div>
        <div className="portal-billing-summary-row">
          <span>Included access</span>
          <strong>{(selectedPlan?.durationDays ?? 0) + giftDays} days</strong>
        </div>
        <div className="portal-billing-summary-row">
          <span>Next renewal</span>
          <strong>{autoRenew ? formatLocalTime(nextRenewalDate) : "Off"}</strong>
        </div>
        <Button type="primary" size="large" block loading={checkingOut} disabled={!selectedPlan} onClick={() => void handleCheckout()}>
          Continue to secure payment
        </Button>
      </section>

      <section className="portal-billing-section">
        <div className="portal-billing-section-title">
          <span>Identified account</span>
        </div>
        <div className="portal-billing-identity-grid">
          <span>Company</span><strong>{summary.billingCustomer.companyName || summary.organization.name}</strong>
          <span>Contact</span><strong>{summary.billingCustomer.contactName || "Not recorded"}</strong>
          <span>Country / region</span><strong>{summary.billingCustomer.countryRegion || "Not recorded"}</strong>
          <span>SN</span><strong>{summary.billingCustomer.sn || "Not recorded"}</strong>
          <span>Sales contact</span><strong>{summary.billingCustomer.salesContact || "Not recorded"}</strong>
        </div>
      </section>
    </div>
  );
}
