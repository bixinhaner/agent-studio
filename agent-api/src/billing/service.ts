import crypto from "node:crypto";
import type { Prisma, PrismaClient } from "@prisma/client";

import type { AuthEmailSender } from "../auth/email.js";
import type { NotificationRecordRepository } from "../persistence/notification-record-repository.js";

type BillingConfig = {
  stripeSecretKey: string;
  stripeWebhookSigningSecret: string;
  successUrl: string;
  cancelUrl: string;
  defaultCurrency: string;
  defaultAutoRenew: boolean;
};

type BillingConfigSource = "admin" | "environment";

type BillingResolvedConfig = BillingConfig & {
  source: BillingConfigSource;
  mode: "test" | "live" | "unknown";
  secretKeyPreview: string | null;
  webhookSigningSecretPreview: string | null;
  updatedAt: string | null;
  rotatedAt: string | null;
};

type BillingOrganizationInput = {
  id: string;
  name?: string | null;
  slug?: string | null;
  type?: string | null;
};

type BillingUserInput = {
  id: string;
  email?: string | null;
  displayName?: string | null;
};

type StripeCheckoutSession = {
  id: string;
  url?: string | null;
  mode?: string | null;
  customer?: string | null;
  customer_email?: string | null;
  payment_status?: string | null;
  payment_intent?: string | null;
  subscription?: string | null;
  client_reference_id?: string | null;
  metadata?: Record<string, string> | null;
};

type StripeSubscription = {
  id: string;
  customer?: string | null;
  status?: string | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
};

type StripeProduct = {
  id: string;
  name?: string | null;
  active?: boolean | null;
};

type StripeInvoice = {
  id: string;
  customer?: string | null;
  subscription?: string | null;
  amount_paid?: number | null;
  currency?: string | null;
  billing_reason?: string | null;
  lines?: {
    data?: Array<{
      period?: {
        start?: number | null;
        end?: number | null;
      } | null;
    }>;
  } | null;
};

type StripeEvent = {
  id: string;
  type: string;
  livemode?: boolean;
  created?: number;
  data?: {
    object?: unknown;
  };
};

type PromotionPreview = {
  promotion: {
    id: string;
    code: string;
    type: string;
    value: number;
    status: string;
    expiresAt: string | null;
  } | null;
  discountCents: number;
  giftDays: number;
  amountTotalCents: number;
  message: string | null;
};

const STRIPE_API_BASE = "https://api.stripe.com/v1";
const STRIPE_BILLING_INTEGRATION_TYPE = "stripe";
const STRIPE_BILLING_INTEGRATION_SLUG = "billing-stripe";
const STRIPE_WEBHOOK_ENDPOINT_PATH = "/api/integrations/stripe/webhook";
const STRIPE_REQUIRED_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "invoice.payment_failed",
  "customer.subscription.updated",
  "customer.subscription.deleted"
];
const BILLING_EVENT_TYPES = {
  expiring: "billing.subscription.expiring_email",
  expired: "billing.subscription.expired_email",
  autoRenewFailed: "billing.auto_renew.failed_email"
} as const;

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  const email = trimOrUndefined(value)?.toLowerCase();
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? trimOrUndefined(value) : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function normalizeCurrency(value: string | null | undefined, fallback = "usd"): string {
  const currency = trimOrUndefined(value)?.toLowerCase() ?? fallback;
  if (!/^[a-z]{3}$/.test(currency)) {
    throw new Error("currency must be a 3-letter ISO code");
  }
  return currency;
}

function normalizeStripeMode(value: string | null | undefined): "test" | "live" | undefined {
  const mode = trimOrUndefined(value)?.toLowerCase();
  if (!mode) return undefined;
  if (mode === "test" || mode === "live") return mode;
  throw new Error("Stripe mode must be test or live");
}

function inferStripeMode(secretKey: string | null | undefined): "test" | "live" | "unknown" {
  const key = trimOrUndefined(secretKey) ?? "";
  if (/^(sk|rk)_live_/.test(key)) return "live";
  if (/^(sk|rk)_test_/.test(key)) return "test";
  return "unknown";
}

function assertStripeSecretKey(value: string): void {
  if (!/^(sk|rk)_(test|live)_/.test(value)) {
    throw new Error("Stripe secret key must start with sk_test_, sk_live_, rk_test_, or rk_live_");
  }
}

function assertWebhookSigningSecret(value: string): void {
  if (!value.startsWith("whsec_")) {
    throw new Error("Stripe webhook signing secret must start with whsec_");
  }
}

function assertHttpUrl(value: string, fieldLabel: string): void {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("invalid protocol");
    }
  } catch {
    throw new Error(`${fieldLabel} must be a valid http(s) URL`);
  }
}

function previewSecret(value: string | null | undefined): string | null {
  const secret = trimOrUndefined(value);
  if (!secret) return null;
  const prefix = secret.slice(0, Math.min(8, secret.length));
  const suffix = secret.length > 4 ? secret.slice(-4) : "";
  return suffix ? `${prefix}...${suffix}` : `${prefix}...`;
}

function normalizeCode(value: string | null | undefined): string | undefined {
  return trimOrUndefined(value)?.toUpperCase().replace(/\s+/g, "");
}

function toIsoString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const parsed = value instanceof Date ? value : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + Math.max(0, days));
  return next;
}

function durationDaysForPlan(plan: {
  billingInterval: string;
  billingIntervalCount: number;
}): number {
  const count = Math.max(1, plan.billingIntervalCount || 1);
  switch ((plan.billingInterval || "month").toLowerCase()) {
    case "day":
      return count;
    case "week":
      return count * 7;
    case "year":
      return count * 365;
    case "month":
    default:
      return count * 30;
  }
}

function centsLabel(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: (currency || "usd").toUpperCase()
  }).format(cents / 100);
}

function randomOrderNumber(): string {
  const dayKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  return `AS-${dayKey}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
}

function isJsonArray(value: Prisma.JsonValue | null | undefined): value is Prisma.JsonArray {
  return Array.isArray(value);
}

function jsonStringArray(value: Prisma.JsonValue | null | undefined): string[] {
  if (!isJsonArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function jsonAudience(value: Prisma.JsonValue | null | undefined): {
  billingContacts: boolean;
  organizationAdmins: boolean;
  salesContact: boolean;
} {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    billingContacts: input.billingContacts !== false,
    organizationAdmins: input.organizationAdmins !== false,
    salesContact: input.salesContact !== false
  };
}

function stripeInterval(value: string): "day" | "week" | "month" | "year" {
  if (value === "day" || value === "week" || value === "year") return value;
  return "month";
}

function stripeProductIdForPlan(planId: string): string {
  const normalized = planId.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64);
  return `as_plan_${normalized}`;
}

function normalizeBillingInterval(value: string | null | undefined): "day" | "week" | "month" | "year" | undefined {
  const interval = trimOrUndefined(value)?.toLowerCase();
  if (!interval) return undefined;
  if (interval === "day" || interval === "week" || interval === "month" || interval === "year") return interval;
  throw new Error("billing interval must be day, week, month, or year");
}

function normalizeBillingStatus(value: string | null | undefined): "active" | "not_configured" | "disabled" | undefined {
  const status = trimOrUndefined(value)?.toLowerCase();
  if (!status) return undefined;
  if (status === "active" || status === "not_configured" || status === "disabled") return status;
  throw new Error("billing status must be active, not_configured, or disabled");
}

function parseNullableNonNegativeInteger(value: number | null | undefined, fieldLabel: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${fieldLabel} must be 0 or a positive integer`);
  }
  return value;
}

function parsePositiveInteger(value: number | null | undefined, fieldLabel: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${fieldLabel} must be a positive integer`);
  }
  return value;
}

function encodeStripeForm(input: Record<string, string | number | boolean | null | undefined>): URLSearchParams {
  const form = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    form.append(key, String(value));
  });
  return form;
}

function renderTemplate(template: string, variables: Record<string, string>): string {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => variables[key] ?? "");
}

function dateKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function isStripeCheckoutSession(value: unknown): value is StripeCheckoutSession {
  return Boolean(value && typeof value === "object" && typeof (value as StripeCheckoutSession).id === "string");
}

function isStripeInvoice(value: unknown): value is StripeInvoice {
  return Boolean(value && typeof value === "object" && typeof (value as StripeInvoice).id === "string");
}

function isStripeSubscription(value: unknown): value is StripeSubscription {
  return Boolean(value && typeof value === "object" && typeof (value as StripeSubscription).id === "string");
}

function stripeSignatureHeaderParts(header: string): { timestamp: string; signatures: string[] } {
  const parts = header.split(",").map((part) => part.trim()).filter(Boolean);
  let timestamp = "";
  const signatures: string[] = [];
  for (const part of parts) {
    const [key, value] = part.split("=", 2);
    if (key === "t") timestamp = value ?? "";
    if (key === "v1" && value) signatures.push(value);
  }
  return { timestamp, signatures };
}

export class BillingService {
  constructor(
    private readonly options: {
      db: PrismaClient;
      config: BillingConfig;
      emailSender?: AuthEmailSender;
      notifications?: NotificationRecordRepository;
    }
  ) {}

  private get db() {
    return this.options.db;
  }

  private async resolveBillingConfig(): Promise<BillingResolvedConfig> {
    const fallback: BillingConfig = {
      stripeSecretKey: trimOrUndefined(this.options.config.stripeSecretKey) ?? "",
      stripeWebhookSigningSecret: trimOrUndefined(this.options.config.stripeWebhookSigningSecret) ?? "",
      successUrl: trimOrUndefined(this.options.config.successUrl) ?? "",
      cancelUrl: trimOrUndefined(this.options.config.cancelUrl) ?? "",
      defaultCurrency: normalizeCurrency(this.options.config.defaultCurrency || "usd"),
      defaultAutoRenew: this.options.config.defaultAutoRenew !== false
    };

    const instance = await this.db.integrationInstance.findUnique({
      where: {
        type_slug: {
          type: STRIPE_BILLING_INTEGRATION_TYPE,
          slug: STRIPE_BILLING_INTEGRATION_SLUG
        }
      },
      include: {
        config: true,
        secret: true
      }
    });

    const config = asRecord(instance?.config?.config);
    const secret = asRecord(instance?.secret?.secretState);
    const stripeSecretKey = asString(secret.stripeSecretKey) ?? fallback.stripeSecretKey;
    const webhookSigningSecret = asString(secret.webhookSigningSecret) ?? fallback.stripeWebhookSigningSecret;
    const configuredMode = normalizeStripeMode(asString(config.mode) ?? undefined);
    const inferredMode = inferStripeMode(stripeSecretKey);
    const mode = configuredMode && (inferredMode === "unknown" || configuredMode === inferredMode)
      ? configuredMode
      : inferredMode;

    return {
      stripeSecretKey,
      stripeWebhookSigningSecret: webhookSigningSecret,
      successUrl: asString(config.successUrl) ?? fallback.successUrl,
      cancelUrl: asString(config.cancelUrl) ?? fallback.cancelUrl,
      defaultCurrency: normalizeCurrency(asString(config.defaultCurrency), fallback.defaultCurrency),
      defaultAutoRenew: asBoolean(config.defaultAutoRenew) ?? fallback.defaultAutoRenew,
      source: instance ? "admin" : "environment",
      mode: mode === "test" || mode === "live" ? mode : "unknown",
      secretKeyPreview: previewSecret(stripeSecretKey),
      webhookSigningSecretPreview: previewSecret(webhookSigningSecret),
      updatedAt: toIsoString(instance?.config?.updatedAt ?? instance?.updatedAt),
      rotatedAt: toIsoString(instance?.secret?.rotatedAt)
    };
  }

  async stripeConfigStatus() {
    const config = await this.resolveBillingConfig();
    return {
      source: config.source,
      mode: config.mode,
      secretKeyConfigured: Boolean(config.stripeSecretKey),
      webhookSigningSecretConfigured: Boolean(config.stripeWebhookSigningSecret),
      successUrlConfigured: Boolean(trimOrUndefined(config.successUrl)),
      cancelUrlConfigured: Boolean(trimOrUndefined(config.cancelUrl)),
      successUrl: config.successUrl,
      cancelUrl: config.cancelUrl,
      defaultCurrency: config.defaultCurrency,
      defaultAutoRenew: config.defaultAutoRenew,
      secretKeyPreview: config.secretKeyPreview,
      webhookSigningSecretPreview: config.webhookSigningSecretPreview,
      webhookEndpointPath: STRIPE_WEBHOOK_ENDPOINT_PATH,
      requiredWebhookEvents: STRIPE_REQUIRED_WEBHOOK_EVENTS,
      updatedAt: config.updatedAt,
      rotatedAt: config.rotatedAt
    };
  }

  async updateStripeSettings(input: {
    mode?: string | null;
    stripeSecretKey?: string | null;
    webhookSigningSecret?: string | null;
    successUrl?: string | null;
    cancelUrl?: string | null;
    defaultCurrency?: string | null;
    defaultAutoRenew?: boolean | null;
    clearStripeSecretKey?: boolean;
    clearWebhookSigningSecret?: boolean;
    userId?: string | null;
  }) {
    const current = await this.db.integrationInstance.findUnique({
      where: {
        type_slug: {
          type: STRIPE_BILLING_INTEGRATION_TYPE,
          slug: STRIPE_BILLING_INTEGRATION_SLUG
        }
      },
      include: {
        config: true,
        secret: true
      }
    });

    const currentConfig = asRecord(current?.config?.config);
    const currentSecret = asRecord(current?.secret?.secretState);
    const nextConfig: Record<string, unknown> = { ...currentConfig };
    const nextSecret: Record<string, unknown> = { ...currentSecret };

    if (input.mode !== undefined && input.mode !== null) {
      nextConfig.mode = normalizeStripeMode(input.mode) ?? "test";
    }
    if (input.successUrl !== undefined && input.successUrl !== null) {
      const successUrl = trimOrUndefined(input.successUrl) ?? "";
      if (successUrl) assertHttpUrl(successUrl, "successUrl");
      nextConfig.successUrl = successUrl;
    }
    if (input.cancelUrl !== undefined && input.cancelUrl !== null) {
      const cancelUrl = trimOrUndefined(input.cancelUrl) ?? "";
      if (cancelUrl) assertHttpUrl(cancelUrl, "cancelUrl");
      nextConfig.cancelUrl = cancelUrl;
    }
    if (input.defaultCurrency !== undefined && input.defaultCurrency !== null) {
      nextConfig.defaultCurrency = normalizeCurrency(input.defaultCurrency);
    }
    if (input.defaultAutoRenew !== undefined && input.defaultAutoRenew !== null) {
      nextConfig.defaultAutoRenew = input.defaultAutoRenew;
    }

    let secretChanged = false;
    if (input.clearStripeSecretKey) {
      delete nextSecret.stripeSecretKey;
      secretChanged = true;
    } else {
      const stripeSecretKey = asString(input.stripeSecretKey);
      if (stripeSecretKey) {
        assertStripeSecretKey(stripeSecretKey);
        nextSecret.stripeSecretKey = stripeSecretKey;
        secretChanged = true;
      }
    }
    if (input.clearWebhookSigningSecret) {
      delete nextSecret.webhookSigningSecret;
      secretChanged = true;
    } else {
      const webhookSigningSecret = asString(input.webhookSigningSecret);
      if (webhookSigningSecret) {
        assertWebhookSigningSecret(webhookSigningSecret);
        nextSecret.webhookSigningSecret = webhookSigningSecret;
        secretChanged = true;
      }
    }

    const configuredMode = normalizeStripeMode(asString(nextConfig.mode) ?? undefined);
    const effectiveSecretKey = asString(nextSecret.stripeSecretKey) ?? trimOrUndefined(this.options.config.stripeSecretKey);
    const keyMode = inferStripeMode(effectiveSecretKey);
    if (configuredMode && keyMode !== "unknown" && configuredMode !== keyMode) {
      throw new Error("Stripe mode does not match the secret key prefix");
    }

    const instance = await this.db.integrationInstance.upsert({
      where: {
        type_slug: {
          type: STRIPE_BILLING_INTEGRATION_TYPE,
          slug: STRIPE_BILLING_INTEGRATION_SLUG
        }
      },
      update: {
        name: "Stripe Billing",
        description: "Agent Studio billing checkout and auto-renewal settings.",
        status: "active",
        isSystemSingleton: true
      },
      create: {
        type: STRIPE_BILLING_INTEGRATION_TYPE,
        slug: STRIPE_BILLING_INTEGRATION_SLUG,
        name: "Stripe Billing",
        description: "Agent Studio billing checkout and auto-renewal settings.",
        status: "active",
        isSystemSingleton: true
      }
    });

    await this.db.integrationInstanceConfig.upsert({
      where: { integrationInstanceId: instance.id },
      create: {
        integrationInstanceId: instance.id,
        config: nextConfig as Prisma.InputJsonValue
      },
      update: {
        config: nextConfig as Prisma.InputJsonValue
      }
    });

    const hasSecrets = Object.keys(nextSecret).length > 0;
    await this.db.integrationInstanceSecret.upsert({
      where: { integrationInstanceId: instance.id },
      create: {
        integrationInstanceId: instance.id,
        hasSecrets,
        secretState: nextSecret as Prisma.InputJsonValue,
        rotatedAt: secretChanged ? new Date() : null,
        rotatedByUserId: secretChanged ? trimOrUndefined(input.userId) ?? null : null
      },
      update: {
        hasSecrets,
        secretState: nextSecret as Prisma.InputJsonValue,
        ...(secretChanged
          ? {
              rotatedAt: new Date(),
              rotatedByUserId: trimOrUndefined(input.userId) ?? null
            }
          : {})
      }
    });

    return this.stripeConfigStatus();
  }

  async verifyStripeSignature(rawBody: Buffer, signatureHeader: string | undefined): Promise<void> {
    const config = await this.resolveBillingConfig();
    const secret = trimOrUndefined(config.stripeWebhookSigningSecret);
    if (!secret) {
      throw new Error("Stripe webhook signing secret is not configured");
    }
    const header = trimOrUndefined(signatureHeader);
    if (!header) {
      throw new Error("Stripe signature header is missing");
    }
    const { timestamp, signatures } = stripeSignatureHeaderParts(header);
    if (!timestamp || signatures.length === 0) {
      throw new Error("Stripe signature header is invalid");
    }
    const timestampMs = Number(timestamp) * 1000;
    if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > 5 * 60 * 1000) {
      throw new Error("Stripe signature timestamp is outside tolerance");
    }
    const expected = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody.toString("utf8")}`).digest("hex");
    const expectedBuffer = Buffer.from(expected, "hex");
    const matched = signatures.some((signature) => {
      const signatureBuffer = Buffer.from(signature, "hex");
      return signatureBuffer.length === expectedBuffer.length && crypto.timingSafeEqual(signatureBuffer, expectedBuffer);
    });
    if (!matched) {
      throw new Error("Stripe signature verification failed");
    }
  }

  async getAdminOverview() {
    const [
      organizations,
      customers,
      plans,
      grants,
      orders,
      autoRenewals,
      promotionCodes,
      emailRules,
      stripeEvents,
      notifications,
      stripe
    ] = await Promise.all([
      this.db.organization.findMany({
        where: { type: "customer" },
        orderBy: { updatedAt: "desc" },
        take: 250,
        select: { id: true, slug: true, name: true, type: true, status: true, ownerUserId: true, createdAt: true, updatedAt: true }
      }),
      this.db.billingCustomer.findMany({ orderBy: { updatedAt: "desc" }, take: 250 }),
      this.db.subscriptionPlan.findMany({ orderBy: [{ billingStatus: "asc" }, { name: "asc" }] }),
      this.db.subscriptionGrant.findMany({
        where: { principalType: "organization" },
        orderBy: [{ updatedAt: "desc" }]
      }),
      this.db.billingOrder.findMany({ orderBy: { createdAt: "desc" }, take: 250 }),
      this.db.billingAutoRenewal.findMany({ orderBy: { updatedAt: "desc" }, take: 250 }),
      this.db.promotionCode.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 250 }),
      this.db.billingEmailRule.findMany({ orderBy: [{ triggerType: "asc" }, { offsetDays: "desc" }] }),
      this.db.billingStripeEvent.findMany({ orderBy: { createdAt: "desc" }, take: 40 }),
      this.db.notificationRecord.findMany({
        where: { channelType: "email" },
        orderBy: { createdAt: "desc" },
        take: 80
      }),
      this.stripeConfigStatus()
    ]);

    const customerByOrg = new Map(customers.map((customer) => [customer.organizationId, customer]));
    const grantByOrg = new Map(grants.map((grant) => [grant.principalId, grant]));
    const planById = new Map(plans.map((plan) => [plan.id, plan]));
    const autoRenewalByOrg = new Map(autoRenewals.map((item) => [item.organizationId, item]));
    const latestOrderByOrg = new Map<string, (typeof orders)[number]>();
    for (const order of orders) {
      if (!latestOrderByOrg.has(order.organizationId)) latestOrderByOrg.set(order.organizationId, order);
    }
    const now = new Date();
    const expiringBoundary = addDays(now, 14);
    const paidOrders = orders.filter((order) => order.status === "paid");
    const revenueCents = paidOrders.reduce((sum, order) => sum + Math.max(0, order.amountTotalCents), 0);
    const activeAutoRenewals = autoRenewals.filter((item) => item.status === "enabled");
    const failedAutoRenewals = autoRenewals.filter((item) => item.status === "payment_failed");
    const expiringGrantCount = grants.filter((grant) => {
      const expiresAt = toDate(grant.expiresAt);
      return expiresAt && expiresAt > now && expiresAt <= expiringBoundary;
    }).length;

    return {
      summary: {
        revenueCents,
        currency: stripe.defaultCurrency || "usd",
        activeSubscriptions: grants.filter((grant) => grant.status === "active" && (!grant.expiresAt || new Date(grant.expiresAt) > now)).length,
        expiringIn14Days: expiringGrantCount,
        failedRenewals: failedAutoRenewals.length,
        activeAutoRenewals: activeAutoRenewals.length,
        promotionCodes: promotionCodes.filter((item) => item.status === "active").length
      },
      customers: organizations.map((organization) => {
        const customer = customerByOrg.get(organization.id);
        const grant = grantByOrg.get(organization.id);
        const plan = grant?.planId ? planById.get(grant.planId) : null;
        const autoRenewal = autoRenewalByOrg.get(organization.id);
        const latestOrder = latestOrderByOrg.get(organization.id);
        return {
          organization,
          billingCustomer: customer ? this.mapBillingCustomer(customer) : null,
          grant: grant ? this.mapGrant(grant, plan ?? null) : null,
          autoRenewal: autoRenewal ? this.mapAutoRenewal(autoRenewal) : null,
          latestOrder: latestOrder ? this.mapOrder(latestOrder, planById.get(latestOrder.planId ?? "") ?? null) : null,
          nextAction: this.nextActionForAccount({ grant, autoRenewal, latestOrder, now })
        };
      }),
      plans: plans.map((plan) => this.mapPlan(plan)),
      orders: orders.map((order) => this.mapOrder(order, planById.get(order.planId ?? "") ?? null)),
      autoRenewals: autoRenewals.map((item) => this.mapAutoRenewal(item)),
      promotionCodes: promotionCodes.map((item) => this.mapPromotionCode(item)),
      emailRules: emailRules.map((item) => this.mapEmailRule(item)),
      stripeEvents: stripeEvents.map((item) => this.mapStripeEvent(item)),
      notifications: notifications.map((item) => ({
        id: item.id,
        organizationId: item.organizationId,
        targetRef: item.targetRef,
        eventType: item.eventType,
        status: item.status,
        payload: item.payload,
        errorMessage: item.errorMessage,
        createdAt: toIsoString(item.createdAt),
        updatedAt: toIsoString(item.updatedAt)
      })),
      stripe
    };
  }

  async getPortalSummary(input: { organization: BillingOrganizationInput; user: BillingUserInput }) {
    const customer = await this.ensureBillingCustomerForOrganization(input);
    const [plans, grant, autoRenewal, orders, redemptions, stripe] = await Promise.all([
      this.listBillablePlans(),
      this.db.subscriptionGrant.findUnique({
        where: {
          principalType_principalId: {
            principalType: "organization",
            principalId: input.organization.id
          }
        },
        include: { plan: true }
      }),
      this.db.billingAutoRenewal.findUnique({ where: { organizationId: input.organization.id } }),
      this.db.billingOrder.findMany({
        where: { organizationId: input.organization.id },
        orderBy: { createdAt: "desc" },
        take: 10
      }),
      this.db.promotionRedemption.findMany({
        where: { organizationId: input.organization.id },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      this.stripeConfigStatus()
    ]);

    return {
      organization: {
        id: input.organization.id,
        name: input.organization.name ?? "",
        slug: input.organization.slug ?? "",
        type: input.organization.type ?? "customer"
      },
      billingCustomer: this.mapBillingCustomer(customer),
      currentGrant: grant ? this.mapGrant(grant, grant.plan ?? null) : null,
      autoRenewal: autoRenewal ? this.mapAutoRenewal(autoRenewal) : null,
      plans: plans.map((plan) => this.mapPlan(plan)),
      recentOrders: orders.map((order) => this.mapOrder(order, plans.find((plan) => plan.id === order.planId) ?? null)),
      promotionRedemptions: redemptions.map((item) => ({
        id: item.id,
        code: item.code,
        discountCents: item.discountCents,
        giftDays: item.giftDays,
        status: item.status,
        createdAt: toIsoString(item.createdAt)
      })),
      defaults: {
        autoRenew: customer.defaultAutoRenew,
        stripeReady: stripe.secretKeyConfigured
      }
    };
  }

  async listBillablePlans() {
    return this.db.subscriptionPlan.findMany({
      where: {
        status: "active",
        billingStatus: "active",
        billingPriceCents: { not: null }
      },
      orderBy: [{ billingStatus: "asc" }, { billingPriceCents: "asc" }, { name: "asc" }]
    });
  }

  async updatePlanBilling(planId: string, input: {
    billingCurrency?: string | null;
    billingInterval?: string | null;
    billingIntervalCount?: number | null;
    billingPriceCents?: number | null;
    billingStatus?: string | null;
  }) {
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: planId } });
    if (!plan) throw new Error("plan does not exist");

    const billingCurrency = input.billingCurrency === undefined ? undefined : normalizeCurrency(input.billingCurrency);
    const billingInterval = input.billingInterval === undefined ? undefined : normalizeBillingInterval(input.billingInterval);
    const billingIntervalCount = parsePositiveInteger(input.billingIntervalCount, "billingIntervalCount");
    const billingPriceCents = parseNullableNonNegativeInteger(input.billingPriceCents, "billingPriceCents");
    const billingStatus = input.billingStatus === undefined ? undefined : normalizeBillingStatus(input.billingStatus);

    const nextStatus = billingStatus ?? plan.billingStatus;
    const nextPrice = billingPriceCents === undefined ? plan.billingPriceCents : billingPriceCents;
    if (nextStatus === "active" && nextPrice === null) {
      throw new Error("Active billing products must have a price");
    }

    const updated = await this.db.subscriptionPlan.update({
      where: { id: plan.id },
      data: {
        billingCurrency,
        billingInterval,
        billingIntervalCount,
        billingPriceCents,
        billingStatus
      }
    });
    return this.mapPlan(updated);
  }

  async createPromotionCode(input: {
    code: string;
    name?: string | null;
    description?: string | null;
    type: string;
    value: number;
    currency?: string | null;
    status?: string | null;
    maxRedemptions?: number | null;
    perCustomerLimit?: number | null;
    startsAt?: string | null;
    expiresAt?: string | null;
    eligiblePlanIds?: string[];
    eligibleOrganizationIds?: string[];
    eligibleEmailDomains?: string[];
    eligibleSnValues?: string[];
    ownerUserId?: string | null;
    createdByUserId?: string | null;
    note?: string | null;
  }) {
    const config = await this.resolveBillingConfig();
    const code = normalizeCode(input.code);
    if (!code) throw new Error("promotion code is required");
    if (!["gift_days", "percent_off", "amount_off", "free_access"].includes(input.type)) {
      throw new Error("promotion type is invalid");
    }
    const row = await this.db.promotionCode.create({
      data: {
        code,
        name: trimOrUndefined(input.name) ?? null,
        description: trimOrUndefined(input.description) ?? null,
        type: input.type,
        value: Math.max(0, Math.floor(input.value || 0)),
        currency: trimOrUndefined(input.currency)?.toLowerCase() ?? config.defaultCurrency ?? "usd",
        status: trimOrUndefined(input.status) ?? "active",
        maxRedemptions: input.maxRedemptions ?? null,
        perCustomerLimit: Math.max(1, input.perCustomerLimit ?? 1),
        startsAt: toDate(input.startsAt) ?? null,
        expiresAt: toDate(input.expiresAt) ?? null,
        eligiblePlanIds: input.eligiblePlanIds?.length ? input.eligiblePlanIds : undefined,
        eligibleOrganizationIds: input.eligibleOrganizationIds?.length ? input.eligibleOrganizationIds : undefined,
        eligibleEmailDomains: input.eligibleEmailDomains?.length ? input.eligibleEmailDomains.map((item) => item.toLowerCase()) : undefined,
        eligibleSnValues: input.eligibleSnValues?.length ? input.eligibleSnValues : undefined,
        ownerUserId: trimOrUndefined(input.ownerUserId) ?? null,
        createdByUserId: trimOrUndefined(input.createdByUserId) ?? null,
        note: trimOrUndefined(input.note) ?? null
      }
    });
    return this.mapPromotionCode(row);
  }

  async updatePromotionCode(promotionCodeId: string, input: {
    name?: string | null;
    description?: string | null;
    status?: string | null;
    maxRedemptions?: number | null;
    perCustomerLimit?: number | null;
    expiresAt?: string | null;
    note?: string | null;
  }) {
    const row = await this.db.promotionCode.update({
      where: { id: promotionCodeId },
      data: {
        name: input.name === undefined ? undefined : trimOrUndefined(input.name) ?? null,
        description: input.description === undefined ? undefined : trimOrUndefined(input.description) ?? null,
        status: input.status === undefined ? undefined : trimOrUndefined(input.status),
        maxRedemptions: input.maxRedemptions === undefined ? undefined : input.maxRedemptions,
        perCustomerLimit: input.perCustomerLimit === undefined || input.perCustomerLimit === null ? undefined : Math.max(1, input.perCustomerLimit),
        expiresAt: input.expiresAt === undefined ? undefined : toDate(input.expiresAt),
        note: input.note === undefined ? undefined : trimOrUndefined(input.note) ?? null
      }
    });
    return this.mapPromotionCode(row);
  }

  async previewPromotion(input: {
    code?: string | null;
    planId: string;
    organizationId: string;
    businessEmail?: string | null;
    sn?: string | null;
  }): Promise<PromotionPreview> {
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new Error("套餐不存在");
    return this.calculatePromotionPreview({
      code: input.code,
      plan,
      organizationId: input.organizationId,
      businessEmail: input.businessEmail,
      sn: input.sn
    });
  }

  async createPortalCheckout(input: {
    organization: BillingOrganizationInput;
    user: BillingUserInput;
    planId: string;
    promotionCode?: string | null;
    autoRenew?: boolean;
  }) {
    const customer = await this.ensureBillingCustomerForOrganization(input);
    return this.createCheckout({
      organization: input.organization,
      user: input.user,
      customer,
      planId: input.planId,
      promotionCode: input.promotionCode,
      autoRenew: input.autoRenew ?? customer.defaultAutoRenew,
      source: "portal"
    });
  }

  async createAdminPaymentLink(input: {
    organizationId: string;
    user: BillingUserInput;
    planId: string;
    promotionCode?: string | null;
    autoRenew?: boolean;
  }) {
    const organization = await this.db.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true, slug: true, type: true }
    });
    if (!organization) throw new Error("organization does not exist");
    const customer = await this.ensureBillingCustomerForOrganization({ organization, user: input.user });
    return this.createCheckout({
      organization,
      user: input.user,
      customer,
      planId: input.planId,
      promotionCode: input.promotionCode,
      autoRenew: input.autoRenew ?? customer.defaultAutoRenew,
      source: "admin_payment_link"
    });
  }

  async grantGiftDays(input: {
    organizationId: string;
    planId: string;
    days: number;
    reason?: string | null;
    userId?: string | null;
    promotionCodeId?: string | null;
  }) {
    const config = await this.resolveBillingConfig();
    const organization = await this.db.organization.findUnique({
      where: { id: input.organizationId },
      select: { id: true, name: true, slug: true, type: true }
    });
    if (!organization) throw new Error("organization does not exist");
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new Error("plan does not exist");
    const customer = await this.ensureBillingCustomerForOrganization({
      organization,
      user: { id: trimOrUndefined(input.userId) ?? "system" }
    });
    const days = Math.max(1, Math.floor(input.days || 0));
    const order = await this.db.billingOrder.create({
      data: {
        orderNumber: randomOrderNumber(),
        organizationId: organization.id,
        billingCustomerId: customer.id,
        planId: plan.id,
        status: "draft",
        source: "admin_gift",
        checkoutMode: "manual",
        currency: plan.billingCurrency || config.defaultCurrency || "usd",
        amountSubtotalCents: 0,
        discountCents: 0,
        amountTotalCents: 0,
        durationDays: 0,
        giftDays: days,
        autoRenew: false,
        promotionCodeId: trimOrUndefined(input.promotionCodeId) ?? null,
        createdByUserId: trimOrUndefined(input.userId) ?? null,
        metadataJson: {
          reason: trimOrUndefined(input.reason) ?? "Admin granted subscription days"
        }
      }
    });
    const fulfilled = await this.fulfillOrder(order.id, { source: "admin_gift" });
    return {
      order: fulfilled.order,
      grant: fulfilled.grant
    };
  }

  async updateEmailRule(ruleId: string, input: {
    status?: string | null;
    audience?: unknown;
    subject?: string | null;
    bodyText?: string | null;
    bodyHtml?: string | null;
    userId?: string | null;
  }) {
    const row = await this.db.billingEmailRule.update({
      where: { id: ruleId },
      data: {
        status: input.status === undefined ? undefined : trimOrUndefined(input.status) ?? "enabled",
        audienceJson: input.audience === undefined ? undefined : input.audience as Prisma.InputJsonValue,
        subject: input.subject === undefined ? undefined : trimOrUndefined(input.subject),
        bodyText: input.bodyText === undefined ? undefined : trimOrUndefined(input.bodyText),
        bodyHtml: input.bodyHtml === undefined ? undefined : trimOrUndefined(input.bodyHtml) ?? null,
        createdByUserId: input.userId === undefined ? undefined : trimOrUndefined(input.userId) ?? null
      }
    });
    return this.mapEmailRule(row);
  }

  async runReminderSweep(input: { now?: Date; testEmail?: string | null } = {}) {
    const now = input.now ?? new Date();
    const rules = await this.db.billingEmailRule.findMany({
      where: { status: "enabled" },
      orderBy: [{ triggerType: "asc" }, { offsetDays: "desc" }]
    });
    const results: Array<{ ruleId: string; sent: number; skipped: number; failed: number }> = [];
    for (const rule of rules) {
      results.push(await this.runReminderRule(rule, { now, testEmail: input.testEmail }));
    }
    return { ok: true, results };
  }

  async handleStripeWebhook(rawBody: Buffer, signatureHeader: string | undefined) {
    await this.verifyStripeSignature(rawBody, signatureHeader);
    const event = JSON.parse(rawBody.toString("utf8")) as StripeEvent;
    const stored = await this.db.billingStripeEvent.upsert({
      where: { stripeEventId: event.id },
      update: {
        eventType: event.type,
        livemode: Boolean(event.livemode),
        payloadJson: event as unknown as Prisma.InputJsonValue,
        status: "processing",
        errorMessage: null
      },
      create: {
        stripeEventId: event.id,
        eventType: event.type,
        livemode: Boolean(event.livemode),
        payloadJson: event as unknown as Prisma.InputJsonValue,
        status: "processing"
      }
    });

    try {
      await this.processStripeEvent(event);
      await this.db.billingStripeEvent.update({
        where: { id: stored.id },
        data: { status: "processed", processedAt: new Date(), errorMessage: null }
      });
      return { ok: true };
    } catch (error) {
      await this.db.billingStripeEvent.update({
        where: { id: stored.id },
        data: {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          processedAt: new Date()
        }
      });
      throw error;
    }
  }

  private async createCheckout(input: {
    organization: BillingOrganizationInput;
    user: BillingUserInput;
    customer: Awaited<ReturnType<BillingService["ensureBillingCustomerForOrganization"]>>;
    planId: string;
    promotionCode?: string | null;
    autoRenew: boolean;
    source: string;
  }) {
    const config = await this.resolveBillingConfig();
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: input.planId } });
    if (!plan) throw new Error("套餐不存在");
    if (plan.status !== "active") throw new Error("套餐未启用");
    if (plan.billingStatus !== "active" || plan.billingPriceCents === null) {
      throw new Error("套餐还没有在 Billing Products 中配置可售价格");
    }
    const basePrice = Math.max(0, plan.billingPriceCents ?? 0);
    const durationDays = durationDaysForPlan(plan);
    const preview = await this.calculatePromotionPreview({
      code: input.promotionCode,
      plan,
      organizationId: input.organization.id,
      businessEmail: input.customer.businessEmail,
      sn: input.customer.sn
    });
    const total = Math.max(0, basePrice - preview.discountCents);
    const checkoutMode = total > 0 ? "payment" : input.autoRenew ? "setup" : "manual";
    const order = await this.db.billingOrder.create({
      data: {
        orderNumber: randomOrderNumber(),
        organizationId: input.organization.id,
        billingCustomerId: input.customer.id,
        planId: plan.id,
        status: checkoutMode === "manual" ? "draft" : "pending_payment",
        source: input.source,
        checkoutMode,
        currency: plan.billingCurrency || config.defaultCurrency || "usd",
        amountSubtotalCents: basePrice,
        discountCents: preview.discountCents,
        amountTotalCents: total,
        durationDays,
        giftDays: preview.giftDays,
        autoRenew: input.autoRenew,
        promotionCodeId: preview.promotion?.id ?? null,
        createdByUserId: trimOrUndefined(input.user.id) ?? null,
        metadataJson: {
          promotionMessage: preview.message,
          organizationName: input.organization.name ?? null
        }
      }
    });

    if (checkoutMode === "manual") {
      const fulfilled = await this.fulfillOrder(order.id, { source: "promotion_free_access" });
      return {
        checkoutUrl: null,
        order: fulfilled.order,
        promotion: preview,
        stripe: await this.stripeConfigStatus()
      };
    }

    const session = await this.createStripeCheckoutSession({
      order,
      plan,
      customer: input.customer,
      organization: input.organization,
      user: input.user,
      mode: checkoutMode
    });
    const updated = await this.db.billingOrder.update({
      where: { id: order.id },
      data: {
        stripeCheckoutSessionId: session.id,
        metadataJson: {
          promotionMessage: preview.message,
          organizationName: input.organization.name ?? null,
          stripeCheckoutSessionMode: session.mode ?? checkoutMode
        }
      }
    });
    return {
      checkoutUrl: session.url ?? null,
      order: this.mapOrder(updated, plan),
      promotion: preview,
      stripe: await this.stripeConfigStatus()
    };
  }

  private async calculatePromotionPreview(input: {
    code?: string | null;
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> extends infer T ? NonNullable<T> : never;
    organizationId: string;
    businessEmail?: string | null;
    sn?: string | null;
  }): Promise<PromotionPreview> {
    const basePrice = Math.max(0, input.plan.billingPriceCents ?? 0);
    const normalizedCode = normalizeCode(input.code);
    if (!normalizedCode) {
      return { promotion: null, discountCents: 0, giftDays: 0, amountTotalCents: basePrice, message: null };
    }
    const promotion = await this.db.promotionCode.findUnique({ where: { code: normalizedCode } });
    if (!promotion) throw new Error("优惠码不存在");
    const now = new Date();
    if (promotion.status !== "active") throw new Error("优惠码未启用");
    if (promotion.startsAt && promotion.startsAt > now) throw new Error("优惠码尚未生效");
    if (promotion.expiresAt && promotion.expiresAt <= now) throw new Error("优惠码已过期");
    const eligiblePlanIds = jsonStringArray(promotion.eligiblePlanIds);
    if (eligiblePlanIds.length && !eligiblePlanIds.includes(input.plan.id)) {
      throw new Error("优惠码不适用于当前套餐");
    }
    const eligibleOrgIds = jsonStringArray(promotion.eligibleOrganizationIds);
    if (eligibleOrgIds.length && !eligibleOrgIds.includes(input.organizationId)) {
      throw new Error("优惠码不适用于当前组织");
    }
    const domain = normalizeEmail(input.businessEmail)?.split("@")[1];
    const eligibleDomains = jsonStringArray(promotion.eligibleEmailDomains).map((item) => item.toLowerCase());
    if (eligibleDomains.length && (!domain || !eligibleDomains.includes(domain))) {
      throw new Error("优惠码不适用于当前邮箱域名");
    }
    const eligibleSnValues = jsonStringArray(promotion.eligibleSnValues).map((item) => item.toLowerCase());
    const sn = trimOrUndefined(input.sn)?.toLowerCase();
    if (eligibleSnValues.length && (!sn || !eligibleSnValues.includes(sn))) {
      throw new Error("优惠码不适用于当前 SN");
    }
    const redeemedCount = await this.db.promotionRedemption.count({
      where: { promotionCodeId: promotion.id, status: "redeemed" }
    });
    if (promotion.maxRedemptions !== null && redeemedCount >= promotion.maxRedemptions) {
      throw new Error("优惠码已达到总兑换次数");
    }
    const customerRedeemedCount = await this.db.promotionRedemption.count({
      where: {
        promotionCodeId: promotion.id,
        organizationId: input.organizationId,
        status: "redeemed"
      }
    });
    if (customerRedeemedCount >= promotion.perCustomerLimit) {
      throw new Error("当前组织已使用过该优惠码");
    }

    let discountCents = 0;
    let giftDays = 0;
    if (promotion.type === "gift_days") {
      giftDays = Math.max(0, promotion.value);
    } else if (promotion.type === "percent_off") {
      discountCents = Math.min(basePrice, Math.floor((basePrice * promotion.value) / 100));
    } else if (promotion.type === "amount_off") {
      discountCents = Math.min(basePrice, Math.max(0, promotion.value));
    } else if (promotion.type === "free_access") {
      discountCents = basePrice;
      giftDays = Math.max(0, promotion.value);
    }

    return {
      promotion: {
        id: promotion.id,
        code: promotion.code,
        type: promotion.type,
        value: promotion.value,
        status: promotion.status,
        expiresAt: toIsoString(promotion.expiresAt)
      },
      discountCents,
      giftDays,
      amountTotalCents: Math.max(0, basePrice - discountCents),
      message: this.promotionMessage(promotion.type, promotion.value, discountCents, planCurrency(input.plan))
    };
  }

  private promotionMessage(type: string, value: number, discountCents: number, currency: string): string {
    if (type === "gift_days") return `赠送 ${value} 天订阅时长`;
    if (type === "percent_off") return `本次支付优惠 ${value}%`;
    if (type === "amount_off") return `本次支付优惠 ${centsLabel(discountCents, currency)}`;
    if (type === "free_access") return value > 0 ? `本次免费并赠送 ${value} 天` : "本次免费";
    return "优惠已应用";
  }

  private async ensureBillingCustomerForOrganization(input: {
    organization: BillingOrganizationInput;
    user: BillingUserInput;
  }) {
    const config = await this.resolveBillingConfig();
    const existing = await this.db.billingCustomer.findUnique({ where: { organizationId: input.organization.id } });
    const latestAccessRequest = await this.db.accessRequest.findFirst({
      where: {
        OR: [
          { targetOrganizationId: input.organization.id },
          { targetUserId: input.user.id },
          ...(normalizeEmail(input.user.email) ? [{ applicantEmail: normalizeEmail(input.user.email)! }] : [])
        ]
      },
      orderBy: { updatedAt: "desc" }
    });
    const businessEmail = normalizeEmail(existing?.businessEmail) ?? normalizeEmail(latestAccessRequest?.applicantEmail) ?? normalizeEmail(input.user.email);
    const companyName = trimOrUndefined(existing?.companyName) ?? trimOrUndefined(latestAccessRequest?.companyName) ?? trimOrUndefined(input.organization.name);
    const contactName = trimOrUndefined(existing?.contactName) ?? trimOrUndefined(latestAccessRequest?.contactName) ?? trimOrUndefined(input.user.displayName);
    const countryRegion = trimOrUndefined(existing?.countryRegion) ?? trimOrUndefined(latestAccessRequest?.countryRegion);
    const sn = trimOrUndefined(existing?.sn) ?? trimOrUndefined(latestAccessRequest?.snNumber);
    const salesContact = trimOrUndefined(existing?.salesContact) ?? trimOrUndefined(latestAccessRequest?.salesContactEmail);
    return this.db.billingCustomer.upsert({
      where: { organizationId: input.organization.id },
      update: {
        businessEmail: existing?.businessEmail ? undefined : businessEmail ?? null,
        companyName: existing?.companyName ? undefined : companyName ?? null,
        contactName: existing?.contactName ? undefined : contactName ?? null,
        countryRegion: existing?.countryRegion ? undefined : countryRegion ?? null,
        sn: existing?.sn ? undefined : sn ?? null,
        salesContact: existing?.salesContact ? undefined : salesContact ?? null,
        billingEmail: existing?.billingEmail ? undefined : businessEmail ?? null,
        defaultAutoRenew: existing?.defaultAutoRenew ?? config.defaultAutoRenew,
        metadataJson: existing?.metadataJson ?? {
          inferredFrom: latestAccessRequest ? "access_request" : "current_user"
        }
      },
      create: {
        organizationId: input.organization.id,
        businessEmail: businessEmail ?? null,
        companyName: companyName ?? null,
        contactName: contactName ?? null,
        countryRegion: countryRegion ?? null,
        sn: sn ?? null,
        salesContact: salesContact ?? null,
        billingEmail: businessEmail ?? null,
        defaultAutoRenew: config.defaultAutoRenew,
        metadataJson: {
          inferredFrom: latestAccessRequest ? "access_request" : "current_user"
        }
      }
    });
  }

  private async createStripeCheckoutSession(input: {
    order: Awaited<ReturnType<PrismaClient["billingOrder"]["create"]>>;
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> extends infer T ? NonNullable<T> : never;
    customer: Awaited<ReturnType<BillingService["ensureBillingCustomerForOrganization"]>>;
    organization: BillingOrganizationInput;
    user: BillingUserInput;
    mode: string;
  }): Promise<StripeCheckoutSession> {
    const config = await this.resolveBillingConfig();
    if (!config.stripeSecretKey) {
      throw new Error("Stripe is not configured");
    }
    const successUrl = this.resolveSuccessUrl(config);
    const cancelUrl = this.resolveCancelUrl(config);
    if (!successUrl || !cancelUrl) {
      throw new Error("Billing success/cancel URLs are not configured");
    }
    const common = {
      mode: input.mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: input.order.id,
      customer: input.customer.stripeCustomerId ?? undefined,
      customer_email: input.customer.stripeCustomerId ? undefined : normalizeEmail(input.customer.billingEmail) ?? normalizeEmail(input.customer.businessEmail) ?? normalizeEmail(input.user.email),
      "metadata[agent_studio_order_id]": input.order.id,
      "metadata[organization_id]": input.organization.id,
      "metadata[plan_id]": input.plan.id,
      "metadata[auto_renew]": input.order.autoRenew ? "true" : "false"
    };
    const form = input.mode === "payment"
      ? encodeStripeForm({
          ...common,
          "line_items[0][price_data][currency]": input.order.currency,
          "line_items[0][price_data][unit_amount]": input.order.amountTotalCents,
          "line_items[0][price_data][product_data][name]": input.plan.name,
          "line_items[0][quantity]": 1,
          "payment_intent_data[setup_future_usage]": input.order.autoRenew ? "off_session" : undefined,
          "payment_intent_data[metadata][agent_studio_order_id]": input.order.id,
          "payment_intent_data[metadata][organization_id]": input.organization.id
        })
      : encodeStripeForm({
          ...common,
          "payment_method_types[0]": "card",
          "setup_intent_data[metadata][agent_studio_order_id]": input.order.id,
          "setup_intent_data[metadata][organization_id]": input.organization.id
        });
    return this.stripeRequest<StripeCheckoutSession>("/checkout/sessions", form, config);
  }

  private async createStripeSubscription(input: {
    order: Awaited<ReturnType<PrismaClient["billingOrder"]["findUnique"]>> extends infer T ? NonNullable<T> : never;
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> extends infer T ? NonNullable<T> : never;
    customerId: string;
    trialEnd: Date;
  }): Promise<StripeSubscription> {
    const config = await this.resolveBillingConfig();
    if (!config.stripeSecretKey) {
      throw new Error("Stripe is not configured");
    }
    const trialEnd = Math.max(Math.floor(input.trialEnd.getTime() / 1000), Math.floor(Date.now() / 1000) + 60);
    const product = await this.ensureStripeProductForPlan(input.plan, config);
    const form = encodeStripeForm({
      customer: input.customerId,
      "items[0][price_data][currency]": input.order.currency,
      "items[0][price_data][unit_amount]": Math.max(1, input.order.amountSubtotalCents),
      "items[0][price_data][product]": product.id,
      "items[0][price_data][recurring][interval]": stripeInterval(input.plan.billingInterval),
      "items[0][price_data][recurring][interval_count]": Math.max(1, input.plan.billingIntervalCount || 1),
      trial_end: trialEnd,
      "metadata[agent_studio_order_id]": input.order.id,
      "metadata[organization_id]": input.order.organizationId,
      "metadata[plan_id]": input.plan.id
    });
    return this.stripeRequest<StripeSubscription>("/subscriptions", form, config);
  }

  private async ensureStripeProductForPlan(
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> extends infer T ? NonNullable<T> : never,
    config: BillingResolvedConfig
  ): Promise<StripeProduct> {
    const productId = stripeProductIdForPlan(plan.id);
    const existing = await this.stripeGet<StripeProduct>(`/products/${encodeURIComponent(productId)}`, config);
    if (existing) return existing;
    const form = encodeStripeForm({
      id: productId,
      name: plan.name,
      "metadata[agent_studio_plan_id]": plan.id,
      "metadata[agent_studio_plan_slug]": plan.slug
    });
    return this.stripeRequest<StripeProduct>("/products", form, config);
  }

  private async stripeGet<T>(path: string, config: BillingResolvedConfig): Promise<T | null> {
    const response = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${config.stripeSecretKey}`
      }
    });
    const payload = await response.json().catch(() => ({}));
    if (response.status === 404) return null;
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? "Stripe request failed")
        : "Stripe request failed";
      throw new Error(message);
    }
    return payload as T;
  }

  private async stripeRequest<T>(path: string, body: URLSearchParams, config: BillingResolvedConfig): Promise<T> {
    const response = await fetch(`${STRIPE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${config.stripeSecretKey}`,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: { message?: string } }).error?.message ?? "Stripe request failed")
        : "Stripe request failed";
      throw new Error(message);
    }
    return payload as T;
  }

  private async fulfillOrder(orderId: string, input: { source: string; stripeSession?: StripeCheckoutSession }):
    Promise<{ order: ReturnType<BillingService["mapOrder"]>; grant: ReturnType<BillingService["mapGrant"]> }> {
    const order = await this.db.billingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("billing order does not exist");
    const plan = order.planId ? await this.db.subscriptionPlan.findUnique({ where: { id: order.planId } }) : null;
    if (!plan) throw new Error("order plan does not exist");
    if (order.status === "paid" && order.entitlementExpiresAt) {
      const grant = await this.db.subscriptionGrant.findUnique({
        where: {
          principalType_principalId: {
            principalType: "organization",
            principalId: order.organizationId
          }
        },
        include: { plan: true }
      });
      if (!grant) throw new Error("paid order has no grant");
      return { order: this.mapOrder(order, plan), grant: this.mapGrant(grant, grant.plan ?? plan) };
    }
    const now = new Date();
    const existingGrant = await this.db.subscriptionGrant.findUnique({
      where: {
        principalType_principalId: {
          principalType: "organization",
          principalId: order.organizationId
        }
      }
    });
    const existingExpiresAt = toDate(existingGrant?.expiresAt);
    const entitlementStartsAt = existingExpiresAt && existingExpiresAt > now ? existingExpiresAt : now;
    const extensionDays = Math.max(0, order.durationDays) + Math.max(0, order.giftDays);
    const entitlementExpiresAt = addDays(entitlementStartsAt, extensionDays);
    const grant = await this.db.subscriptionGrant.upsert({
      where: {
        principalType_principalId: {
          principalType: "organization",
          principalId: order.organizationId
        }
      },
      update: {
        planId: plan.id,
        status: "active",
        startsAt: existingGrant?.startsAt ?? now,
        expiresAt: entitlementExpiresAt,
        cycleAnchorAt: existingGrant?.cycleAnchorAt ?? now,
        note: `Billing ${input.source}: ${order.orderNumber}`,
        createdByUserId: order.createdByUserId ?? undefined
      },
      create: {
        principalType: "organization",
        principalId: order.organizationId,
        planId: plan.id,
        status: "active",
        startsAt: now,
        expiresAt: entitlementExpiresAt,
        cycleAnchorAt: now,
        note: `Billing ${input.source}: ${order.orderNumber}`,
        createdByUserId: order.createdByUserId ?? null
      },
      include: { plan: true }
    });
    const updatedOrder = await this.db.billingOrder.update({
      where: { id: order.id },
      data: {
        status: "paid",
        paidAt: now,
        stripePaymentIntentId: input.stripeSession?.payment_intent ?? order.stripePaymentIntentId,
        stripeSubscriptionId: input.stripeSession?.subscription ?? order.stripeSubscriptionId,
        entitlementStartsAt,
        entitlementExpiresAt
      }
    });
    if (order.promotionCodeId) {
      await this.db.promotionRedemption.upsert({
        where: {
          promotionCodeId_orderId: {
            promotionCodeId: order.promotionCodeId,
            orderId: order.id
          }
        },
        update: {
          discountCents: order.discountCents,
          giftDays: order.giftDays,
          status: "redeemed"
        },
        create: {
          promotionCodeId: order.promotionCodeId,
          orderId: order.id,
          organizationId: order.organizationId,
          userId: order.createdByUserId,
          code: await this.promotionCodeForId(order.promotionCodeId),
          discountCents: order.discountCents,
          giftDays: order.giftDays,
          status: "redeemed"
        }
      });
    }
    return { order: this.mapOrder(updatedOrder, plan), grant: this.mapGrant(grant, grant.plan ?? plan) };
  }

  private async processStripeEvent(event: StripeEvent) {
    const object = event.data?.object;
    if (event.type === "checkout.session.completed" && isStripeCheckoutSession(object)) {
      await this.handleCheckoutCompleted(object);
      return;
    }
    if (event.type === "invoice.paid" && isStripeInvoice(object)) {
      await this.handleInvoicePaid(object);
      return;
    }
    if (event.type === "invoice.payment_failed" && isStripeInvoice(object)) {
      await this.handleInvoicePaymentFailed(object);
      return;
    }
    if ((event.type === "customer.subscription.updated" || event.type === "customer.subscription.deleted") && isStripeSubscription(object)) {
      await this.handleSubscriptionChanged(object, event.type);
    }
  }

  private async handleCheckoutCompleted(session: StripeCheckoutSession) {
    const orderId = trimOrUndefined(session.metadata?.agent_studio_order_id) ?? trimOrUndefined(session.client_reference_id);
    if (!orderId) throw new Error("Stripe checkout session missing Agent Studio order id");
    const order = await this.db.billingOrder.findUnique({ where: { id: orderId } });
    if (!order) throw new Error("Billing order for checkout session does not exist");
    await this.db.billingOrder.update({
      where: { id: order.id },
      data: {
        stripeCheckoutSessionId: session.id,
        stripePaymentIntentId: session.payment_intent ?? undefined,
        stripeSubscriptionId: session.subscription ?? undefined
      }
    });
    if (session.customer && order.billingCustomerId) {
      await this.db.billingCustomer.update({
        where: { id: order.billingCustomerId },
        data: { stripeCustomerId: session.customer }
      });
    }
    const fulfilled = await this.fulfillOrder(order.id, { source: "stripe_checkout", stripeSession: session });
    if (order.autoRenew && session.customer) {
      const plan = order.planId ? await this.db.subscriptionPlan.findUnique({ where: { id: order.planId } }) : null;
      if (!plan) throw new Error("Auto renewal plan does not exist");
      const existing = await this.db.billingAutoRenewal.findUnique({ where: { organizationId: order.organizationId } });
      if (!existing?.stripeSubscriptionId) {
        const subscription = await this.createStripeSubscription({
          order: await this.db.billingOrder.findUniqueOrThrow({ where: { id: order.id } }),
          plan,
          customerId: session.customer,
          trialEnd: new Date(fulfilled.order.entitlementExpiresAt ?? new Date())
        });
        await this.db.billingOrder.update({
          where: { id: order.id },
          data: { stripeSubscriptionId: subscription.id }
        });
        await this.db.billingAutoRenewal.upsert({
          where: { organizationId: order.organizationId },
          update: {
            billingCustomerId: order.billingCustomerId,
            planId: plan.id,
            status: "enabled",
            stripeCustomerId: session.customer,
            stripeSubscriptionId: subscription.id,
            paymentMethodStatus: "ready",
            currentPeriodStartsAt: toDate(subscription.current_period_start),
            currentPeriodEndsAt: toDate(subscription.current_period_end),
            nextRenewalAt: toDate(subscription.current_period_end),
            cancelAtPeriodEnd: false
          },
          create: {
            organizationId: order.organizationId,
            billingCustomerId: order.billingCustomerId,
            planId: plan.id,
            status: "enabled",
            stripeCustomerId: session.customer,
            stripeSubscriptionId: subscription.id,
            paymentMethodStatus: "ready",
            currentPeriodStartsAt: toDate(subscription.current_period_start),
            currentPeriodEndsAt: toDate(subscription.current_period_end),
            nextRenewalAt: toDate(subscription.current_period_end),
            cancelAtPeriodEnd: false,
            createdByUserId: order.createdByUserId
          }
        });
      }
    }
  }

  private async handleInvoicePaid(invoice: StripeInvoice) {
    const subscriptionId = trimOrUndefined(invoice.subscription);
    if (!subscriptionId) return;
    if (invoice.billing_reason === "subscription_create" && Math.max(0, invoice.amount_paid ?? 0) === 0) return;
    const autoRenewal = await this.db.billingAutoRenewal.findUnique({ where: { stripeSubscriptionId: subscriptionId } });
    if (!autoRenewal?.planId) return;
    const plan = await this.db.subscriptionPlan.findUnique({ where: { id: autoRenewal.planId } });
    if (!plan) return;
    const period = invoice.lines?.data?.[0]?.period;
    const startsAt = toDate(period?.start) ?? new Date();
    const endsAt = toDate(period?.end) ?? addDays(startsAt, durationDaysForPlan(plan));
    const existingInvoiceOrder = invoice.id
      ? await this.db.billingOrder.findFirst({ where: { stripeInvoiceId: invoice.id } })
      : null;
    if (!existingInvoiceOrder) {
      await this.db.billingOrder.create({
        data: {
          orderNumber: randomOrderNumber(),
          organizationId: autoRenewal.organizationId,
          billingCustomerId: autoRenewal.billingCustomerId,
          planId: plan.id,
          status: "paid",
          source: "stripe_invoice",
          checkoutMode: "auto_renewal",
          currency: invoice.currency ?? plan.billingCurrency,
          amountSubtotalCents: Math.max(0, invoice.amount_paid ?? plan.billingPriceCents ?? 0),
          discountCents: 0,
          amountTotalCents: Math.max(0, invoice.amount_paid ?? plan.billingPriceCents ?? 0),
          durationDays: Math.max(1, Math.ceil((endsAt.getTime() - startsAt.getTime()) / 86_400_000)),
          giftDays: 0,
          autoRenew: true,
          stripeInvoiceId: invoice.id,
          stripeSubscriptionId: subscriptionId,
          entitlementStartsAt: startsAt,
          entitlementExpiresAt: endsAt,
          paidAt: new Date()
        }
      });
      await this.extendGrantTo(autoRenewal.organizationId, plan.id, endsAt, `Billing auto renewal invoice: ${invoice.id}`);
    }
    await this.db.billingAutoRenewal.update({
      where: { id: autoRenewal.id },
      data: {
        status: "enabled",
        paymentMethodStatus: "ready",
        currentPeriodStartsAt: startsAt,
        currentPeriodEndsAt: endsAt,
        nextRenewalAt: endsAt,
        lastPaymentFailedAt: null
      }
    });
  }

  private async handleInvoicePaymentFailed(invoice: StripeInvoice) {
    const subscriptionId = trimOrUndefined(invoice.subscription);
    if (!subscriptionId) return;
    await this.db.billingAutoRenewal.updateMany({
      where: { stripeSubscriptionId: subscriptionId },
      data: {
        status: "payment_failed",
        paymentMethodStatus: "failed",
        lastPaymentFailedAt: new Date()
      }
    });
  }

  private async handleSubscriptionChanged(subscription: StripeSubscription, eventType: string) {
    const status = eventType === "customer.subscription.deleted"
      ? "canceled"
      : subscription.status === "active" || subscription.status === "trialing"
        ? "enabled"
        : subscription.status ?? "incomplete";
    await this.db.billingAutoRenewal.updateMany({
      where: { stripeSubscriptionId: subscription.id },
      data: {
        status,
        stripeCustomerId: subscription.customer ?? undefined,
        currentPeriodStartsAt: toDate(subscription.current_period_start),
        currentPeriodEndsAt: toDate(subscription.current_period_end),
        nextRenewalAt: toDate(subscription.current_period_end)
      }
    });
  }

  private async extendGrantTo(organizationId: string, planId: string, expiresAt: Date, note: string) {
    const now = new Date();
    const existingGrant = await this.db.subscriptionGrant.findUnique({
      where: {
        principalType_principalId: {
          principalType: "organization",
          principalId: organizationId
        }
      }
    });
    const currentExpiresAt = toDate(existingGrant?.expiresAt);
    const nextExpiresAt = currentExpiresAt && currentExpiresAt > expiresAt ? currentExpiresAt : expiresAt;
    return this.db.subscriptionGrant.upsert({
      where: {
        principalType_principalId: {
          principalType: "organization",
          principalId: organizationId
        }
      },
      update: {
        planId,
        status: "active",
        expiresAt: nextExpiresAt,
        note
      },
      create: {
        principalType: "organization",
        principalId: organizationId,
        planId,
        status: "active",
        startsAt: now,
        expiresAt: nextExpiresAt,
        cycleAnchorAt: now,
        note
      }
    });
  }

  private async runReminderRule(rule: Awaited<ReturnType<PrismaClient["billingEmailRule"]["findMany"]>>[number], input: { now: Date; testEmail?: string | null }) {
    if (rule.triggerType === "auto_renew_failed") {
      return this.runAutoRenewFailedReminderRule(rule, input);
    }
    const config = await this.resolveBillingConfig();
    const windowStart = rule.triggerType === "expired"
      ? addDays(input.now, -1)
      : addDays(input.now, rule.offsetDays);
    const windowEnd = rule.triggerType === "expired"
      ? input.now
      : addDays(windowStart, 1);
    const grants = await this.db.subscriptionGrant.findMany({
      where: {
        principalType: "organization",
        status: "active",
        expiresAt: {
          gte: windowStart,
          lt: windowEnd
        }
      },
      include: { plan: true }
    });
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const grant of grants) {
      const targetRef = `billing-email:${rule.id}:${grant.principalId}:${dateKey(input.now)}`;
      const existing = await this.db.notificationRecord.findFirst({ where: { targetRef } });
      if (existing && !input.testEmail) {
        skipped += 1;
        continue;
      }
      try {
        const organization = await this.db.organization.findUnique({
          where: { id: grant.principalId },
          select: { id: true, name: true, slug: true, ownerUserId: true }
        });
        const customer = await this.db.billingCustomer.findUnique({ where: { organizationId: grant.principalId } });
        const recipients = input.testEmail
          ? [input.testEmail]
          : await this.resolveReminderRecipients(grant.principalId, customer, rule.audienceJson);
        if (!recipients.length) {
          skipped += 1;
          continue;
        }
        const expiresAtLocal = grant.expiresAt
          ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(grant.expiresAt)
          : "not set";
        const variables = {
          company_name: organization?.name ?? customer?.companyName ?? "your organization",
          plan_name: grant.plan?.name ?? "Agent Studio",
          expires_at_local: `${expiresAtLocal} UTC`,
          renew_url: this.resolveSuccessUrl(config),
          amount_due: grant.plan?.billingPriceCents ? centsLabel(grant.plan.billingPriceCents, grant.plan.billingCurrency) : ""
        };
        const notification = await this.db.notificationRecord.create({
          data: {
            organizationId: grant.principalId,
            channelType: "email",
            targetRef: input.testEmail ? `${targetRef}:test:${Date.now()}` : targetRef,
            eventType: rule.triggerType === "expired" ? BILLING_EVENT_TYPES.expired : BILLING_EVENT_TYPES.expiring,
            status: "pending",
            payload: {
              ruleId: rule.id,
              recipients,
              expiresAt: toIsoString(grant.expiresAt)
            }
          }
        });
        if (!this.options.emailSender) throw new Error("email sender is not configured");
        const delivery = await this.options.emailSender.send({
          to: recipients,
          subject: renderTemplate(rule.subject, variables),
          text: renderTemplate(rule.bodyText, variables),
          html: rule.bodyHtml ? renderTemplate(rule.bodyHtml, variables) : undefined,
          debugLabel: "billing-email-reminder"
        });
        await this.db.notificationRecord.update({
          where: { id: notification.id },
          data: {
            status: "sent",
            payload: {
              ruleId: rule.id,
              recipients,
              delivery
            }
          }
        });
        sent += 1;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        await this.db.notificationRecord.updateMany({
          where: { targetRef },
          data: {
            status: "failed",
            errorMessage
          }
        });
        failed += 1;
      }
    }
    await this.db.billingEmailRule.update({ where: { id: rule.id }, data: { lastRunAt: input.now } });
    return { ruleId: rule.id, sent, skipped, failed };
  }

  private async runAutoRenewFailedReminderRule(
    rule: Awaited<ReturnType<PrismaClient["billingEmailRule"]["findMany"]>>[number],
    input: { now: Date; testEmail?: string | null }
  ) {
    const config = await this.resolveBillingConfig();
    const failedSince = addDays(input.now, -1);
    const renewals = await this.db.billingAutoRenewal.findMany({
      where: {
        status: "payment_failed",
        lastPaymentFailedAt: {
          gte: failedSince,
          lt: addDays(input.now, 1)
        }
      }
    });
    let sent = 0;
    let skipped = 0;
    let failed = 0;
    for (const renewal of renewals) {
      const targetRef = `billing-email:${rule.id}:${renewal.organizationId}:${dateKey(input.now)}`;
      const existing = await this.db.notificationRecord.findFirst({ where: { targetRef } });
      if (existing && !input.testEmail) {
        skipped += 1;
        continue;
      }
      try {
        const [organization, customer, plan] = await Promise.all([
          this.db.organization.findUnique({ where: { id: renewal.organizationId }, select: { id: true, name: true, slug: true } }),
          this.db.billingCustomer.findUnique({ where: { organizationId: renewal.organizationId } }),
          renewal.planId ? this.db.subscriptionPlan.findUnique({ where: { id: renewal.planId } }) : Promise.resolve(null)
        ]);
        const recipients = input.testEmail
          ? [input.testEmail]
          : await this.resolveReminderRecipients(renewal.organizationId, customer, rule.audienceJson);
        if (!recipients.length) {
          skipped += 1;
          continue;
        }
        const variables = {
          company_name: organization?.name ?? customer?.companyName ?? "your organization",
          plan_name: plan?.name ?? "Agent Studio",
          expires_at_local: renewal.nextRenewalAt ? `${new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(renewal.nextRenewalAt)} UTC` : "",
          renew_url: this.resolveSuccessUrl(config),
          amount_due: plan?.billingPriceCents ? centsLabel(plan.billingPriceCents, plan.billingCurrency) : ""
        };
        const notification = await this.db.notificationRecord.create({
          data: {
            organizationId: renewal.organizationId,
            channelType: "email",
            targetRef: input.testEmail ? `${targetRef}:test:${Date.now()}` : targetRef,
            eventType: BILLING_EVENT_TYPES.autoRenewFailed,
            status: "pending",
            payload: {
              ruleId: rule.id,
              recipients,
              lastPaymentFailedAt: toIsoString(renewal.lastPaymentFailedAt)
            }
          }
        });
        if (!this.options.emailSender) throw new Error("email sender is not configured");
        const delivery = await this.options.emailSender.send({
          to: recipients,
          subject: renderTemplate(rule.subject, variables),
          text: renderTemplate(rule.bodyText, variables),
          html: rule.bodyHtml ? renderTemplate(rule.bodyHtml, variables) : undefined,
          debugLabel: "billing-auto-renew-failed-email"
        });
        await this.db.notificationRecord.update({
          where: { id: notification.id },
          data: {
            status: "sent",
            payload: {
              ruleId: rule.id,
              recipients,
              delivery
            }
          }
        });
        sent += 1;
      } catch (error) {
        await this.db.notificationRecord.updateMany({
          where: { targetRef },
          data: {
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error)
          }
        });
        failed += 1;
      }
    }
    await this.db.billingEmailRule.update({ where: { id: rule.id }, data: { lastRunAt: input.now } });
    return { ruleId: rule.id, sent, skipped, failed };
  }

  private async resolveReminderRecipients(
    organizationId: string,
    customer: Awaited<ReturnType<PrismaClient["billingCustomer"]["findUnique"]>>,
    audienceJson: Prisma.JsonValue | null
  ): Promise<string[]> {
    const audience = jsonAudience(audienceJson);
    const recipients: string[] = [];
    if (audience.billingContacts) {
      [customer?.billingEmail, customer?.businessEmail].forEach((email) => {
        const normalized = normalizeEmail(email);
        if (normalized && !recipients.includes(normalized)) recipients.push(normalized);
      });
    }
    if (audience.salesContact) {
      const normalized = normalizeEmail(customer?.salesContact);
      if (normalized && !recipients.includes(normalized)) recipients.push(normalized);
    }
    if (audience.organizationAdmins) {
      const memberships = await this.db.organizationMembership.findMany({
        where: { organizationId, status: "active" },
        include: { user: true },
        take: 20
      });
      memberships.forEach((membership) => {
        const normalized = normalizeEmail(membership.user.email);
        if (normalized && !recipients.includes(normalized)) recipients.push(normalized);
      });
    }
    return recipients;
  }

  private resolveSuccessUrl(config: BillingResolvedConfig): string {
    return trimOrUndefined(config.successUrl) || "";
  }

  private resolveCancelUrl(config: BillingResolvedConfig): string {
    return trimOrUndefined(config.cancelUrl) || "";
  }

  private nextActionForAccount(input: {
    grant?: { status: string; expiresAt: Date | string | null } | null;
    autoRenewal?: { status: string } | null;
    latestOrder?: { status: string } | null;
    now: Date;
  }): string {
    const expiresAt = toDate(input.grant?.expiresAt);
    if (!input.grant) return "create_payment_link";
    if (input.autoRenewal?.status === "payment_failed") return "update_payment_method";
    if (expiresAt && expiresAt <= input.now) return "expired_renew_now";
    if (expiresAt && expiresAt <= addDays(input.now, 14)) return "expiring_review_renewal";
    if (input.latestOrder?.status === "pending_payment") return "waiting_for_payment";
    return "monitor";
  }

  private async promotionCodeForId(id: string): Promise<string> {
    const promotion = await this.db.promotionCode.findUnique({ where: { id } });
    return promotion?.code ?? id;
  }

  private mapBillingCustomer(customer: Awaited<ReturnType<PrismaClient["billingCustomer"]["findMany"]>>[number]) {
    return {
      id: customer.id,
      organizationId: customer.organizationId,
      businessEmail: customer.businessEmail,
      companyName: customer.companyName,
      contactName: customer.contactName,
      countryRegion: customer.countryRegion,
      sn: customer.sn,
      salesContact: customer.salesContact,
      billingEmail: customer.billingEmail,
      stripeCustomerId: customer.stripeCustomerId,
      defaultAutoRenew: customer.defaultAutoRenew,
      createdAt: toIsoString(customer.createdAt),
      updatedAt: toIsoString(customer.updatedAt)
    };
  }

  private mapPlan(plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findMany"]>>[number]) {
    return {
      id: plan.id,
      slug: plan.slug,
      name: plan.name,
      description: plan.description,
      status: plan.status,
      featureType: plan.featureType,
      monthlyCompletedTurnLimit: plan.monthlyCompletedTurnLimit,
      monthlyTokenLimit: plan.monthlyTokenLimit,
      billingCurrency: plan.billingCurrency,
      billingInterval: plan.billingInterval,
      billingIntervalCount: plan.billingIntervalCount,
      billingPriceCents: plan.billingPriceCents,
      billingStatus: plan.billingStatus,
      durationDays: durationDaysForPlan(plan),
      createdAt: toIsoString(plan.createdAt),
      updatedAt: toIsoString(plan.updatedAt)
    };
  }

  private mapGrant(
    grant: {
      id: string;
      principalType: string;
      principalId: string;
      planId: string | null;
      status: string;
      startsAt: Date | string;
      expiresAt: Date | string | null;
      cycleAnchorAt: Date | string;
      note: string | null;
      plan?: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> | null;
    },
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> | null
  ) {
    return {
      id: grant.id,
      principalType: grant.principalType,
      principalId: grant.principalId,
      planId: grant.planId,
      planName: plan?.name ?? grant.plan?.name ?? null,
      status: grant.status,
      startsAt: toIsoString(grant.startsAt),
      expiresAt: toIsoString(grant.expiresAt),
      cycleAnchorAt: toIsoString(grant.cycleAnchorAt),
      note: grant.note
    };
  }

  private mapOrder(
    order: Awaited<ReturnType<PrismaClient["billingOrder"]["findMany"]>>[number],
    plan: Awaited<ReturnType<PrismaClient["subscriptionPlan"]["findUnique"]>> | null
  ) {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      organizationId: order.organizationId,
      billingCustomerId: order.billingCustomerId,
      planId: order.planId,
      planName: plan?.name ?? null,
      status: order.status,
      source: order.source,
      checkoutMode: order.checkoutMode,
      currency: order.currency,
      amountSubtotalCents: order.amountSubtotalCents,
      discountCents: order.discountCents,
      amountTotalCents: order.amountTotalCents,
      durationDays: order.durationDays,
      giftDays: order.giftDays,
      autoRenew: order.autoRenew,
      promotionCodeId: order.promotionCodeId,
      stripeCheckoutSessionId: order.stripeCheckoutSessionId,
      stripeInvoiceId: order.stripeInvoiceId,
      stripeSubscriptionId: order.stripeSubscriptionId,
      entitlementStartsAt: toIsoString(order.entitlementStartsAt),
      entitlementExpiresAt: toIsoString(order.entitlementExpiresAt),
      paidAt: toIsoString(order.paidAt),
      createdAt: toIsoString(order.createdAt),
      updatedAt: toIsoString(order.updatedAt)
    };
  }

  private mapAutoRenewal(item: Awaited<ReturnType<PrismaClient["billingAutoRenewal"]["findMany"]>>[number]) {
    return {
      id: item.id,
      organizationId: item.organizationId,
      billingCustomerId: item.billingCustomerId,
      planId: item.planId,
      status: item.status,
      stripeCustomerId: item.stripeCustomerId,
      stripeSubscriptionId: item.stripeSubscriptionId,
      paymentMethodStatus: item.paymentMethodStatus,
      currentPeriodStartsAt: toIsoString(item.currentPeriodStartsAt),
      currentPeriodEndsAt: toIsoString(item.currentPeriodEndsAt),
      nextRenewalAt: toIsoString(item.nextRenewalAt),
      lastPaymentFailedAt: toIsoString(item.lastPaymentFailedAt),
      cancelAtPeriodEnd: item.cancelAtPeriodEnd,
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt)
    };
  }

  private mapPromotionCode(item: Awaited<ReturnType<PrismaClient["promotionCode"]["findMany"]>>[number]) {
    return {
      id: item.id,
      code: item.code,
      name: item.name,
      description: item.description,
      type: item.type,
      value: item.value,
      currency: item.currency,
      status: item.status,
      maxRedemptions: item.maxRedemptions,
      perCustomerLimit: item.perCustomerLimit,
      startsAt: toIsoString(item.startsAt),
      expiresAt: toIsoString(item.expiresAt),
      eligiblePlanIds: jsonStringArray(item.eligiblePlanIds),
      eligibleOrganizationIds: jsonStringArray(item.eligibleOrganizationIds),
      eligibleEmailDomains: jsonStringArray(item.eligibleEmailDomains),
      eligibleSnValues: jsonStringArray(item.eligibleSnValues),
      ownerUserId: item.ownerUserId,
      note: item.note,
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt)
    };
  }

  private mapEmailRule(item: Awaited<ReturnType<PrismaClient["billingEmailRule"]["findMany"]>>[number]) {
    return {
      id: item.id,
      triggerType: item.triggerType,
      offsetDays: item.offsetDays,
      status: item.status,
      audience: item.audienceJson,
      subject: item.subject,
      bodyText: item.bodyText,
      bodyHtml: item.bodyHtml,
      lastRunAt: toIsoString(item.lastRunAt),
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt)
    };
  }

  private mapStripeEvent(item: Awaited<ReturnType<PrismaClient["billingStripeEvent"]["findMany"]>>[number]) {
    return {
      id: item.id,
      stripeEventId: item.stripeEventId,
      eventType: item.eventType,
      status: item.status,
      livemode: item.livemode,
      errorMessage: item.errorMessage,
      processedAt: toIsoString(item.processedAt),
      createdAt: toIsoString(item.createdAt),
      updatedAt: toIsoString(item.updatedAt)
    };
  }
}

function planCurrency(plan: { billingCurrency: string | null | undefined }): string {
  return plan.billingCurrency || "usd";
}
