import { Alert, Button, Input, Radio, Space, Spin, Tag } from "antd";
import { CheckCircle2, ChevronDown, ChevronUp, CreditCard, Gift, RefreshCw, ShieldCheck } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  billingCycleForPlan,
  groupBillingPlans,
  planForBillingCycle,
  recommendedBillingPlanFamily,
  type BillingCycle,
  type BillingPlanFamily
} from "../billing/plan-presentation";
import {
  createPortalBillingCheckout,
  fetchPortalBillingSummary,
  previewPortalPromotion,
  type PortalBillingPlan,
  type PortalBillingSummary,
  type PortalPromotionPreview,
  type PortalSubscriptionStatus
} from "./api";

function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format((cents ?? 0) / 100);
}

type PortalPlanGroup = BillingPlanFamily<PortalBillingPlan>;

function planCycleLabel(plan: PortalBillingPlan): string {
  const count = plan.billingIntervalCount > 1 ? `${plan.billingIntervalCount} ` : "";
  return `${count}${plan.billingInterval}${plan.billingIntervalCount > 1 ? "s" : ""}`;
}

function groupPortalPlans(plans: PortalBillingPlan[]): PortalPlanGroup[] {
  return groupBillingPlans(plans);
}

function planForCycle(group: PortalPlanGroup | null | undefined, cycle: BillingCycle): PortalBillingPlan | null {
  return planForBillingCycle(group, cycle);
}

function defaultSelection(summary: PortalBillingSummary | null): { tier: string; cycle: BillingCycle } {
  const groups = groupPortalPlans(summary?.plans ?? []);
  const currentPlanId = summary?.currentGrant?.planId;
  if (currentPlanId) {
    const currentGroup = groups.find((group) =>
      [group.monthly, group.annual, ...group.other].some((plan) => plan?.id === currentPlanId)
    );
    const currentPlan = currentGroup ? [currentGroup.monthly, currentGroup.annual, ...currentGroup.other].find((plan) => plan?.id === currentPlanId) : null;
    if (currentGroup) return { tier: currentGroup.key, cycle: billingCycleForPlan(currentPlan ?? null) ?? "year" };
  }
  const preferredCycle: BillingCycle = groups.some((group) => group.annual) ? "year" : "month";
  const preferred = recommendedBillingPlanFamily(groups, preferredCycle);
  return { tier: preferred?.key ?? "", cycle: preferredCycle };
}

function annualSavingsLabel(group: PortalPlanGroup | null | undefined): string {
  if (!group?.monthly || !group.annual) return "";
  const savings = (group.monthly.billingPriceCents ?? 0) * 12 - (group.annual.billingPriceCents ?? 0);
  return savings > 0 ? `${formatMoney(savings, group.annual.billingCurrency)} less than monthly` : "";
}

function usageLabel(limit?: number | null): string {
  return limit ? `${limit.toLocaleString()} conversations / month` : "Usage allowance configured by agreement";
}

function displayPlanName(value?: string | null): string {
  const normalized = value?.trim();
  if (!normalized) return "No paid plan";
  return normalized.replace(/\bPlus Class\b/g, "Plus").replace(/\bPRO\b/g, "Pro");
}

function planDifferentiator(index: number, count: number): string {
  if (index === 0) return "For getting started";
  if (index === count - 1) return "For high-volume operations";
  return "For growing support teams";
}

function formatLocalDate(value?: string | null): string {
  if (!value) return "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
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
  const [promotionOpen, setPromotionOpen] = useState(false);
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
  const availableCycles = useMemo<BillingCycle[]>(() => {
    const cycles = new Set<BillingCycle>();
    planGroups.forEach((group) => {
      if (group.monthly) cycles.add("month");
      if (group.annual) cycles.add("year");
    });
    const supportedCycles: BillingCycle[] = ["month", "year"];
    return supportedCycles.filter((cycle) => cycles.has(cycle));
  }, [planGroups]);
  const defaultCycle = availableCycles.includes("year") ? "year" : availableCycles[0] ?? "year";
  const activeCycle: BillingCycle = billingCycle && availableCycles.includes(billingCycle) ? billingCycle : defaultCycle;
  const showCycleToggle = availableCycles.length > 1;
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
  const selectedPlanLabel = showCycleToggle
    ? `${selectedGroup?.title ?? "No plan"} · ${activeCycle === "year" ? "Annual" : "Monthly"}`
    : selectedGroup?.title ?? "No plan";
  const paidCheckoutUnavailable = payableNow > 0 && !summary?.defaults.stripeReady;
  const recommendedGroup = useMemo(
    () => recommendedBillingPlanFamily(planGroups, activeCycle),
    [activeCycle, planGroups]
  );

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
        <span className="portal-billing-current-icon" aria-hidden="true"><CheckCircle2 size={24} /></span>
        <div className="portal-billing-current-copy">
          <strong>{displayPlanName(summary.currentGrant?.planName)}</strong>
          <Tag color={statusTone(summary.currentGrant?.status)}>{summary.currentGrant?.status ?? "not_open"}</Tag>
          <span>{/trial/i.test(summary.currentGrant?.planName ?? "") ? "Trial ends" : "Access ends"} {formatLocalDate(summary.currentGrant?.expiresAt)}</span>
        </div>
      </section>

      <section className="portal-billing-section portal-billing-plan-picker">
        <div className="portal-billing-section-title">
          <CreditCard size={16} />
          <span>Choose your plan</span>
        </div>
        {showCycleToggle ? (
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
            {availableCycles.includes("month") ? <Radio.Button value="month">Monthly</Radio.Button> : null}
            {availableCycles.includes("year") ? <Radio.Button value="year">Annual</Radio.Button> : null}
          </Radio.Group>
        ) : null}

        <div className="portal-billing-plan-grid" role="radiogroup" aria-label="Annual plan">
          {planGroups.map((group, index) => {
            const plan = planForCycle(group, activeCycle);
            const isSelected = selectedGroup?.key === group.key;
            const isRecommended = recommendedGroup?.key === group.key;
            return (
              <button
                key={group.key}
                type="button"
                className={isSelected ? "portal-billing-plan-card selected" : "portal-billing-plan-card"}
                role="radio"
                aria-checked={isSelected}
                onClick={() => {
                  setSelectedTier(group.key);
                  setPromotionPreview(null);
                }}
              >
                <span className="portal-billing-plan-radio" aria-hidden="true"><span /></span>
                <span className="portal-billing-plan-card-head">
                  <strong>{group.title}</strong>
                  {isRecommended ? <Tag color="orange">Recommended</Tag> : null}
                </span>
                <span className="portal-billing-plan-card-price">
                  {plan ? formatMoney(plan.billingPriceCents, plan.billingCurrency) : "Not configured"}
                  {plan ? <small> / {planCycleLabel(plan)}</small> : null}
                </span>
                <span className="portal-billing-plan-card-copy">{usageLabel(group.limit)}</span>
                <span className="portal-billing-plan-card-copy">{planDifferentiator(index, planGroups.length)}</span>
              </button>
            );
          })}
        </div>
        {!planGroups.length ? <Alert type="warning" showIcon message="No active billing plan is available yet." /> : null}
      </section>

      <section className="portal-billing-section portal-billing-checkout">
        <div className="portal-billing-section-title">
          <ShieldCheck size={16} />
          <span>Order summary</span>
        </div>
        {paidCheckoutUnavailable ? (
          <Alert type="warning" showIcon message="Secure payment is not configured for this workspace yet." />
        ) : null}
        <span className="portal-billing-order-plan">{selectedPlanLabel}</span>
        <strong className="portal-billing-order-total">Due today {formatMoney(payableNow, selectedPlan?.billingCurrency)}</strong>
        <span className="portal-billing-order-duration">{(selectedPlan?.durationDays ?? 0) + giftDays >= 365 ? "1 year" : `${(selectedPlan?.durationDays ?? 0) + giftDays} days`} of access</span>
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
        <fieldset className="portal-billing-renewal-options">
          <legend>Choose how to renew</legend>
          <Radio.Group value={autoRenew ? "auto" : "one-time"} onChange={(event) => setAutoRenew(event.target.value === "auto")}>
            <Radio value="one-time">
              <span className="portal-billing-renewal-copy"><strong>One-time annual access</strong></span>
            </Radio>
            <Radio value="auto">
              <span className="portal-billing-renewal-copy">
                <strong>Auto-renew annually</strong>
                <small>Renews at {formatMoney(selectedPlan?.billingPriceCents, selectedPlan?.billingCurrency)} on {formatLocalDate(nextRenewalDate)}</small>
              </span>
            </Radio>
          </Radio.Group>
        </fieldset>
        <Button
          type="primary"
          size="large"
          block
          className="portal-billing-checkout-button"
          loading={checkingOut}
          disabled={!selectedPlan || paidCheckoutUnavailable}
          onClick={() => void handleCheckout()}
        >
          Continue to secure payment · {formatMoney(payableNow, selectedPlan?.billingCurrency)}
        </Button>
        <button
          type="button"
          className="portal-billing-promotion-toggle"
          aria-expanded={promotionOpen}
          onClick={() => setPromotionOpen((current) => !current)}
        >
          <span>Have a promotion code?</span>
          {promotionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {promotionOpen ? (
          <div className="portal-billing-promotion-form">
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
          </div>
        ) : null}
      </section>

      <footer className="portal-billing-account">
        <span>Billing account</span>
        <strong>{summary.billingCustomer.companyName || summary.organization.name}</strong>
        <small>{summary.billingCustomer.businessEmail || summary.billingCustomer.billingEmail || "Billing email not set"}</small>
      </footer>
    </div>
  );
}
