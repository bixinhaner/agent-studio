import {
  Alert,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip
} from "antd";
import type { ColumnsType } from "antd/es/table";
import {
  BadgeDollarSign,
  CalendarClock,
  Copy,
  CreditCard,
  Gift,
  KeyRound,
  Link2,
  Mail,
  Plus,
  RefreshCw,
  Search,
  Save,
  ShieldCheck,
  TicketPercent,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import {
  bindAdminBillingStripeCustomer,
  createAdminBillingPaymentLink,
  createAdminPromotionCode,
  fetchAdminBillingOverview,
  grantAdminBillingGiftDays,
  lookupAdminBillingStripeCustomer,
  patchAdminBillingEmailSettings,
  patchAdminBillingPlan,
  patchAdminBillingEmailRule,
  patchAdminBillingStripeSettings,
  patchAdminPromotionCode,
  runAdminBillingEmailReminderSweep
} from "./api";
import type {
  AdminBillingCustomerAccount,
  AdminBillingEmailRule,
  AdminBillingOverviewResponse,
  AdminBillingAutoRenewal,
  AdminBillingOrder,
  AdminBillingPlan,
  AdminPromotionCode
} from "./types";

type BillingTab = "overview" | "products" | "promotions" | "orders" | "auto-renewals" | "customers" | "email" | "stripe";

type PromotionFormState = {
  code: string;
  name: string;
  type: string;
  value: number;
  expiresAt: string;
  maxRedemptions: number | null;
  perCustomerLimit: number;
  eligiblePlanIds: string[];
  eligibleEmailDomains: string;
  note: string;
};

type GiftFormState = {
  organizationId: string;
  planId: string;
  days: number;
  reason: string;
};

type PaymentLinkFormState = {
  organizationId: string;
  planId: string;
  promotionCode: string;
  autoRenew: boolean;
};

type PlanBillingFormState = {
  billingStatus: string;
  billingCurrency: string;
  billingInterval: string;
  billingIntervalCount: number;
  billingPriceCents: number | null;
};

type BillingCycle = "month" | "year";

type AdminPlanGroup = {
  key: string;
  title: string;
  subtitle: string;
  monthly: AdminBillingPlan | null;
  annual: AdminBillingPlan | null;
  other: AdminBillingPlan[];
  limit: number | null;
  sortOrder: number;
};

type StripeSettingsFormState = {
  mode: string;
  stripeSecretKey: string;
  webhookSigningSecret: string;
  successUrl: string;
  cancelUrl: string;
  defaultCurrency: string;
  defaultAutoRenew: boolean;
  clearStripeSecretKey: boolean;
  clearWebhookSigningSecret: boolean;
};

function formatLocalTime(value?: string | null): string {
  if (!value) return "未设置";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function formatLocalDateInput(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function toIsoOrNull(value: string): string | null {
  if (!value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function formatMoney(cents: number | null | undefined, currency?: string | null): string {
  const amount = (cents ?? 0) / 100;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format(amount);
}

function statusColor(status?: string | null): string {
  switch (status) {
    case "active":
    case "paid":
    case "enabled":
    case "processed":
    case "sent":
      return "success";
    case "pending_payment":
    case "processing":
    case "trialing":
      return "processing";
    case "payment_failed":
    case "failed":
    case "expired":
      return "error";
    case "paused":
    case "draft":
      return "warning";
    case "canceled":
    case "disabled":
      return "default";
    default:
      return "default";
  }
}

function stripeLookupStatusColor(status?: string | null): string {
  switch (status) {
    case "matched":
      return "success";
    case "multiple":
      return "warning";
    case "error":
      return "error";
    case "not_found":
    case "skipped":
      return "default";
    default:
      return "default";
  }
}

function nextActionLabel(value: string): string {
  switch (value) {
    case "create_payment_link":
      return "创建付款链接";
    case "update_payment_method":
      return "更新支付方式";
    case "expired_renew_now":
      return "已过期，立即续费";
    case "expiring_review_renewal":
      return "临期，确认续费";
    case "waiting_for_payment":
      return "等待付款";
    default:
      return "观察";
  }
}

function planBillingLabel(plan?: AdminBillingPlan | null): string {
  if (!plan) return "未设置";
  const interval = plan.billingIntervalCount > 1 ? `${plan.billingIntervalCount} ${plan.billingInterval}s` : plan.billingInterval;
  return `${formatMoney(plan.billingPriceCents, plan.billingCurrency)} / ${interval}`;
}

function planCycleKey(plan?: AdminBillingPlan | null): BillingCycle | null {
  if (!plan) return null;
  if (plan.billingInterval === "month" && plan.billingIntervalCount === 1) return "month";
  if (plan.billingInterval === "year" && plan.billingIntervalCount === 1) return "year";
  return null;
}

function standardPlanTier(plan: AdminBillingPlan): { key: string; title: string; subtitle: string; sortOrder: number } {
  const input = `${plan.slug} ${plan.name}`.toLowerCase();
  if (input.includes("plus")) {
    return {
      key: "plus",
      title: "Plus Class",
      subtitle: "300 AI requests / month",
      sortOrder: 1
    };
  }
  if (input.includes("pro")) {
    return {
      key: "pro",
      title: "PRO",
      subtitle: "1000 AI requests / month",
      sortOrder: 2
    };
  }
  return {
    key: plan.id,
    title: plan.name,
    subtitle: plan.description || "Custom billing product",
    sortOrder: 20
  };
}

function groupAdminPlans(plans: AdminBillingPlan[]): AdminPlanGroup[] {
  const groups = new Map<string, AdminPlanGroup>();
  for (const plan of plans) {
    const tier = standardPlanTier(plan);
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
    return a.title.localeCompare(b.title);
  });
}

function planStatusTag(plan?: AdminBillingPlan | null) {
  if (!plan) return <Tag color="error">missing</Tag>;
  return <Tag color={statusColor(plan.billingStatus)}>{plan.billingStatus}</Tag>;
}

function createPromotionFormState(): PromotionFormState {
  return {
    code: "",
    name: "",
    type: "gift_days",
    value: 30,
    expiresAt: "",
    maxRedemptions: null,
    perCustomerLimit: 1,
    eligiblePlanIds: [],
    eligibleEmailDomains: "",
    note: ""
  };
}

function createGiftFormState(account?: AdminBillingCustomerAccount | null, planId?: string): GiftFormState {
  return {
    organizationId: account?.organization.id ?? "",
    planId: planId ?? account?.grant?.planId ?? "",
    days: 30,
    reason: ""
  };
}

function createPaymentLinkFormState(account?: AdminBillingCustomerAccount | null, planId?: string): PaymentLinkFormState {
  return {
    organizationId: account?.organization.id ?? "",
    planId: planId ?? account?.grant?.planId ?? "",
    promotionCode: "",
    autoRenew: true
  };
}

function createPlanBillingFormState(plan?: AdminBillingPlan | null): PlanBillingFormState {
  return {
    billingStatus: plan?.billingStatus ?? "not_configured",
    billingCurrency: plan?.billingCurrency ?? "usd",
    billingInterval: plan?.billingInterval ?? "month",
    billingIntervalCount: plan?.billingIntervalCount ?? 1,
    billingPriceCents: plan?.billingPriceCents ?? null
  };
}

function createStripeSettingsFormState(stripe?: AdminBillingOverviewResponse["stripe"] | null): StripeSettingsFormState {
  return {
    mode: stripe?.mode && stripe.mode !== "unknown" ? stripe.mode : "test",
    stripeSecretKey: "",
    webhookSigningSecret: "",
    successUrl: stripe?.successUrl ?? "",
    cancelUrl: stripe?.cancelUrl ?? "",
    defaultCurrency: stripe?.defaultCurrency ?? "usd",
    defaultAutoRenew: stripe?.defaultAutoRenew ?? true,
    clearStripeSecretKey: false,
    clearWebhookSigningSecret: false
  };
}

function stripeWebhookUrl(stripe?: AdminBillingOverviewResponse["stripe"] | null): string {
  const path = stripe?.webhookEndpointPath ?? "/api/integrations/stripe/webhook";
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

function OrderDetailPanel(props: { order: AdminBillingOrder; organizationName: string }) {
  const totalDays = props.order.durationDays + props.order.giftDays;
  return (
    <div className="admin-billing-drawer-stack">
      <div className="admin-billing-detail-grid">
        <div><span>Order</span><strong>{props.order.orderNumber}</strong></div>
        <div><span>Status</span><strong>{props.order.status}</strong></div>
        <div><span>Customer</span><strong>{props.organizationName}</strong></div>
        <div><span>Source</span><strong>{props.order.source}</strong></div>
      </div>
      <section className="admin-billing-detail-section">
        <h3>金额</h3>
        <p>原价：{formatMoney(props.order.amountSubtotalCents, props.order.currency)}</p>
        <p>优惠：{formatMoney(props.order.discountCents, props.order.currency)}</p>
        <p>实付：{formatMoney(props.order.amountTotalCents, props.order.currency)}</p>
      </section>
      <section className="admin-billing-detail-section">
        <h3>权益生效</h3>
        <p>付费时长：{props.order.durationDays} days</p>
        <p>赠送时长：{props.order.giftDays} days</p>
        <p>总时长：{totalDays} days</p>
        <p>开始：{formatLocalTime(props.order.entitlementStartsAt)}</p>
        <p>到期：{formatLocalTime(props.order.entitlementExpiresAt)}</p>
      </section>
      <section className="admin-billing-detail-section">
        <h3>Stripe</h3>
        <p>Checkout session：{props.order.stripeCheckoutSessionId ?? "无"}</p>
        <p>Invoice：{props.order.stripeInvoiceId ?? "无"}</p>
        <p>Subscription：{props.order.stripeSubscriptionId ?? "无"}</p>
      </section>
    </div>
  );
}

function AutoRenewalDetailPanel(props: {
  renewal: AdminBillingAutoRenewal | null;
  account: AdminBillingCustomerAccount | null;
  notifications: AdminBillingOverviewResponse["notifications"];
  stripeEvents: AdminBillingOverviewResponse["stripeEvents"];
  onCreatePaymentLink(account: AdminBillingCustomerAccount): void;
}) {
  if (!props.renewal || !props.account) {
    return (
      <aside className="admin-billing-detail">
        <Empty description="选择一条自动续费记录" />
      </aside>
    );
  }

  const relatedNotifications = props.notifications.filter((item) => item.organizationId === props.renewal?.organizationId).slice(0, 4);
  const recentStripeEvents = props.stripeEvents.slice(0, 4);
  return (
    <aside className="admin-billing-detail">
      <div className="admin-billing-detail-head">
        <div>
          <span className="admin-billing-kicker">Auto renewal</span>
          <h2>{props.account.organization.name}</h2>
          <p>{props.renewal.stripeSubscriptionId ?? "Stripe subscription not created"}</p>
        </div>
        <Tag color={statusColor(props.renewal.status)}>{props.renewal.status}</Tag>
      </div>
      {props.renewal.status === "payment_failed" ? (
        <Alert
          type="error"
          showIcon
          message="扣款失败后不设置宽限期"
          description="系统不会延长当前 entitlement；客户到期后会被阻断，并通过邮件与 Portal 引导重新支付。"
          style={{ marginTop: 12 }}
        />
      ) : null}
      <div className="admin-billing-detail-grid">
        <div><span>Payment method</span><strong>{props.renewal.paymentMethodStatus}</strong></div>
        <div><span>Cancel at period end</span><strong>{props.renewal.cancelAtPeriodEnd ? "yes" : "no"}</strong></div>
        <div><span>Current period</span><strong>{formatLocalTime(props.renewal.currentPeriodEndsAt)}</strong></div>
        <div><span>Next renewal</span><strong>{formatLocalTime(props.renewal.nextRenewalAt)}</strong></div>
      </div>
      <section className="admin-billing-detail-section">
        <h3>下一步</h3>
        <p>{props.renewal.status === "payment_failed" ? "创建付款链接并让客户重新支付；新支付成功后会重新写入自动续费。" : "持续监控下一次 Stripe invoice.paid / invoice.payment_failed。"}</p>
        <Button
          type={props.renewal.status === "payment_failed" ? "primary" : "default"}
          icon={<Link2 size={16} />}
          onClick={() => props.onCreatePaymentLink(props.account!)}
        >
          创建付款链接
        </Button>
      </section>
      <section className="admin-billing-detail-section">
        <h3>邮件提醒</h3>
        {relatedNotifications.length ? relatedNotifications.map((item) => (
          <p key={item.id}>{item.eventType} · {item.status} · {formatLocalTime(item.createdAt)}</p>
        )) : <p>暂无相关提醒记录</p>}
      </section>
      <section className="admin-billing-detail-section">
        <h3>Stripe 事件</h3>
        {recentStripeEvents.length ? recentStripeEvents.map((item) => (
          <p key={item.id}>{item.eventType} · {item.status} · {formatLocalTime(item.createdAt)}</p>
        )) : <p>暂无 webhook 事件</p>}
      </section>
    </aside>
  );
}

export function BillingWorkspace() {
  const [activeTab, setActiveTab] = useState<BillingTab>("overview");
  const [data, setData] = useState<AdminBillingOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [errorText, setErrorText] = useState("");
  const [successText, setSuccessText] = useState("");
  const [query, setQuery] = useState("");
  const [selectedOrganizationId, setSelectedOrganizationId] = useState("");
  const [promotionModalOpen, setPromotionModalOpen] = useState(false);
  const [promotionForm, setPromotionForm] = useState<PromotionFormState>(createPromotionFormState());
  const [giftModalOpen, setGiftModalOpen] = useState(false);
  const [giftForm, setGiftForm] = useState<GiftFormState>(createGiftFormState());
  const [paymentLinkModalOpen, setPaymentLinkModalOpen] = useState(false);
  const [paymentLinkForm, setPaymentLinkForm] = useState<PaymentLinkFormState>(createPaymentLinkFormState());
  const [createdPaymentLink, setCreatedPaymentLink] = useState<string | null>(null);
  const [editingPromotion, setEditingPromotion] = useState<AdminPromotionCode | null>(null);
  const [editingEmailRule, setEditingEmailRule] = useState<AdminBillingEmailRule | null>(null);
  const [editingPlan, setEditingPlan] = useState<AdminBillingPlan | null>(null);
  const [planBillingForm, setPlanBillingForm] = useState<PlanBillingFormState>(createPlanBillingFormState());
  const [stripeForm, setStripeForm] = useState<StripeSettingsFormState>(createStripeSettingsFormState());
  const [selectedOrder, setSelectedOrder] = useState<AdminBillingOrder | null>(null);
  const [selectedAutoRenewalId, setSelectedAutoRenewalId] = useState("");
  const [manualStripeCustomerId, setManualStripeCustomerId] = useState("");
  const [saving, setSaving] = useState(false);

  async function loadData(silent = false) {
    if (!silent) setLoading(true);
    setRefreshing(silent);
    setErrorText("");
    try {
      const next = await fetchAdminBillingOverview();
      setData(next);
      setStripeForm(createStripeSettingsFormState(next.stripe));
      setSelectedOrganizationId((current) => current || next.customers[0]?.organization.id || "");
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "加载计费数据失败");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const filteredCustomers = useMemo(() => {
    const items = data?.customers ?? [];
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items;
    return items.filter((item) =>
      [
        item.organization.name,
        item.organization.slug,
        item.billingCustomer?.businessEmail ?? "",
        item.billingCustomer?.companyName ?? "",
        item.billingCustomer?.salesContact ?? "",
        item.grant?.planName ?? "",
        item.nextAction
      ].join(" ").toLowerCase().includes(normalized)
    );
  }, [data?.customers, query]);

  const selectedAccount = useMemo(() => {
    return data?.customers.find((item) => item.organization.id === selectedOrganizationId) ?? filteredCustomers[0] ?? null;
  }, [data?.customers, filteredCustomers, selectedOrganizationId]);

  useEffect(() => {
    setManualStripeCustomerId(selectedAccount?.billingCustomer?.stripeCustomerId ?? "");
  }, [selectedAccount?.billingCustomer?.id, selectedAccount?.billingCustomer?.stripeCustomerId]);

  const planOptions = useMemo(
    () => (data?.plans ?? []).map((plan) => ({ label: `${plan.name} · ${planBillingLabel(plan)}`, value: plan.id })),
    [data?.plans]
  );

  const planGroups = useMemo(() => groupAdminPlans(data?.plans ?? []), [data?.plans]);

  const selectedAutoRenewal = useMemo(() => {
    const renewals = data?.autoRenewals ?? [];
    return renewals.find((item) => item.id === selectedAutoRenewalId) ?? renewals[0] ?? null;
  }, [data?.autoRenewals, selectedAutoRenewalId]);

  const selectedAutoRenewalAccount = useMemo(() => {
    if (!selectedAutoRenewal) return null;
    return data?.customers.find((item) => item.organization.id === selectedAutoRenewal.organizationId) ?? null;
  }, [data?.customers, selectedAutoRenewal]);

  const organizationOptions = useMemo(
    () => (data?.customers ?? []).map((item) => ({ label: item.organization.name, value: item.organization.id })),
    [data?.customers]
  );

  const summaryCards = useMemo(() => {
    const summary = data?.summary;
    return [
      {
        label: "已付收入",
        value: summary ? formatMoney(summary.revenueCents, summary.currency) : "--",
        meta: "来自 Agent Studio 订单"
      },
      {
        label: "有效订阅",
        value: summary?.activeSubscriptions ?? "--",
        meta: "当前仍可使用的组织授权"
      },
      {
        label: "14 天内到期",
        value: summary?.expiringIn14Days ?? "--",
        meta: "会触发临期提醒和 Portal 提示"
      },
      {
        label: "续费失败",
        value: summary?.failedRenewals ?? "--",
        meta: "不延长授权，不设置宽限期"
      },
      {
        label: "自动续费",
        value: summary?.activeAutoRenewals ?? "--",
        meta: "Stripe 未来扣款托管"
      }
    ];
  }, [data?.summary]);

  const customerColumns: ColumnsType<AdminBillingCustomerAccount> = [
    {
      title: "Organization",
      dataIndex: ["organization", "name"],
      width: 240,
      render: (_, record) => (
        <button className="billing-table-link" onClick={() => setSelectedOrganizationId(record.organization.id)}>
          <strong>{record.organization.name}</strong>
          <span>{record.billingCustomer?.businessEmail ?? record.organization.slug}</span>
        </button>
      )
    },
    {
      title: "Plan",
      width: 180,
      render: (_, record) => record.grant?.planName ?? "未开通"
    },
    {
      title: "Expiry",
      width: 190,
      render: (_, record) => formatLocalTime(record.grant?.expiresAt)
    },
    {
      title: "Auto renew",
      width: 150,
      render: (_, record) => (
        <Tag color={statusColor(record.autoRenewal?.status)}>{record.autoRenewal?.status ?? "not_enabled"}</Tag>
      )
    },
    {
      title: "Payment",
      width: 140,
      render: (_, record) => (
        <Tag color={statusColor(record.latestOrder?.status)}>{record.latestOrder?.status ?? "no_order"}</Tag>
      )
    },
    {
      title: "Next action",
      width: 170,
      render: (_, record) => nextActionLabel(record.nextAction)
    }
  ];

  const promotionColumns: ColumnsType<AdminPromotionCode> = [
    {
      title: "Code",
      dataIndex: "code",
      width: 150,
      render: (value, record) => (
        <button className="billing-table-link compact" onClick={() => setEditingPromotion(record)}>
          <strong>{value}</strong>
          <span>{record.name || record.type}</span>
        </button>
      )
    },
    { title: "Type", dataIndex: "type", width: 130 },
    { title: "Value", dataIndex: "value", width: 120 },
    {
      title: "Scope",
      width: 220,
      render: (_, record) => {
        const scopes = [
          record.eligiblePlanIds.length ? `${record.eligiblePlanIds.length} plans` : "",
          record.eligibleOrganizationIds.length ? `${record.eligibleOrganizationIds.length} orgs` : "",
          record.eligibleEmailDomains.length ? record.eligibleEmailDomains.join(", ") : ""
        ].filter(Boolean);
        return scopes.join(" · ") || "all customers";
      }
    },
    {
      title: "Limit",
      width: 140,
      render: (_, record) => `${record.maxRedemptions ?? "∞"} total / ${record.perCustomerLimit} each`
    },
    {
      title: "Expires",
      width: 170,
      render: (_, record) => formatLocalTime(record.expiresAt)
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 110,
      render: (value) => <Tag color={statusColor(value)}>{value}</Tag>
    }
  ];

  const orderColumns: ColumnsType<AdminBillingOrder> = [
    { title: "Order", dataIndex: "orderNumber", width: 160 },
    {
      title: "Customer",
      width: 220,
      render: (_, record) => data?.customers.find((item) => item.organization.id === record.organizationId)?.organization.name ?? record.organizationId
    },
    { title: "Plan", dataIndex: "planName", width: 160 },
    {
      title: "Amount",
      width: 150,
      render: (_, record) => formatMoney(record.amountTotalCents, record.currency)
    },
    {
      title: "Duration",
      width: 140,
      render: (_, record) => `${record.durationDays + record.giftDays} days`
    },
    {
      title: "Auto renew",
      dataIndex: "autoRenew",
      width: 120,
      render: (value) => (value ? <Tag color="success">on</Tag> : <Tag>off</Tag>)
    },
    {
      title: "Status",
      dataIndex: "status",
      width: 130,
      render: (value) => <Tag color={statusColor(value)}>{value}</Tag>
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      width: 180,
      render: formatLocalTime
    },
    {
      title: "Action",
      width: 90,
      render: (_, record) => <Button size="small" onClick={() => setSelectedOrder(record)}>详情</Button>
    }
  ];

  async function handleCreatePromotion() {
    setSaving(true);
    setErrorText("");
    try {
      await createAdminPromotionCode({
        code: promotionForm.code,
        name: promotionForm.name || undefined,
        type: promotionForm.type,
        value: promotionForm.value,
        maxRedemptions: promotionForm.maxRedemptions,
        perCustomerLimit: promotionForm.perCustomerLimit,
        expiresAt: toIsoOrNull(promotionForm.expiresAt),
        eligiblePlanIds: promotionForm.eligiblePlanIds,
        eligibleEmailDomains: promotionForm.eligibleEmailDomains
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        note: promotionForm.note || undefined
      });
      setPromotionModalOpen(false);
      setPromotionForm(createPromotionFormState());
      setSuccessText("优惠码已创建");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建优惠码失败");
    } finally {
      setSaving(false);
    }
  }

  async function handlePatchPromotionStatus(record: AdminPromotionCode, status: string) {
    setSaving(true);
    try {
      await patchAdminPromotionCode(record.id, { status });
      setEditingPromotion(null);
      setSuccessText(status === "active" ? "优惠码已启用" : "优惠码已停用");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新优惠码失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleGrantGiftDays() {
    setSaving(true);
    setErrorText("");
    try {
      await grantAdminBillingGiftDays(giftForm);
      setGiftModalOpen(false);
      setSuccessText("已赠送订阅时长并更新客户授权");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "赠送订阅时长失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleCreatePaymentLink() {
    setSaving(true);
    setCreatedPaymentLink(null);
    setErrorText("");
    try {
      const result = await createAdminBillingPaymentLink(paymentLinkForm);
      setCreatedPaymentLink(result.checkoutUrl);
      setSuccessText(result.checkoutUrl ? "付款链接已创建" : "订单已直接生效");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "创建付款链接失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSavePlanBilling() {
    if (!editingPlan) return;
    setSaving(true);
    setErrorText("");
    try {
      await patchAdminBillingPlan(editingPlan.id, {
        billingStatus: planBillingForm.billingStatus,
        billingCurrency: planBillingForm.billingCurrency,
        billingInterval: planBillingForm.billingInterval,
        billingIntervalCount: planBillingForm.billingIntervalCount,
        billingPriceCents: planBillingForm.billingPriceCents
      });
      setEditingPlan(null);
      setSuccessText("套餐售卖配置已更新");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新套餐售卖配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveStripeSettings() {
    setSaving(true);
    setErrorText("");
    try {
      await patchAdminBillingStripeSettings({
        mode: stripeForm.mode,
        stripeSecretKey: stripeForm.clearStripeSecretKey ? undefined : stripeForm.stripeSecretKey.trim() || undefined,
        webhookSigningSecret: stripeForm.clearWebhookSigningSecret ? undefined : stripeForm.webhookSigningSecret.trim() || undefined,
        successUrl: stripeForm.successUrl,
        cancelUrl: stripeForm.cancelUrl,
        defaultCurrency: stripeForm.defaultCurrency,
        defaultAutoRenew: stripeForm.defaultAutoRenew,
        clearStripeSecretKey: stripeForm.clearStripeSecretKey,
        clearWebhookSigningSecret: stripeForm.clearWebhookSigningSecret
      });
      setSuccessText("Stripe 配置已保存");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "保存 Stripe 配置失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleSaveEmailRule() {
    if (!editingEmailRule) return;
    setSaving(true);
    try {
      await patchAdminBillingEmailRule(editingEmailRule.id, {
        status: editingEmailRule.status,
        subject: editingEmailRule.subject,
        bodyText: editingEmailRule.bodyText,
        bodyHtml: editingEmailRule.bodyHtml
      });
      setEditingEmailRule(null);
      setSuccessText("邮件规则已更新");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新邮件规则失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleToggleBillingEmails(enabled: boolean) {
    setSaving(true);
    setErrorText("");
    try {
      await patchAdminBillingEmailSettings({ enabled });
      setSuccessText(enabled ? "计费邮件总开关已开启" : "计费邮件总开关已关闭，不会真实发送客户邮件");
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "更新计费邮件总开关失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleRunEmailSweep() {
    setSaving(true);
    try {
      const result = await runAdminBillingEmailReminderSweep();
      const sent = result.results.reduce((sum, item) => sum + item.sent, 0);
      const failed = result.results.reduce((sum, item) => sum + item.failed, 0);
      setSuccessText(result.disabled ? "计费邮件总开关关闭，本次扫描未真实发送客户邮件" : `邮件提醒扫描完成：发送 ${sent}，失败 ${failed}`);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "执行邮件提醒失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleLookupStripeCustomer(account: AdminBillingCustomerAccount | null) {
    const billingCustomerId = account?.billingCustomer?.id;
    if (!billingCustomerId) {
      setErrorText("请先创建该客户的计费档案，再执行 Stripe Customer 查找");
      return;
    }
    setSaving(true);
    setErrorText("");
    try {
      const billingCustomer = await lookupAdminBillingStripeCustomer(billingCustomerId);
      const status = billingCustomer?.stripeCustomerLookup?.status ?? "unknown";
      setSuccessText(
        status === "matched"
          ? `已绑定 Stripe Customer：${billingCustomer?.stripeCustomerId ?? billingCustomer?.stripeCustomerLookup?.stripeCustomerId ?? ""}`
          : `Stripe Customer 查找完成：${status}`
      );
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "查找 Stripe Customer 失败");
    } finally {
      setSaving(false);
    }
  }

  async function handleBindStripeCustomer(account: AdminBillingCustomerAccount | null, stripeCustomerId: string) {
    const billingCustomerId = account?.billingCustomer?.id;
    const normalizedCustomerId = stripeCustomerId.trim();
    if (!billingCustomerId) {
      setErrorText("请先创建该客户的计费档案，再绑定 Stripe Customer");
      return;
    }
    if (!normalizedCustomerId) {
      setErrorText("请输入 Stripe Customer ID");
      return;
    }
    setSaving(true);
    setErrorText("");
    try {
      const billingCustomer = await bindAdminBillingStripeCustomer(billingCustomerId, normalizedCustomerId);
      setSuccessText(`已绑定 Stripe Customer：${billingCustomer?.stripeCustomerId ?? normalizedCustomerId}`);
      await loadData(true);
    } catch (error) {
      setErrorText(error instanceof Error ? error.message : "绑定 Stripe Customer 失败");
    } finally {
      setSaving(false);
    }
  }

  function openPlanBillingModal(plan: AdminBillingPlan) {
    setEditingPlan(plan);
    setPlanBillingForm(createPlanBillingFormState(plan));
  }

  function renderPlanMatrixPrice(plan: AdminBillingPlan | null, label: string) {
    if (!plan) {
      return (
        <div className="admin-billing-product-price missing">
          <span>{label}</span>
          <strong>Missing</strong>
          <small>Migration did not create this price item.</small>
        </div>
      );
    }
    return (
      <div className="admin-billing-product-price">
        <span>{label}</span>
        <strong>{formatMoney(plan.billingPriceCents, plan.billingCurrency)}</strong>
        <small>{plan.durationDays} days · {plan.slug}</small>
        <div>
          {planStatusTag(plan)}
          <Button size="small" icon={<CreditCard size={14} />} onClick={() => openPlanBillingModal(plan)}>
            配置
          </Button>
        </div>
      </div>
    );
  }

  const detailPanel = selectedAccount ? (
    <aside className="admin-billing-detail">
      <div className="admin-billing-detail-head">
        <div>
          <span className="admin-billing-kicker">Selected account</span>
          <h2>{selectedAccount.organization.name}</h2>
          <p>{selectedAccount.billingCustomer?.businessEmail ?? selectedAccount.organization.slug}</p>
        </div>
        <Tag color={statusColor(selectedAccount.grant?.status)}>{selectedAccount.grant?.status ?? "not_open"}</Tag>
      </div>
      <div className="admin-billing-detail-grid">
        <div>
          <span>当前套餐</span>
          <strong>{selectedAccount.grant?.planName ?? "未开通"}</strong>
        </div>
        <div>
          <span>到期时间</span>
          <strong>{formatLocalTime(selectedAccount.grant?.expiresAt)}</strong>
        </div>
        <div>
          <span>自动续费</span>
          <strong>{selectedAccount.autoRenewal?.status ?? "not_enabled"}</strong>
        </div>
        <div>
          <span>支付方式</span>
          <strong>{selectedAccount.autoRenewal?.paymentMethodStatus ?? "unknown"}</strong>
        </div>
      </div>
      <div className="admin-billing-detail-section">
        <h3>客户信息</h3>
        <p>公司：{selectedAccount.billingCustomer?.companyName ?? selectedAccount.organization.name}</p>
        <p>联系人：{selectedAccount.billingCustomer?.contactName ?? "未记录"}</p>
        <p>国家/地区：{selectedAccount.billingCustomer?.countryRegion ?? "未记录"}</p>
        <p>SN：{selectedAccount.billingCustomer?.sn ?? "未记录"}</p>
        <p>Sales：{selectedAccount.billingCustomer?.salesContact ?? "未记录"}</p>
      </div>
      <div className="admin-billing-detail-section">
        <h3>Stripe</h3>
        <div className="admin-billing-stripe-bind">
          <div>
            <span>Customer</span>
            <strong>{selectedAccount.billingCustomer?.stripeCustomerId ?? "未绑定"}</strong>
          </div>
          <Button
            size="small"
            icon={<Search size={14} />}
            disabled={saving || !selectedAccount.billingCustomer}
            onClick={() => void handleLookupStripeCustomer(selectedAccount)}
          >
            Lookup
          </Button>
        </div>
        {selectedAccount.billingCustomer?.stripeCustomerLookup ? (
          <div className="admin-billing-stripe-lookup">
            <Tag color={stripeLookupStatusColor(selectedAccount.billingCustomer.stripeCustomerLookup.status)}>
              {selectedAccount.billingCustomer.stripeCustomerLookup.status}
            </Tag>
            <span>{selectedAccount.billingCustomer.stripeCustomerLookup.email ?? "no email"}</span>
            <span>{formatLocalTime(selectedAccount.billingCustomer.stripeCustomerLookup.checkedAt)}</span>
            {selectedAccount.billingCustomer.stripeCustomerLookup.message ? (
              <p>{selectedAccount.billingCustomer.stripeCustomerLookup.message}</p>
            ) : null}
          </div>
        ) : null}
        {selectedAccount.billingCustomer?.stripeCustomerLookup?.candidates?.length ? (
          <div className="admin-billing-stripe-candidates">
            {selectedAccount.billingCustomer.stripeCustomerLookup.candidates.map((candidate) => (
              <div key={candidate.id} className="admin-billing-stripe-candidate">
                <div>
                  <strong>{candidate.id}</strong>
                  <span>{[candidate.email, candidate.name, candidate.defaultPaymentMethod ? "has payment method" : ""].filter(Boolean).join(" · ")}</span>
                </div>
                <Button
                  size="small"
                  disabled={saving || selectedAccount.billingCustomer?.stripeCustomerId === candidate.id}
                  onClick={() => void handleBindStripeCustomer(selectedAccount, candidate.id)}
                >
                  Bind
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <Input.Search
          size="small"
          value={manualStripeCustomerId}
          placeholder="cus_..."
          enterButton="Bind"
          disabled={saving || !selectedAccount.billingCustomer}
          onChange={(event) => setManualStripeCustomerId(event.target.value)}
          onSearch={(value) => void handleBindStripeCustomer(selectedAccount, value)}
        />
        <p>Subscription：{selectedAccount.autoRenewal?.stripeSubscriptionId ?? "未创建"}</p>
        <p>Next renewal：{formatLocalTime(selectedAccount.autoRenewal?.nextRenewalAt)}</p>
      </div>
      <Space wrap>
        <Button
          type="primary"
          icon={<Link2 size={16} />}
          onClick={() => {
            setPaymentLinkForm(createPaymentLinkFormState(selectedAccount, data?.plans[0]?.id));
            setCreatedPaymentLink(null);
            setPaymentLinkModalOpen(true);
          }}
        >
          创建付款链接
        </Button>
        <Button
          icon={<Gift size={16} />}
          onClick={() => {
            setGiftForm(createGiftFormState(selectedAccount, selectedAccount.grant?.planId ?? data?.plans[0]?.id));
            setGiftModalOpen(true);
          }}
        >
          赠送天数
        </Button>
      </Space>
    </aside>
  ) : null;

  if (loading) {
    return (
      <div className="admin-page-container">
        <div className="admin-loading-state">
          <Spin size="large" />
        </div>
      </div>
    );
  }

  return (
    <div className="admin-page-container admin-billing-workspace">
      <div className="admin-page-header">
        <div>
          <h1 className="admin-page-title">计费与续费</h1>
          <p className="admin-page-desc">统一管理外部客户预付费、自动续费、优惠码、赠送时长和邮件提醒。</p>
        </div>
        <Space wrap>
          <Button icon={<Gift size={16} />} onClick={() => {
            setGiftForm(createGiftFormState(selectedAccount, selectedAccount?.grant?.planId ?? data?.plans[0]?.id));
            setGiftModalOpen(true);
          }}>
            赠送时长
          </Button>
          <Button type="primary" icon={<Plus size={16} />} onClick={() => setPromotionModalOpen(true)}>
            创建优惠码
          </Button>
        </Space>
      </div>

      {errorText ? <Alert type="error" message={errorText} showIcon closable onClose={() => setErrorText("")} /> : null}
      {successText ? <Alert type="success" message={successText} showIcon closable onClose={() => setSuccessText("")} /> : null}

      <section className="admin-billing-summary-grid">
        {summaryCards.map((item) => (
          <div key={item.label} className="admin-billing-summary-cell">
            <span>{item.label}</span>
            <strong>{item.value}</strong>
            <p>{item.meta}</p>
          </div>
        ))}
      </section>

      <div className="admin-billing-toolbar">
        <Input
          prefix={<Search size={15} />}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="搜索组织、邮箱、套餐、销售负责人"
          allowClear
        />
        <Button icon={<RefreshCw size={16} />} loading={refreshing} onClick={() => void loadData(true)}>
          刷新
        </Button>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as BillingTab)}
        items={[
          {
            key: "overview",
            label: "Overview",
            children: (
              <div className="admin-billing-split">
                <section className="admin-billing-main">
                  <Table
                    rowKey={(record) => record.organization.id}
                    size="small"
                    columns={customerColumns}
                    dataSource={filteredCustomers}
                    pagination={{ pageSize: 10, showSizeChanger: false }}
                    onRow={(record) => ({ onClick: () => setSelectedOrganizationId(record.organization.id) })}
                  />
                </section>
                {detailPanel}
              </div>
            )
          },
          {
            key: "products",
            label: "Products",
            children: (
              <div className="admin-billing-tab-stack">
                <section className="admin-billing-product-matrix">
                  <div className="admin-billing-product-head">
                    <div>
                      <span className="admin-billing-kicker">Production catalog</span>
                      <h3>Plus / PRO 正式售卖矩阵</h3>
                      <p>生产部署会幂等创建四个价格项；客户侧聚合展示为两个套餐，并在这里维护售卖状态和价格。</p>
                    </div>
                    <Tag color={data?.stripe.mode === "live" ? "success" : "processing"}>{data?.stripe.mode ?? "unknown"} mode</Tag>
                  </div>
                  <div className="admin-billing-product-grid">
                    {planGroups.map((group) => (
                      <div key={group.key} className={group.key === "plus" || group.key === "pro" ? "admin-billing-product-row official" : "admin-billing-product-row"}>
                        <div className="admin-billing-product-name">
                          <strong>{group.title}</strong>
                          <span>{group.limit ? `${group.limit.toLocaleString()} AI requests / month` : group.subtitle}</span>
                        </div>
                        {renderPlanMatrixPrice(group.monthly, "Monthly")}
                        {renderPlanMatrixPrice(group.annual, "Annual")}
                        <div className="admin-billing-product-portal">
                          <span>Portal status</span>
                          <strong>{[group.monthly, group.annual].some((plan) => plan?.billingStatus === "active") ? "Visible" : "Hidden"}</strong>
                          <small>{group.monthly?.billingStatus === "active" && group.annual?.billingStatus === "active" ? "Both cycles available" : "Check inactive cycle before launch"}</small>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>

                <Table
                  rowKey="id"
                  size="small"
                  title={() => "Raw price items"}
                  dataSource={data?.plans ?? []}
                  pagination={false}
                  columns={[
                    { title: "Plan", dataIndex: "name" },
                    { title: "Slug", dataIndex: "slug" },
                    { title: "Price", render: (_, record) => planBillingLabel(record) },
                    { title: "Duration", render: (_, record) => `${record.durationDays} days` },
                    { title: "Status", dataIndex: "billingStatus", render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
                    { title: "AI request limit", dataIndex: "monthlyCompletedTurnLimit", render: (value) => value ?? "不限" },
                    {
                      title: "Action",
                      width: 110,
                      render: (_, record) => (
                        <Button size="small" icon={<CreditCard size={14} />} onClick={() => openPlanBillingModal(record)}>
                          配置
                        </Button>
                      )
                    }
                  ]}
                />
              </div>
            )
          },
          {
            key: "promotions",
            label: "Promotion codes",
            children: (
              <div className="admin-billing-tab-stack">
                <Alert
                  type="info"
                  showIcon
                  message="Promotion 由 Agent Studio 接管，Stripe 只接收本次实付金额。赠送天数会写入订单并延长 entitlement。"
                />
                <Table rowKey="id" size="small" columns={promotionColumns} dataSource={data?.promotionCodes ?? []} />
              </div>
            )
          },
          {
            key: "orders",
            label: "Orders",
            children: (
              <Table
                rowKey="id"
                size="small"
                columns={orderColumns}
                dataSource={data?.orders ?? []}
                onRow={(record) => ({ onClick: () => setSelectedOrder(record) })}
              />
            )
          },
          {
            key: "auto-renewals",
            label: "Auto-renewals",
            children: (
              <div className="admin-billing-split">
                <section className="admin-billing-main">
                  <Table
                    rowKey="id"
                    size="small"
                    dataSource={data?.autoRenewals ?? []}
                    onRow={(record) => ({ onClick: () => setSelectedAutoRenewalId(record.id) })}
                    columns={[
                      { title: "Organization", render: (_, record) => data?.customers.find((item) => item.organization.id === record.organizationId)?.organization.name ?? record.organizationId },
                      { title: "Status", dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
                      { title: "Payment method", dataIndex: "paymentMethodStatus" },
                      { title: "Next renewal", dataIndex: "nextRenewalAt", render: formatLocalTime },
                      { title: "Failed at", dataIndex: "lastPaymentFailedAt", render: formatLocalTime }
                    ]}
                  />
                </section>
                <AutoRenewalDetailPanel
                  renewal={selectedAutoRenewal}
                  account={selectedAutoRenewalAccount}
                  notifications={data?.notifications ?? []}
                  stripeEvents={data?.stripeEvents ?? []}
                  onCreatePaymentLink={(account) => {
                    setPaymentLinkForm(createPaymentLinkFormState(account, account.grant?.planId ?? data?.plans[0]?.id));
                    setCreatedPaymentLink(null);
                    setPaymentLinkModalOpen(true);
                  }}
                />
              </div>
            )
          },
          {
            key: "customers",
            label: "Customers",
            children: (
              <Table
                rowKey={(record) => record.organization.id}
                size="small"
                columns={customerColumns}
                dataSource={data?.customers ?? []}
                expandable={{
                  expandedRowRender: (record) => (
                    <div className="admin-billing-expanded">
                      <span>Billing email: {record.billingCustomer?.billingEmail ?? "未设置"}</span>
                      <span>Company: {record.billingCustomer?.companyName ?? record.organization.name}</span>
                      <span>Stripe customer: {record.billingCustomer?.stripeCustomerId ?? "未绑定"}</span>
                    </div>
                  )
                }}
              />
            )
          },
          {
            key: "email",
            label: "Email automations",
            children: (
              <div className="admin-billing-tab-stack">
                <div className="admin-billing-email-master">
                  <div>
                    <span className="admin-billing-kicker">Delivery guard</span>
                    <h3>Billing emails {data?.emailSettings.enabled ? "on" : "off"}</h3>
                    <p>
                      总开关关闭时，临期、过期和扣款失败扫描不会真实发送客户邮件；测试收件人仍可用于模板验证。
                    </p>
                  </div>
                  <Space>
                    <Switch
                      checked={data?.emailSettings.enabled ?? false}
                      loading={saving}
                      onChange={(enabled) => void handleToggleBillingEmails(enabled)}
                    />
                    <Button icon={<Mail size={16} />} loading={saving} onClick={() => void handleRunEmailSweep()}>
                      立即扫描发送
                    </Button>
                  </Space>
                </div>
                {!data?.emailSettings.enabled ? (
                  <Alert type="warning" showIcon message="计费邮件总开关关闭，生产不会向客户真实发送提醒。" />
                ) : null}
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={data?.emailRules ?? []}
                  columns={[
                    { title: "Trigger", render: (_, record) => `${record.triggerType} · ${record.offsetDays}d` },
                    { title: "Status", dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
                    { title: "Subject", dataIndex: "subject" },
                    { title: "Last run", dataIndex: "lastRunAt", render: formatLocalTime },
                    {
                      title: "Action",
                      width: 110,
                      render: (_, record) => <Button size="small" onClick={() => setEditingEmailRule(record)}>编辑</Button>
                    }
                  ]}
                />
                <Table
                  rowKey="id"
                  size="small"
                  title={() => "通知记录"}
                  dataSource={data?.notifications ?? []}
                  columns={[
                    { title: "Event", dataIndex: "eventType" },
                    { title: "Status", dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
                    { title: "Target", dataIndex: "targetRef" },
                    { title: "Created", dataIndex: "createdAt", render: formatLocalTime },
                    { title: "Error", dataIndex: "errorMessage" }
                  ]}
                />
              </div>
            )
          },
          {
            key: "stripe",
            label: "Stripe",
            children: (
              <div className="admin-billing-tab-stack">
                <section className="admin-billing-config-panel">
                  <div className="admin-billing-config-head">
                    <div>
                      <span className="admin-billing-kicker">Runtime settings</span>
                      <h3>Stripe 收款配置</h3>
                      <p>保存后立即用于 checkout、自动续费和 webhook 校验；密钥留空表示保持当前值。</p>
                    </div>
                    <Button type="primary" icon={<Save size={16} />} loading={saving} onClick={() => void handleSaveStripeSettings()}>
                      保存 Stripe 配置
                    </Button>
                  </div>
                  <Form layout="vertical" className="admin-billing-config-form">
                    <Form.Item label="Mode">
                      <Select
                        value={stripeForm.mode}
                        onChange={(mode) => setStripeForm((current) => ({ ...current, mode }))}
                        options={[
                          { value: "test", label: "Test mode" },
                          { value: "live", label: "Live mode" }
                        ]}
                      />
                    </Form.Item>
                    <Form.Item label={`Secret key${data?.stripe.secretKeyPreview ? ` · ${data.stripe.secretKeyPreview}` : ""}`}>
                      <Input.Password
                        prefix={<KeyRound size={14} />}
                        value={stripeForm.stripeSecretKey}
                        disabled={stripeForm.clearStripeSecretKey}
                        placeholder={data?.stripe.secretKeyConfigured ? "留空保持当前 key" : "sk_test_... / sk_live_..."}
                        onChange={(event) => setStripeForm((current) => ({ ...current, stripeSecretKey: event.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label={`Webhook signing secret${data?.stripe.webhookSigningSecretPreview ? ` · ${data.stripe.webhookSigningSecretPreview}` : ""}`}>
                      <Input.Password
                        prefix={<ShieldCheck size={14} />}
                        value={stripeForm.webhookSigningSecret}
                        disabled={stripeForm.clearWebhookSigningSecret}
                        placeholder={data?.stripe.webhookSigningSecretConfigured ? "留空保持当前 whsec" : "whsec_..."}
                        onChange={(event) => setStripeForm((current) => ({ ...current, webhookSigningSecret: event.target.value }))}
                      />
                    </Form.Item>
                    <Form.Item label="Success URL">
                      <Input value={stripeForm.successUrl} onChange={(event) => setStripeForm((current) => ({ ...current, successUrl: event.target.value }))} />
                    </Form.Item>
                    <Form.Item label="Cancel URL">
                      <Input value={stripeForm.cancelUrl} onChange={(event) => setStripeForm((current) => ({ ...current, cancelUrl: event.target.value }))} />
                    </Form.Item>
                    <Form.Item label="Default currency">
                      <Input value={stripeForm.defaultCurrency} onChange={(event) => setStripeForm((current) => ({ ...current, defaultCurrency: event.target.value.toLowerCase() }))} maxLength={3} />
                    </Form.Item>
                    <Form.Item label="Default auto renew">
                      <Switch checked={stripeForm.defaultAutoRenew} onChange={(defaultAutoRenew) => setStripeForm((current) => ({ ...current, defaultAutoRenew }))} />
                    </Form.Item>
                    <Form.Item label="Clear stored secret key">
                      <Switch checked={stripeForm.clearStripeSecretKey} onChange={(clearStripeSecretKey) => setStripeForm((current) => ({ ...current, clearStripeSecretKey }))} />
                    </Form.Item>
                    <Form.Item label="Clear webhook secret">
                      <Switch checked={stripeForm.clearWebhookSigningSecret} onChange={(clearWebhookSigningSecret) => setStripeForm((current) => ({ ...current, clearWebhookSigningSecret }))} />
                    </Form.Item>
                  </Form>
                </section>

                <section className="admin-billing-stripe-health">
                  {[
                    ["Config source", data?.stripe.source ?? "environment"],
                    ["Mode", data?.stripe.mode ?? "unknown"],
                    ["Secret key", data?.stripe.secretKeyConfigured],
                    ["Webhook signing secret", data?.stripe.webhookSigningSecretConfigured],
                    ["Success URL", data?.stripe.successUrlConfigured],
                    ["Cancel URL", data?.stripe.cancelUrlConfigured]
                  ].map(([label, ready]) => (
                    <div key={String(label)}>
                      <ShieldCheck size={18} />
                      <span>{label}</span>
                      <Tag color={typeof ready === "boolean" ? (ready ? "success" : "error") : "processing"}>
                        {typeof ready === "boolean" ? (ready ? "configured" : "missing") : String(ready)}
                      </Tag>
                    </div>
                  ))}
                </section>
                <section className="admin-billing-config-panel compact">
                  <div className="admin-billing-webhook-row">
                    <div>
                      <span className="admin-billing-kicker">Webhook endpoint</span>
                      <strong>{stripeWebhookUrl(data?.stripe)}</strong>
                    </div>
                    <Button
                      icon={<Copy size={16} />}
                      onClick={() => {
                        void navigator.clipboard?.writeText(stripeWebhookUrl(data?.stripe));
                        setSuccessText("Webhook URL 已复制");
                      }}
                    >
                      复制
                    </Button>
                  </div>
                  <div className="admin-billing-webhook-events">
                    {(data?.stripe.requiredWebhookEvents ?? []).map((eventName) => <Tag key={eventName}>{eventName}</Tag>)}
                  </div>
                </section>
                <Table
                  rowKey="id"
                  size="small"
                  dataSource={data?.stripeEvents ?? []}
                  locale={{ emptyText: <Empty description="暂无 Stripe webhook 事件" /> }}
                  columns={[
                    { title: "Event", dataIndex: "eventType" },
                    { title: "Stripe id", dataIndex: "stripeEventId" },
                    { title: "Status", dataIndex: "status", render: (value) => <Tag color={statusColor(value)}>{value}</Tag> },
                    { title: "Mode", dataIndex: "livemode", render: (value) => (value ? "live" : "test") },
                    { title: "Processed", dataIndex: "processedAt", render: formatLocalTime },
                    { title: "Error", dataIndex: "errorMessage" }
                  ]}
                />
              </div>
            )
          }
        ]}
      />

      <Modal
        open={promotionModalOpen}
        title="创建优惠码"
        okText="创建"
        confirmLoading={saving}
        onOk={() => void handleCreatePromotion()}
        onCancel={() => setPromotionModalOpen(false)}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Code">
            <Input value={promotionForm.code} onChange={(event) => setPromotionForm((current) => ({ ...current, code: event.target.value }))} placeholder="SPRING25" />
          </Form.Item>
          <Form.Item label="Name">
            <Input value={promotionForm.name} onChange={(event) => setPromotionForm((current) => ({ ...current, name: event.target.value }))} placeholder="Spring campaign" />
          </Form.Item>
          <Form.Item label="Type">
            <Select
              value={promotionForm.type}
              onChange={(type) => setPromotionForm((current) => ({ ...current, type }))}
              options={[
                { value: "gift_days", label: "Gift days" },
                { value: "percent_off", label: "Percent off" },
                { value: "amount_off", label: "Amount off cents" },
                { value: "free_access", label: "Free access" }
              ]}
            />
          </Form.Item>
          <Form.Item label="Value">
            <InputNumber min={0} value={promotionForm.value} onChange={(value) => setPromotionForm((current) => ({ ...current, value: Number(value ?? 0) }))} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Eligible plans">
            <Select mode="multiple" allowClear value={promotionForm.eligiblePlanIds} onChange={(eligiblePlanIds) => setPromotionForm((current) => ({ ...current, eligiblePlanIds }))} options={planOptions} />
          </Form.Item>
          <Form.Item label="Eligible email domains">
            <Input value={promotionForm.eligibleEmailDomains} onChange={(event) => setPromotionForm((current) => ({ ...current, eligibleEmailDomains: event.target.value }))} placeholder="example.com, customer.com" />
          </Form.Item>
          <Form.Item label="Expires at">
            <Input type="datetime-local" value={promotionForm.expiresAt} onChange={(event) => setPromotionForm((current) => ({ ...current, expiresAt: event.target.value }))} />
          </Form.Item>
          <Form.Item label="Note">
            <Input.TextArea value={promotionForm.note} onChange={(event) => setPromotionForm((current) => ({ ...current, note: event.target.value }))} rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={giftModalOpen}
        title="赠送订阅时长"
        okText="确认赠送"
        confirmLoading={saving}
        onOk={() => void handleGrantGiftDays()}
        onCancel={() => setGiftModalOpen(false)}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Organization">
            <Select showSearch value={giftForm.organizationId} onChange={(organizationId) => setGiftForm((current) => ({ ...current, organizationId }))} options={organizationOptions} />
          </Form.Item>
          <Form.Item label="Plan">
            <Select value={giftForm.planId} onChange={(planId) => setGiftForm((current) => ({ ...current, planId }))} options={planOptions} />
          </Form.Item>
          <Form.Item label="Days">
            <InputNumber min={1} value={giftForm.days} onChange={(days) => setGiftForm((current) => ({ ...current, days: Number(days ?? 1) }))} style={{ width: "100%" }} />
          </Form.Item>
          <Form.Item label="Reason">
            <Input.TextArea value={giftForm.reason} onChange={(event) => setGiftForm((current) => ({ ...current, reason: event.target.value }))} rows={3} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={paymentLinkModalOpen}
        title="创建付款链接"
        okText={createdPaymentLink ? "重新创建" : "创建"}
        confirmLoading={saving}
        onOk={() => void handleCreatePaymentLink()}
        onCancel={() => {
          setPaymentLinkModalOpen(false);
          setCreatedPaymentLink(null);
        }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Organization">
            <Select showSearch value={paymentLinkForm.organizationId} onChange={(organizationId) => setPaymentLinkForm((current) => ({ ...current, organizationId }))} options={organizationOptions} />
          </Form.Item>
          <Form.Item label="Plan">
            <Select value={paymentLinkForm.planId} onChange={(planId) => setPaymentLinkForm((current) => ({ ...current, planId }))} options={planOptions} />
          </Form.Item>
          <Form.Item label="Promotion code">
            <Input value={paymentLinkForm.promotionCode} onChange={(event) => setPaymentLinkForm((current) => ({ ...current, promotionCode: event.target.value }))} />
          </Form.Item>
          <Form.Item label="Auto renew">
            <Switch checked={paymentLinkForm.autoRenew} onChange={(autoRenew) => setPaymentLinkForm((current) => ({ ...current, autoRenew }))} />
          </Form.Item>
          {createdPaymentLink ? (
            <Alert
              type="success"
              showIcon
              message="付款链接"
              description={<a href={createdPaymentLink} target="_blank" rel="noreferrer">{createdPaymentLink}</a>}
            />
          ) : null}
        </Form>
      </Modal>

      <Drawer
        title="优惠码详情"
        open={Boolean(editingPromotion)}
        width={420}
        onClose={() => setEditingPromotion(null)}
      >
        {editingPromotion ? (
          <div className="admin-billing-drawer-stack">
            <div className="admin-billing-detail-grid">
              <div><span>Code</span><strong>{editingPromotion.code}</strong></div>
              <div><span>Type</span><strong>{editingPromotion.type}</strong></div>
              <div><span>Value</span><strong>{editingPromotion.value}</strong></div>
              <div><span>Status</span><strong>{editingPromotion.status}</strong></div>
            </div>
            <p>{editingPromotion.note || "无备注"}</p>
            <Space>
              <Button loading={saving} onClick={() => void handlePatchPromotionStatus(editingPromotion, editingPromotion.status === "active" ? "disabled" : "active")}>
                {editingPromotion.status === "active" ? "停用" : "启用"}
              </Button>
              <Tooltip title="赠送天数会通过订单和授权记录落库">
                <Button icon={<Gift size={16} />} onClick={() => {
                  setGiftForm(createGiftFormState(selectedAccount, selectedAccount?.grant?.planId ?? data?.plans[0]?.id));
                  setGiftModalOpen(true);
                }}>
                  赠送时长
                </Button>
              </Tooltip>
            </Space>
          </div>
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(editingPlan)}
        title={editingPlan ? `${editingPlan.name} · 售卖配置` : "售卖配置"}
        okText="保存"
        confirmLoading={saving}
        onOk={() => void handleSavePlanBilling()}
        onCancel={() => setEditingPlan(null)}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label="Billing status">
            <Select
              value={planBillingForm.billingStatus}
              onChange={(billingStatus) => setPlanBillingForm((current) => ({ ...current, billingStatus }))}
              options={[
                { value: "active", label: "active · Portal 可购买" },
                { value: "not_configured", label: "not_configured · 暂不售卖" },
                { value: "disabled", label: "disabled · 停止售卖" }
              ]}
            />
          </Form.Item>
          <Form.Item label="Price cents">
            <InputNumber
              min={0}
              value={planBillingForm.billingPriceCents}
              placeholder="例如 19900 表示 199.00"
              onChange={(billingPriceCents) => setPlanBillingForm((current) => ({ ...current, billingPriceCents: billingPriceCents ?? null }))}
              style={{ width: "100%" }}
            />
          </Form.Item>
          <Form.Item label="Currency">
            <Input
              value={planBillingForm.billingCurrency}
              maxLength={3}
              onChange={(event) => setPlanBillingForm((current) => ({ ...current, billingCurrency: event.target.value.toLowerCase() }))}
            />
          </Form.Item>
          <Form.Item label="Billing interval">
            <Select
              value={planBillingForm.billingInterval}
              onChange={(billingInterval) => setPlanBillingForm((current) => ({ ...current, billingInterval }))}
              options={[
                { value: "month", label: "month" },
                { value: "year", label: "year" },
                { value: "week", label: "week" },
                { value: "day", label: "day" }
              ]}
            />
          </Form.Item>
          <Form.Item label="Interval count">
            <InputNumber
              min={1}
              value={planBillingForm.billingIntervalCount}
              onChange={(billingIntervalCount) => setPlanBillingForm((current) => ({ ...current, billingIntervalCount: Number(billingIntervalCount ?? 1) }))}
              style={{ width: "100%" }}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Drawer
        title="订单详情"
        open={Boolean(selectedOrder)}
        width={460}
        onClose={() => setSelectedOrder(null)}
      >
        {selectedOrder ? (
          <OrderDetailPanel order={selectedOrder} organizationName={data?.customers.find((item) => item.organization.id === selectedOrder.organizationId)?.organization.name ?? selectedOrder.organizationId} />
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(editingEmailRule)}
        title="编辑邮件规则"
        okText="保存"
        confirmLoading={saving}
        onOk={() => void handleSaveEmailRule()}
        onCancel={() => setEditingEmailRule(null)}
        destroyOnHidden
      >
        {editingEmailRule ? (
          <Form layout="vertical">
            <Form.Item label="Status">
              <Select value={editingEmailRule.status} onChange={(status) => setEditingEmailRule((current) => current ? { ...current, status } : current)} options={[
                { value: "enabled", label: "enabled" },
                { value: "disabled", label: "disabled" }
              ]} />
            </Form.Item>
            <Form.Item label="Subject">
              <Input value={editingEmailRule.subject} onChange={(event) => setEditingEmailRule((current) => current ? { ...current, subject: event.target.value } : current)} />
            </Form.Item>
            <Form.Item label="Text template">
              <Input.TextArea rows={5} value={editingEmailRule.bodyText} onChange={(event) => setEditingEmailRule((current) => current ? { ...current, bodyText: event.target.value } : current)} />
            </Form.Item>
            <div className="admin-billing-template-vars">
              {["{{company_name}}", "{{plan_name}}", "{{expires_at_local}}", "{{renew_url}}"].map((item) => (
                <Tag key={item}>{item}</Tag>
              ))}
            </div>
          </Form>
        ) : null}
      </Modal>
    </div>
  );
}
