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
import { usePortalI18n, type PortalLocale } from "./i18n";

function formatMoney(cents: number | null | undefined, currency: string | null | undefined, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format((cents ?? 0) / 100);
}

type PortalPlanGroup = BillingPlanFamily<PortalBillingPlan>;

function planCycleLabel(plan: PortalBillingPlan, locale: PortalLocale): string {
  const count = plan.billingIntervalCount > 1 ? `${plan.billingIntervalCount} ` : "";
  if (locale === "zh-CN") {
    return `${count}${plan.billingInterval === "year" ? "年" : plan.billingInterval === "month" ? "月" : plan.billingInterval}`;
  }
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

function annualSavingsLabel(group: PortalPlanGroup | null | undefined, locale: PortalLocale, intlLocale: string): string {
  if (!group?.monthly || !group.annual) return "";
  const savings = (group.monthly.billingPriceCents ?? 0) * 12 - (group.annual.billingPriceCents ?? 0);
  if (savings <= 0) return "";
  const amount = formatMoney(savings, group.annual.billingCurrency, intlLocale);
  return locale === "zh-CN" ? `比按月支付节省 ${amount}` : `${amount} less than monthly`;
}

function usageLabel(limit: number | null | undefined, locale: PortalLocale, intlLocale: string): string {
  if (!limit) return locale === "zh-CN" ? "使用额度按协议配置" : "Usage allowance configured by agreement";
  const count = limit.toLocaleString(intlLocale);
  return locale === "zh-CN" ? `每月 ${count} 次会话` : `${count} conversations / month`;
}

function displayPlanName(value: string | null | undefined, locale: PortalLocale): string {
  const normalized = value?.trim();
  if (!normalized) return locale === "zh-CN" ? "无付费套餐" : "No paid plan";
  return normalized.replace(/\bPlus Class\b/g, "Plus").replace(/\bPRO\b/g, "Pro");
}

function planDifferentiator(index: number, count: number, locale: PortalLocale): string {
  if (index === 0) return locale === "zh-CN" ? "适合初次使用" : "For getting started";
  if (index === count - 1) return locale === "zh-CN" ? "适合高频业务" : "For high-volume operations";
  return locale === "zh-CN" ? "适合成长中的支持团队" : "For growing support teams";
}

function formatLocalDate(value: string | null | undefined, locale: PortalLocale, intlLocale: string): string {
  if (!value) return locale === "zh-CN" ? "未设置" : "Not set";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString(intlLocale, { year: "numeric", month: "short", day: "numeric" });
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
  const { locale, intlLocale, t } = usePortalI18n();
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
      setErrorText(error instanceof Error ? error.message : t("billing.loadFailed"));
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
  const annualSavings = activeCycle === "year" ? annualSavingsLabel(selectedGroup, locale, intlLocale) : "";
  const selectedPlanLabel = showCycleToggle
    ? `${selectedGroup?.title ?? t("billing.noPlanShort")} · ${activeCycle === "year" ? t("billing.annual") : t("billing.monthly")}`
    : selectedGroup?.title ?? t("billing.noPlanShort");
  const paidCheckoutUnavailable = payableNow > 0 && (!summary?.defaults.stripeReady || summary?.brand?.paymentReady === false);
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
      setSuccessText(preview.message || t("billing.promotionApplied"));
    } catch (error) {
      setPromotionPreview(null);
      setErrorText(error instanceof Error ? error.message : t("billing.promotionFailed"));
    } finally {
      setCheckingPromotion(false);
    }
  }

  async function handleCheckout() {
    if (!selectedPlan) return;
    if (paidCheckoutUnavailable) {
      setErrorText(t("billing.paymentNotReady"));
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
      setSuccessText(t("billing.subscriptionUpdated"));
      await loadSummary(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : t("billing.checkoutFailed"));
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
        <Alert type="error" showIcon message={errorText || t("billing.unavailable")} />
      </div>
    );
  }

  return (
    <div className="portal-billing-panel">
      <div className="portal-billing-head">
        <div>
          <span>{t("billing.subscriptionRenewal")}</span>
          <h2>{summary.organization.name}</h2>
          <p>{summary.billingCustomer.businessEmail || summary.billingCustomer.billingEmail || t("billing.emailNotSet")}</p>
        </div>
        <Button type="text" icon={<RefreshCw size={16} />} loading={refreshing} onClick={() => void loadSummary(true)} aria-label={t("billing.refreshAria")} />
      </div>

      {summary.brand?.merchantName ? (
        <div className="portal-billing-merchant">
          <span>{t("billing.securePayment")}</span>
          <strong>{summary.brand.merchantName}</strong>
          {summary.brand.supportEmail ? <a href={`mailto:${summary.brand.supportEmail}`}>{summary.brand.supportEmail}</a> : null}
        </div>
      ) : null}

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
          <strong>{displayPlanName(summary.currentGrant?.planName, locale)}</strong>
          <Tag color={statusTone(summary.currentGrant?.status)}>{summary.currentGrant?.status ?? "not_open"}</Tag>
          <span>{/trial/i.test(summary.currentGrant?.planName ?? "") ? t("billing.trialEnds") : t("billing.accessEnds")} {formatLocalDate(summary.currentGrant?.expiresAt, locale, intlLocale)}</span>
        </div>
      </section>

      <section className="portal-billing-section portal-billing-plan-picker">
        <div className="portal-billing-section-title">
          <CreditCard size={16} />
          <span>{t("billing.choosePlan")}</span>
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
            {availableCycles.includes("month") ? <Radio.Button value="month">{t("billing.monthly")}</Radio.Button> : null}
            {availableCycles.includes("year") ? <Radio.Button value="year">{t("billing.annual")}</Radio.Button> : null}
          </Radio.Group>
        ) : null}

        <div className="portal-billing-plan-grid" role="radiogroup" aria-label={t("billing.choosePlan")}>
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
                  {isRecommended ? <Tag color="orange">{t("billing.recommended")}</Tag> : null}
                </span>
                <span className="portal-billing-plan-card-price">
                  {plan ? formatMoney(plan.billingPriceCents, plan.billingCurrency, intlLocale) : t("billing.notConfigured")}
                  {plan ? <small> / {planCycleLabel(plan, locale)}</small> : null}
                </span>
                <span className="portal-billing-plan-card-copy">{usageLabel(group.limit, locale, intlLocale)}</span>
                <span className="portal-billing-plan-card-copy">{planDifferentiator(index, planGroups.length, locale)}</span>
              </button>
            );
          })}
        </div>
        {!planGroups.length ? <Alert type="warning" showIcon message={t("billing.noActivePlan")} /> : null}
      </section>

      <section className="portal-billing-section portal-billing-checkout">
        <div className="portal-billing-section-title">
          <ShieldCheck size={16} />
          <span>{t("billing.orderSummary")}</span>
        </div>
        {paidCheckoutUnavailable ? (
          <Alert type="warning" showIcon message={t("billing.paymentNotConfigured")} />
        ) : null}
        <span className="portal-billing-order-plan">{selectedPlanLabel}</span>
        <strong className="portal-billing-order-total">{t("billing.dueToday", { amount: formatMoney(payableNow, selectedPlan?.billingCurrency, intlLocale) })}</strong>
        <span className="portal-billing-order-duration">{(selectedPlan?.durationDays ?? 0) + giftDays >= 365 ? t("billing.accessYear") : t("billing.accessDays", { days: (selectedPlan?.durationDays ?? 0) + giftDays })}</span>
        {promotionPreview?.discountCents ? (
          <div className="portal-billing-summary-row positive">
            <span>{t("billing.promotionLabel")}</span>
            <strong>-{formatMoney(promotionPreview.discountCents, selectedPlan?.billingCurrency, intlLocale)}</strong>
          </div>
        ) : null}
        {annualSavings ? (
          <div className="portal-billing-summary-row positive">
            <span>{t("billing.annualValue")}</span>
            <strong>{annualSavings}</strong>
          </div>
        ) : null}
        <fieldset className="portal-billing-renewal-options">
          <legend>{t("billing.chooseRenewal")}</legend>
          <Radio.Group value={autoRenew ? "auto" : "one-time"} onChange={(event) => setAutoRenew(event.target.value === "auto")}>
            <Radio value="one-time">
              <span className="portal-billing-renewal-copy"><strong>{t("billing.oneTime")}</strong></span>
            </Radio>
            <Radio value="auto">
              <span className="portal-billing-renewal-copy">
                <strong>{t("billing.autoRenewAnnually")}</strong>
                <small>{t("billing.renewsAt", { amount: formatMoney(selectedPlan?.billingPriceCents, selectedPlan?.billingCurrency, intlLocale), date: formatLocalDate(nextRenewalDate, locale, intlLocale) })}</small>
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
          {t("billing.continuePayment", { amount: formatMoney(payableNow, selectedPlan?.billingCurrency, intlLocale) })}
        </Button>
        <button
          type="button"
          className="portal-billing-promotion-toggle"
          aria-expanded={promotionOpen}
          onClick={() => setPromotionOpen((current) => !current)}
        >
          <span>{t("billing.havePromotion")}</span>
          {promotionOpen ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
        </button>
        {promotionOpen ? (
          <div className="portal-billing-promotion-form">
            <Space.Compact style={{ width: "100%" }}>
              <Input value={promotionCode} onChange={(event) => setPromotionCode(event.target.value)} placeholder={t("billing.promotionPlaceholder")} />
              <Button loading={checkingPromotion} onClick={() => void handlePreviewPromotion()}>{t("billing.apply")}</Button>
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
        <span>{t("billing.account")}</span>
        <strong>{summary.billingCustomer.companyName || summary.organization.name}</strong>
        <small>{summary.billingCustomer.businessEmail || summary.billingCustomer.billingEmail || t("billing.emailNotSet")}</small>
      </footer>
    </div>
  );
}
