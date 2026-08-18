import { api } from "../../lib/api";

type PortalSubscriptionStatusPayload = {
  status: {
    access_state: "available" | "blocked";
    tone: "positive" | "caution" | "critical" | "neutral";
    source_type: "user" | "organization" | "default_internal" | "default_external";
    source_label: string;
    title: string;
    summary: string;
    detail: string;
    action_label?: string | null;
    plan_name?: string | null;
    expires_at?: string | null;
    cycle_ends_at?: string | null;
    remaining_completed_turns?: number | null;
    completed_turn_limit?: number | null;
    reason_code?: string | null;
  };
};

export type PortalSubscriptionStatus = {
  accessState: "available" | "blocked";
  tone: "positive" | "caution" | "critical" | "neutral";
  sourceType: "user" | "organization" | "default_internal" | "default_external";
  sourceLabel: string;
  title: string;
  summary: string;
  detail: string;
  actionLabel?: string;
  planName?: string;
  expiresAt?: string;
  cycleEndsAt?: string;
  remainingCompletedTurns: number | null;
  completedTurnLimit: number | null;
  reasonCode?: string;
};

export type PortalBillingPlan = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  status: string;
  billingCurrency: string;
  billingInterval: string;
  billingIntervalCount: number;
  billingPriceCents: number | null;
  billingStatus: string;
  durationDays: number;
  monthlyCompletedTurnLimit?: number | null;
  monthlyTokenLimit?: number | null;
};

export type PortalBillingCustomer = {
  id: string;
  organizationId: string;
  businessEmail?: string | null;
  companyName?: string | null;
  contactName?: string | null;
  countryRegion?: string | null;
  sn?: string | null;
  salesContact?: string | null;
  billingEmail?: string | null;
  stripeCustomerId?: string | null;
  defaultAutoRenew: boolean;
};

export type PortalBillingGrant = {
  id: string;
  planId?: string | null;
  planName?: string | null;
  status: string;
  startsAt?: string | null;
  expiresAt?: string | null;
  note?: string | null;
};

export type PortalBillingAutoRenewal = {
  id: string;
  status: string;
  planId?: string | null;
  paymentMethodStatus: string;
  nextRenewalAt?: string | null;
  lastPaymentFailedAt?: string | null;
  cancelAtPeriodEnd: boolean;
};

export type PortalBillingOrder = {
  id: string;
  orderNumber: string;
  planId?: string | null;
  planName?: string | null;
  status: string;
  source: string;
  checkoutMode: string;
  currency: string;
  amountSubtotalCents: number;
  discountCents: number;
  amountTotalCents: number;
  durationDays: number;
  giftDays: number;
  autoRenew: boolean;
  entitlementExpiresAt?: string | null;
  paidAt?: string | null;
  createdAt?: string | null;
};

export type PortalBillingSummary = {
  brand: {
    name: string;
    merchantName?: string;
    supportEmail?: string;
    supportUrl?: string;
    paymentReady: boolean;
  } | null;
  organization: {
    id: string;
    name: string;
    slug: string;
    type: string;
  };
  billingCustomer: PortalBillingCustomer;
  currentGrant: PortalBillingGrant | null;
  autoRenewal: PortalBillingAutoRenewal | null;
  plans: PortalBillingPlan[];
  recentOrders: PortalBillingOrder[];
  promotionRedemptions: Array<{
    id: string;
    code: string;
    discountCents: number;
    giftDays: number;
    status: string;
    createdAt?: string | null;
  }>;
  defaults: {
    autoRenew: boolean;
    stripeReady: boolean;
  };
};

export type PortalBillingSummaryResponse = {
  billing: PortalBillingSummary;
  subscriptionStatus: PortalSubscriptionStatus | null;
};

export type PortalPromotionPreview = {
  promotion: {
    id: string;
    code: string;
    type: string;
    value: number;
    status: string;
    expiresAt?: string | null;
  } | null;
  discountCents: number;
  giftDays: number;
  amountTotalCents: number;
  message?: string | null;
};

export type PortalCheckoutResponse = {
  checkoutUrl: string | null;
  order: PortalBillingOrder;
  promotion: PortalPromotionPreview;
  stripe: {
    secretKeyConfigured: boolean;
    webhookSigningSecretConfigured: boolean;
    successUrlConfigured: boolean;
    cancelUrlConfigured: boolean;
  };
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizePortalSubscriptionStatus(payload: PortalSubscriptionStatusPayload["status"]): PortalSubscriptionStatus {
  return {
    accessState: payload.access_state,
    tone: payload.tone,
    sourceType: payload.source_type,
    sourceLabel: payload.source_label,
    title: payload.title,
    summary: payload.summary,
    detail: payload.detail,
    actionLabel: trimOrUndefined(payload.action_label),
    planName: trimOrUndefined(payload.plan_name),
    expiresAt: trimOrUndefined(payload.expires_at),
    cycleEndsAt: trimOrUndefined(payload.cycle_ends_at),
    remainingCompletedTurns: payload.remaining_completed_turns ?? null,
    completedTurnLimit: payload.completed_turn_limit ?? null,
    reasonCode: trimOrUndefined(payload.reason_code)
  };
}

export async function fetchPortalSubscriptionStatus(): Promise<PortalSubscriptionStatus> {
  const response = await api<PortalSubscriptionStatusPayload>("/api/portal/subscription-status");
  return normalizePortalSubscriptionStatus(response.status);
}

export async function fetchPortalBillingSummary(): Promise<PortalBillingSummaryResponse> {
  return api<PortalBillingSummaryResponse>("/api/portal/billing/summary");
}

export async function previewPortalPromotion(input: {
  planId: string;
  code: string;
}): Promise<PortalPromotionPreview> {
  const response = await api<{ promotion: PortalPromotionPreview }>("/api/portal/billing/promotion/preview", {
    method: "POST",
    json: {
      planId: input.planId,
      code: input.code
    }
  });
  return response.promotion;
}

export async function createPortalBillingCheckout(input: {
  planId: string;
  promotionCode?: string;
  autoRenew: boolean;
}): Promise<PortalCheckoutResponse> {
  return api<PortalCheckoutResponse>("/api/portal/billing/checkout", {
    method: "POST",
    json: {
      planId: input.planId,
      promotionCode: input.promotionCode || undefined,
      autoRenew: input.autoRenew
    }
  });
}
