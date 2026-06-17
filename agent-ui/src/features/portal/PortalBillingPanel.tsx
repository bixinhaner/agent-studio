import { Alert, Button, Input, Radio, Space, Spin, Switch, Tag } from "antd";
import { CheckCircle2, CreditCard, Gift, RefreshCw, ShieldCheck, TicketPercent, TrendingUp } from "lucide-react";
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

type BillingCycle = "month" | "year";

type PortalPlanGroup = {
  key: string;
  title: string;
  subtitle: string;
  monthly: PortalBillingPlan | null;
  annual: PortalBillingPlan | null;
  other: PortalBillingPlan[];
  limit: number | null;
  sortOrder: number;
};

function planCycleLabel(plan: PortalBillingPlan): string {
  const count = plan.billingIntervalCount > 1 ? `${plan.billingIntervalCount} ` : "";
  return `${count}${plan.billingInterval}${plan.billingIntervalCount > 1 ? "s" : ""}`;
}

function planCycleKey(plan?: PortalBillingPlan | null): BillingCycle | null {
  if (!plan) return null;
  if (plan.billingInterval === "year" && plan.billingIntervalCount === 1) return "year";
  if (plan.billingInterval === "month" && plan.billingIntervalCount === 1) return "month";
  return null;
}

function standardTierKey(plan: PortalBillingPlan): { key: string; title: string; subtitle: string; sortOrder: number } {
  const input = `${plan.slug} ${plan.name}`.toLowerCase();
  if (input.includes("plus")) {
    return {
      key: "plus",
      title: "Plus",
      subtitle: "For teams starting recurring AI operations.",
      sortOrder: 1
    };
  }
  if (input.includes("pro")) {
    return {
      key: "pro",
      title: "Pro",
      subtitle: "For heavier monthly automation and support volume.",
      sortOrder: 2
    };
  }
  return {
    key: plan.id,
    title: plan.name,
    subtitle: plan.description || `${plan.durationDays} days prepaid access`,
    sortOrder: 20
  };
}

function groupPortalPlans(plans: PortalBillingPlan[]): PortalPlanGroup[] {
  const groups = new Map<string, PortalPlanGroup>();
  for (const plan of plans) {
    const tier = standardTierKey(plan);
    const current = groups.get(tier.key) ?? {
      key: tier.key,
      title: tier.title,
      subtitle: tier.subtitle,
      monthly: null,
      annual: null,
      other: [],
      limit: null,
      sortOrder: tier.sortOrder
    };
    current.limit = current.limit ?? plan.monthlyCompletedTurnLimit ?? null;
    const cycle = planCycleKey(plan);
    if (cycle === "month") current.monthly = plan;
    else if (cycle === "year") current.annual = plan;
    else current.other.push(plan);
    groups.set(tier.key, current);
  }
  return [...groups.values()].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    const aPrice = a.monthly?.billingPriceCents ?? a.annual?.billingPriceCents ?? Number.MAX_SAFE_INTEGER;
    const bPrice = b.monthly?.billingPriceCents ?? b.annual?.billingPriceCents ?? Number.MAX_SAFE_INTEGER;
    return aPrice - bPrice;
  });
}

function planForCycle(group: PortalPlanGroup | null | undefined, cycle: BillingCycle): PortalBillingPlan | null {
  if (!group) return null;
  return cycle === "year"
    ? group.annual ?? group.monthly ?? group.other[0] ?? null
    : group.monthly ?? group.annual ?? group.other[0] ?? null;
}

function defaultSelection(summary: PortalBillingSummary | null): { tier: string; cycle: BillingCycle } {
  const groups = groupPortalPlans(summary?.plans ?? []);
  const currentPlanId = summary?.currentGrant?.planId;
  if (currentPlanId) {
    const currentGroup = groups.find((group) =>
      [group.monthly, group.annual, ...group.other].some((plan) => plan?.id === currentPlanId)
    );
    const currentPlan = currentGroup ? [currentGroup.monthly, currentGroup.annual, ...currentGroup.other].find((plan) => plan?.id === currentPlanId) : null;
    if (currentGroup) return { tier: currentGroup.key, cycle: planCycleKey(currentPlan ?? null) ?? "year" };
  }
  const plus = groups.find((group) => group.key === "plus");
  const preferred = plus ?? groups[0];
  return { tier: preferred?.key ?? "", cycle: preferred?.annual ? "year" : "month" };
}

function annualSavingsLabel(group: PortalPlanGroup | null | undefined): string {
  if (!group?.monthly || !group.annual) return "";
  const savings = (group.monthly.billingPriceCents ?? 0) * 12 - (group.annual.billingPriceCents ?? 0);
  return savings > 0 ? `${formatMoney(savings, group.annual.billingCurrency)} less than monthly` : "";
}

function usageLabel(limit?: number | null): string {
  return limit ? `${limit.toLocaleString()} AI requests / month` : "Usage limit configured by agreement";
}

function displayPlanName(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) return "No paid plan";
  return normalized.replace(/\bPlus Class\b/g, "Plus").replace(/\bPRO\b/g, "Pro");
}

function planDescription(group: PortalPlanGroup, plan: PortalBillingPlan | null): string {
  if (!plan) return group.subtitle;
  if (group.key === "plus" || group.key === "pro") {
    const interval = plan.billingInterval === "year" ? "annual" : plan.billingInterval === "month" ? "monthly" : planCycleLabel(plan);
    return `${group.title} · ${usageLabel(group.limit)} · ${interval} prepaid access`;
  }
  return plan.description || group.subtitle;
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

export function PortalBillingPanel(props: {
  subscriptionStatus: PortalSubscriptionStatus | null;
  onSubscriptionStatusChange?: (status: PortalSubscriptionStatus | null) => void;
  onClose?: () => void;
}) {
  const [summary, setSummary] = useState<PortalBillingSummary | null>(null);
  const [selectedTier, setSelectedTier] = useState("");
  const [billingCycle, setBillingCycle] = useState<BillingCycle | "">("");
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
      const nextDefault = defaultSelection(response.billing);
      setSelectedTier((current) => current || nextDefault.tier);
      setBillingCycle((current) => current || nextDefault.cycle);
      setAutoRenew(true);
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

  const planGroups = useMemo(() => groupPortalPlans(summary?.plans ?? []), [summary?.plans]);
  const activeCycle: BillingCycle = billingCycle || "year";
  const selectedGroup = useMemo(() => {
    return planGroups.find((group) => group.key === selectedTier) ?? planGroups[0] ?? null;
  }, [planGroups, selectedTier]);
  const selectedPlan = useMemo(() => planForCycle(selectedGroup, activeCycle), [activeCycle, selectedGroup]);
  const payableNow = Math.max(0, (selectedPlan?.billingPriceCents ?? 0) - (promotionPreview?.discountCents ?? 0));
  const giftDays = promotionPreview?.giftDays ?? 0;
  const nextRenewalDate = selectedPlan
    ? new Date(Date.now() + (selectedPlan.durationDays + giftDays) * 24 * 60 * 60 * 1000).toISOString()
    : null;
  const annualSavings = activeCycle === "year" ? annualSavingsLabel(selectedGroup) : "";
  const paidCheckoutUnavailable = payableNow > 0 && !summary?.defaults.stripeReady;

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
    if (paidCheckoutUnavailable) {
      setErrorText("Secure payment is not ready yet. Please contact your Agent Studio owner.");
      return;
    }
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

      <section className="portal-billing-section portal-billing-current">
        <div className="portal-billing-section-title">
          <CheckCircle2 size={16} />
          <span>Current access</span>
          <Tag color={statusTone(summary.currentGrant?.status)}>{summary.currentGrant?.status ?? "not_open"}</Tag>
        </div>
        <div className="portal-billing-facts">
          <div>
            <span>Plan</span>
            <strong>{displayPlanName(summary.currentGrant?.planName)}</strong>
          </div>
          <div>
            <span>Expires</span>
            <strong>{formatLocalTime(summary.currentGrant?.expiresAt)}</strong>
          </div>
        </div>
      </section>

      <section className="portal-billing-section portal-billing-plan-picker">
        <div className="portal-billing-section-title">
          <CreditCard size={16} />
          <span>Choose access</span>
        </div>
        <Radio.Group
          className="portal-billing-cycle-toggle"
          optionType="button"
          buttonStyle="solid"
          value={activeCycle}
          onChange={(event) => {
            setBillingCycle(event.target.value as BillingCycle);
            setPromotionPreview(null);
          }}
        >
          <Radio.Button value="month">Monthly</Radio.Button>
          <Radio.Button value="year">Annual</Radio.Button>
        </Radio.Group>

        <div className="portal-billing-plan-grid">
          {planGroups.map((group) => {
            const plan = planForCycle(group, activeCycle);
            const isSelected = selectedGroup?.key === group.key;
            const savings = activeCycle === "year" ? annualSavingsLabel(group) : "";
            return (
              <button
                key={group.key}
                type="button"
                className={isSelected ? "portal-billing-plan-card selected" : "portal-billing-plan-card"}
                onClick={() => {
                  setSelectedTier(group.key);
                  setPromotionPreview(null);
                }}
              >
                <span className="portal-billing-plan-card-head">
                  <strong>{group.title}</strong>
                  <Tag color={group.key === "pro" ? "processing" : "success"}>{group.key === "pro" ? "Higher volume" : "Core"}</Tag>
                </span>
                <span className="portal-billing-plan-card-price">
                  {plan ? formatMoney(plan.billingPriceCents, plan.billingCurrency) : "Not configured"}
                  {plan ? <small> / {planCycleLabel(plan)}</small> : null}
                </span>
                <span className="portal-billing-plan-card-copy">{usageLabel(group.limit)}</span>
                <span className="portal-billing-plan-card-copy">{planDescription(group, plan)}</span>
                {savings ? <span className="portal-billing-plan-saving">{savings}</span> : null}
              </button>
            );
          })}
        </div>
        {!planGroups.length ? <Alert type="warning" showIcon message="No active billing plan is available yet." /> : null}
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
          <ShieldCheck size={16} />
          <span>Checkout summary</span>
        </div>
        {paidCheckoutUnavailable ? (
          <Alert type="warning" showIcon message="Secure payment is not configured for this workspace yet." />
        ) : null}
        <div className="portal-billing-summary-row">
          <span>Selected plan</span>
          <strong>{selectedGroup?.title ?? "No plan"} · {activeCycle === "year" ? "Annual" : "Monthly"}</strong>
        </div>
        <div className="portal-billing-summary-row">
          <span>Pay now</span>
          <strong>{formatMoney(payableNow, selectedPlan?.billingCurrency)}</strong>
        </div>
        {promotionPreview?.discountCents ? (
          <div className="portal-billing-summary-row positive">
            <span>Promotion</span>
            <strong>-{formatMoney(promotionPreview.discountCents, selectedPlan?.billingCurrency)}</strong>
          </div>
        ) : null}
        {annualSavings ? (
          <div className="portal-billing-summary-row positive">
            <span>Annual value</span>
            <strong>{annualSavings}</strong>
          </div>
        ) : null}
        <div className="portal-billing-summary-row">
          <span>Included access</span>
          <strong>{(selectedPlan?.durationDays ?? 0) + giftDays} days</strong>
        </div>
        <div className="portal-billing-summary-row">
          <span>Next renewal</span>
          <strong>{autoRenew ? formatLocalTime(nextRenewalDate) : "Off"}</strong>
        </div>
        <label className="portal-billing-auto-renew-line">
          <Switch size="small" checked={autoRenew} onChange={setAutoRenew} />
          <span>
            <strong>Keep access active</strong>
            <small>Auto-renew is enabled by default. Stripe securely saves the card and renews this same plan after the prepaid period.</small>
          </span>
        </label>
        <Button
          type="primary"
          size="large"
          block
          className="portal-billing-checkout-button"
          loading={checkingOut}
          disabled={!selectedPlan || paidCheckoutUnavailable}
          onClick={() => void handleCheckout()}
        >
          Continue to secure payment
        </Button>
      </section>

      <section className="portal-billing-section portal-billing-account">
        <div className="portal-billing-section-title">
          <TrendingUp size={16} />
          <span>Identified account</span>
        </div>
        <p className="portal-billing-muted">We use the trial account information already on file for renewal and internal sales tracking.</p>
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
