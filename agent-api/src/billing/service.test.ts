import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { BillingService } from "./service.js";

function createBillingConfig() {
  return {
    stripeSecretKey: "sk_test_env_1234",
    stripeWebhookSigningSecret: "whsec_env_1234",
    successUrl: "https://example.com/billing/success",
    cancelUrl: "https://example.com/billing/cancel",
    defaultCurrency: "usd",
    defaultAutoRenew: true
  };
}

function createDbMock() {
  const now = new Date("2026-06-12T00:00:00.000Z");
  let instance: Record<string, unknown> | null = null;
  let configRow: Record<string, unknown> | null = null;
  let secretRow: Record<string, unknown> | null = null;

  const db = {
    integrationInstance: {
      findUnique: vi.fn(async () => {
        if (!instance) return null;
        return {
          ...instance,
          config: configRow,
          secret: secretRow
        };
      }),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        instance = instance
          ? { ...instance, ...args.update, updatedAt: now }
          : { id: "stripe-instance", ...args.create, createdAt: now, updatedAt: now };
        return instance;
      })
    },
    integrationInstanceConfig: {
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        configRow = configRow
          ? { id: "stripe-config", ...configRow, ...args.update, updatedAt: now }
          : { id: "stripe-config", ...args.create, createdAt: now, updatedAt: now };
        return configRow;
      })
    },
    integrationInstanceSecret: {
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        secretRow = secretRow
          ? { id: "stripe-secret", ...secretRow, ...args.update, updatedAt: now }
          : { id: "stripe-secret", ...args.create, createdAt: now, updatedAt: now };
        return secretRow;
      })
    },
    subscriptionPlan: {
      findMany: vi.fn(async () => [])
    }
  };

  return { db: db as unknown as PrismaClient, raw: db };
}

describe("BillingService Stripe admin settings", () => {
  it("uses environment billing config until admin settings are saved", async () => {
    const { db } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });

    const status = await service.stripeConfigStatus();

    expect(status).toMatchObject({
      source: "environment",
      mode: "test",
      secretKeyConfigured: true,
      webhookSigningSecretConfigured: true,
      successUrlConfigured: true,
      cancelUrlConfigured: true,
      defaultCurrency: "usd",
      defaultAutoRenew: true,
      webhookEndpointPath: "/api/integrations/stripe/webhook"
    });
    expect(status.secretKeyPreview).toContain("...");
    expect(JSON.stringify(status)).not.toContain("sk_test_env_1234");
  });

  it("saves Stripe settings in admin config and never returns raw secrets", async () => {
    const { db } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });

    await expect(
      service.updateStripeSettings({
        mode: "live",
        stripeSecretKey: "sk_test_mismatch_1234"
      })
    ).rejects.toThrow(/mode/i);

    const status = await service.updateStripeSettings({
      mode: "live",
      stripeSecretKey: "sk_live_admin_5678",
      webhookSigningSecret: "whsec_admin_5678",
      successUrl: "https://billing.example.com/success",
      cancelUrl: "https://billing.example.com/cancel",
      defaultCurrency: "eur",
      defaultAutoRenew: false,
      userId: "admin-user"
    });

    expect(status).toMatchObject({
      source: "admin",
      mode: "live",
      secretKeyConfigured: true,
      webhookSigningSecretConfigured: true,
      successUrl: "https://billing.example.com/success",
      cancelUrl: "https://billing.example.com/cancel",
      defaultCurrency: "eur",
      defaultAutoRenew: false
    });
    expect(JSON.stringify(status)).not.toContain("sk_live_admin_5678");
    expect(JSON.stringify(status)).not.toContain("whsec_admin_5678");
  });

  it("only lists active priced plans as billable", async () => {
    const { db, raw } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });

    await service.listBillablePlans();

    expect(raw.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: {
        status: "active",
        billingStatus: "active",
        billingPriceCents: { not: null }
      },
      orderBy: [{ billingStatus: "asc" }, { billingPriceCents: "asc" }, { name: "asc" }]
    });
  });

  it("creates auto-renewal subscriptions with a reusable Stripe product id", async () => {
    const { db } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { message: "No such product" } }), { status: 404 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "as_plan_plan_123", name: "Test Plan" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "sub_test_123", customer: "cus_test_123" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      await (service as unknown as {
        createStripeSubscription(input: {
          order: Record<string, unknown>;
          plan: Record<string, unknown>;
          customerId: string;
          trialEnd: Date;
        }): Promise<unknown>;
      }).createStripeSubscription({
        order: {
          id: "order_123",
          organizationId: "org_123",
          currency: "usd",
          amountSubtotalCents: 100
        },
        plan: {
          id: "plan.123",
          slug: "test",
          name: "Test Plan",
          billingInterval: "month",
          billingIntervalCount: 1
        },
        customerId: "cus_test_123",
        trialEnd: new Date("2026-07-12T00:00:00.000Z")
      });
    } finally {
      vi.unstubAllGlobals();
    }

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.stripe.com/v1/products/as_plan_plan_123",
      expect.objectContaining({ method: "GET" })
    );
    const productBody = fetchMock.mock.calls[1]?.[1]?.body as URLSearchParams;
    expect(productBody.get("id")).toBe("as_plan_plan_123");
    expect(productBody.get("name")).toBe("Test Plan");
    expect(productBody.get("metadata[agent_studio_plan_id]")).toBe("plan.123");

    const subscriptionBody = fetchMock.mock.calls[2]?.[1]?.body as URLSearchParams;
    expect(subscriptionBody.get("items[0][price_data][product]")).toBe("as_plan_plan_123");
    expect(subscriptionBody.has("items[0][price_data][product_data][name]")).toBe(false);
  });
});
