import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import type { AuthEmailSender } from "../auth/email.js";
import { BillingService } from "./service.js";

function createBillingConfig() {
  return {
    stripeSecretKey: "sk_test_env_1234",
    stripeWebhookSigningSecret: "whsec_env_1234",
    successUrl: "https://example.com/billing/success",
    cancelUrl: "https://example.com/billing/cancel",
    defaultCurrency: "usd",
    defaultAutoRenew: true,
    billingEmailEnabled: false
  };
}

function withoutUndefined(input: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined));
}

function createDbMock(initialBillingCustomer: Record<string, unknown> | null = null) {
  const now = new Date("2026-06-12T00:00:00.000Z");
  let instance: Record<string, unknown> | null = null;
  let configRow: Record<string, unknown> | null = null;
  let secretRow: Record<string, unknown> | null = null;
  let billingCustomer: Record<string, unknown> | null = initialBillingCustomer
    ? {
        createdAt: now,
        updatedAt: now,
        defaultAutoRenew: true,
        metadataJson: null,
        ...initialBillingCustomer
      }
    : null;

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
      findMany: vi.fn(async (): Promise<unknown[]> => [])
    },
    subscriptionGrant: {
      findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []),
      findUnique: vi.fn(async (_args?: unknown): Promise<unknown | null> => null),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => ({
        id: "grant-1",
        ...args.create,
        ...args.update,
        createdAt: now,
        updatedAt: now
      }))
    },
    organization: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findUnique: vi.fn(async (_args?: unknown): Promise<unknown> => ({ id: "org-1", name: "Customer Inc", slug: "customer", ownerUserId: null }))
    },
    organizationMembership: {
      findMany: vi.fn(async (): Promise<unknown[]> => [])
    },
    accessRequest: {
      findFirst: vi.fn(async () => null)
    },
    billingCustomer: {
      findMany: vi.fn(async (): Promise<unknown[]> => (billingCustomer ? [billingCustomer] : [])),
      findUnique: vi.fn(async (args: { where: { organizationId?: string; stripeCustomerId?: string; id?: string } }) => {
        if (!billingCustomer) return null;
        if (args.where.organizationId) return billingCustomer.organizationId === args.where.organizationId ? billingCustomer : null;
        if (args.where.stripeCustomerId) return billingCustomer.stripeCustomerId === args.where.stripeCustomerId ? billingCustomer : null;
        if (args.where.id) return billingCustomer.id === args.where.id ? billingCustomer : null;
        return null;
      }),
      upsert: vi.fn(async (args: { create: Record<string, unknown>; update: Record<string, unknown> }) => {
        billingCustomer = billingCustomer
          ? {
              ...billingCustomer,
              ...withoutUndefined(args.update),
              updatedAt: now
            }
          : {
              id: "billing-customer-1",
              ...args.create,
              createdAt: now,
              updatedAt: now
            };
        return billingCustomer;
      }),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => {
        billingCustomer = {
          id: args.where.id,
          organizationId: "org-1",
          businessEmail: "customer@example.com",
          billingEmail: "customer@example.com",
          companyName: null,
          contactName: null,
          countryRegion: null,
          sn: null,
          salesContact: null,
          defaultAutoRenew: true,
          metadataJson: null,
          createdAt: now,
          ...billingCustomer,
          ...withoutUndefined(args.data),
          updatedAt: now
        };
        return billingCustomer;
      })
    },
    billingOrder: {
      findMany: vi.fn(async (): Promise<unknown[]> => [])
    },
    billingEmailRule: {
      findMany: vi.fn(async (_args?: unknown): Promise<unknown[]> => []),
      findUnique: vi.fn(async (_args?: unknown): Promise<unknown | null> => null),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        triggerType: "expires_in_days",
        offsetDays: 14,
        status: "enabled",
        audienceJson: null,
        subject: "",
        bodyText: "",
        bodyHtml: null,
        createdAt: now,
        updatedAt: now,
        ...args.data
      }))
    },
    billingAutoRenewal: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findUnique: vi.fn(async (_args?: unknown): Promise<unknown | null> => null)
    },
    promotionCode: {
      findMany: vi.fn(async (): Promise<unknown[]> => [])
    },
    billingStripeEvent: {
      findMany: vi.fn(async (): Promise<unknown[]> => [])
    },
    notificationRecord: {
      findMany: vi.fn(async (): Promise<unknown[]> => []),
      findFirst: vi.fn(async () => null),
      create: vi.fn(async (args: { data: Record<string, unknown> }) => ({
        id: `notification-${Math.random().toString(16).slice(2)}`,
        createdAt: now,
        updatedAt: now,
        ...args.data
      })),
      update: vi.fn(async (args: { where: { id: string }; data: Record<string, unknown> }) => ({
        id: args.where.id,
        ...args.data,
        createdAt: now,
        updatedAt: now
      })),
      updateMany: vi.fn(async () => ({ count: 0 }))
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

  it("keeps billing emails globally disabled until admin enables them", async () => {
    const { db, raw } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });

    await expect(service.emailSettingsStatus()).resolves.toMatchObject({
      enabled: false,
      source: "environment"
    });

    const disabledSweep = await service.runReminderSweep();
    expect(disabledSweep).toMatchObject({ ok: true, disabled: true, results: [] });
    expect(raw.billingEmailRule.findMany).not.toHaveBeenCalled();

    await expect(service.updateEmailSettings({ enabled: true })).resolves.toMatchObject({
      enabled: true,
      source: "admin"
    });
  });

  it("aligns expiring account status with the 14-day email sweep window", async () => {
    const { db, raw } = createDbMock({
      id: "billing-customer-1",
      organizationId: "org-1",
      businessEmail: "customer@example.com",
      billingEmail: "customer@example.com"
    });
    raw.organization.findMany.mockResolvedValueOnce([
      {
        id: "org-1",
        slug: "customer",
        name: "Customer Inc",
        type: "customer",
        status: "active",
        ownerUserId: null,
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z")
      }
    ]);
    raw.subscriptionPlan.findMany.mockResolvedValueOnce([
      {
        id: "plan-plus",
        slug: "plus",
        name: "Plus",
        description: null,
        status: "active",
        featureType: "codex",
        monthlyCompletedTurnLimit: 300,
        monthlyTokenLimit: null,
        billingCurrency: "usd",
        billingInterval: "year",
        billingIntervalCount: 1,
        billingPriceCents: 99900,
        billingStatus: "active",
        createdAt: new Date("2026-05-01T00:00:00.000Z"),
        updatedAt: new Date("2026-05-01T00:00:00.000Z")
      }
    ]);
    raw.subscriptionGrant.findMany.mockResolvedValueOnce([
      {
        id: "grant-1",
        principalType: "organization",
        principalId: "org-1",
        planId: "plan-plus",
        status: "active",
        startsAt: new Date("2026-05-09T06:02:00.000Z"),
        expiresAt: new Date("2026-07-09T06:02:00.000Z"),
        cycleAnchorAt: new Date("2026-05-09T06:02:00.000Z"),
        note: null,
        createdAt: new Date("2026-05-09T06:02:00.000Z"),
        updatedAt: new Date("2026-05-09T06:02:00.000Z")
      }
    ]);
    raw.billingEmailRule.findMany.mockResolvedValueOnce([
      {
        id: "billing-email-rule-expiring-14",
        triggerType: "expires_in_days",
        offsetDays: 14,
        status: "enabled",
        audienceJson: { billingContacts: true },
        subject: "Trial ends soon",
        bodyText: "Renew",
        bodyHtml: null,
        lastRunAt: null,
        createdAt: new Date("2026-06-12T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z")
      }
    ]);
    raw.notificationRecord.findMany.mockResolvedValueOnce([
      {
        id: "notification-1",
        organizationId: "org-1",
        channelType: "email",
        targetRef: "billing-email:billing-email-rule-expiring-14:org-1:2026-06-24",
        eventType: "billing.subscription.expiring_email",
        status: "sent",
        payload: {
          ruleId: "billing-email-rule-expiring-14",
          recipients: ["customer@example.com"],
          delivery: { mode: "smtp", delivered: true }
        },
        errorMessage: null,
        createdAt: new Date("2026-06-24T06:47:00.000Z"),
        updatedAt: new Date("2026-06-24T06:47:00.000Z")
      }
    ]);
    const service = new BillingService({ db, config: createBillingConfig() });
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T06:47:00.000Z"));
    try {
      const overview = await service.getAdminOverview();
      expect(overview.summary.expiringReminderWindow).toBe(1);
      expect(overview.customers[0]?.accountStatus).toMatchObject({
        state: "expiring",
        recommendedAction: "follow_up_sales",
        daysUntilExpiry: 15,
        lastEmail: {
          status: "sent",
          subject: "Trial ends soon"
        }
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends a branded billing email test without enabling production reminders", async () => {
    const { db, raw } = createDbMock();
    raw.billingEmailRule.findUnique.mockResolvedValueOnce({
      id: "billing-email-rule-expiring-14",
      triggerType: "expires_in_days",
      offsetDays: 14,
      status: "disabled",
      audienceJson: { billingContacts: true },
      subject: "{{brand_name}} subscription expires in 14 days",
      bodyText: "{{email_heading}}: {{plan_name}} for {{company_name}} ends on {{access_end_date}}. {{renewal_summary}} Open billing: {{renew_url}}",
      bodyHtml: '<table><tr><td>{{brand_name}}</td><td>{{plan_name}}</td><td>{{amount_due}}</td><td><a href="{{renew_url}}">Renew</a></td></tr></table>',
      lastRunAt: null,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    });
    const send = vi.fn(async (_input: Parameters<AuthEmailSender["send"]>[0]) => ({ delivered: true, mode: "smtp" as const }));
    const emailSender: AuthEmailSender = { send };
    const service = new BillingService({
      db,
      config: createBillingConfig(),
      emailSender,
      resolveBrandName: async () => "Bailey"
    });

    await expect(service.sendReminderTestEmail({
      ruleId: "billing-email-rule-expiring-14",
      testEmail: "like@baicells.com",
      now: new Date("2026-06-12T00:00:00.000Z")
    })).resolves.toMatchObject({ ok: true, delivered: true, mode: "smtp" });

    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      to: ["like@baicells.com"],
      subject: "Bailey subscription expires in 14 days",
      text: expect.stringContaining("Access ends in 14 days: Standard Edition for Example Customer ends on Jun 26, 2026."),
      debugLabel: "billing-email-reminder-test"
    }));
    expect(send.mock.calls[0]?.[0]?.text).toContain("Auto-renew is on and the plan is scheduled to renew for $999.00 on Jun 26, 2026.");
    const html = send.mock.calls[0]?.[0]?.html ?? "";
    expect(html).toContain("Bailey");
    expect(html).toContain("Standard Edition");
    expect(html).toContain("$999.00");
    expect(html).toContain("https://bailey.baicells.com/?billing=renew");
    expect(raw.billingEmailRule.findMany).not.toHaveBeenCalled();
  });

  it("renders the automatic-renewal failure test with the dynamic plan and amount", async () => {
    const { db, raw } = createDbMock();
    raw.billingEmailRule.findUnique.mockResolvedValueOnce({
      id: "billing-email-rule-auto-renew-failed-0",
      triggerType: "auto_renew_failed",
      offsetDays: 0,
      status: "disabled",
      audienceJson: { billingContacts: true },
      subject: "{{brand_name}} automatic renewal payment needs attention",
      bodyText: "{{email_heading}}. {{plan_name}}. {{renewal_summary}} Review billing: {{renew_url}}",
      bodyHtml: "<p>{{email_heading}}</p><p>{{plan_name}}</p><p>{{renewal_summary}}</p><a href=\"{{renew_url}}\">Review billing</a>",
      lastRunAt: null,
      createdAt: new Date("2026-06-12T00:00:00.000Z"),
      updatedAt: new Date("2026-06-12T00:00:00.000Z")
    });
    const send = vi.fn(async (_input: Parameters<AuthEmailSender["send"]>[0]) => ({ delivered: true, mode: "smtp" as const }));
    const service = new BillingService({
      db,
      config: createBillingConfig(),
      emailSender: { send },
      resolveBrandName: async () => "Bailey"
    });

    await service.sendReminderTestEmail({
      ruleId: "billing-email-rule-auto-renew-failed-0",
      testEmail: "billing@example.com",
      now: new Date("2026-06-12T00:00:00.000Z")
    });

    const message = send.mock.calls[0]?.[0];
    expect(message?.subject).toBe("Bailey automatic renewal payment needs attention");
    expect(message?.text).toContain("Automatic renewal needs attention. Standard Edition.");
    expect(message?.text).toContain("We could not process the $999.00 renewal payment.");
    expect(message?.text).toContain("https://bailey.baicells.com/?billing=renew");
    expect(`${message?.text}${message?.html}`).not.toContain("{{");
  });

  it("sends expired reminders for grants that ended in the previous 24 hours", async () => {
    const { db, raw } = createDbMock({
      id: "billing-customer-1",
      organizationId: "org-1",
      businessEmail: "customer@example.com",
      billingEmail: "customer@example.com",
      companyName: "Customer Inc",
      contactName: null,
      countryRegion: null,
      sn: null,
      salesContact: "sales@baicells.com",
      stripeCustomerId: null,
      defaultAutoRenew: true,
      metadataJson: null
    });
    raw.billingEmailRule.findMany.mockResolvedValueOnce([
      {
        id: "billing-email-rule-expired-0",
        triggerType: "expired",
        offsetDays: 0,
        status: "enabled",
        audienceJson: { billingContacts: true, salesContact: false },
        subject: "{{brand_name}} expired",
        bodyText: "{{email_heading}}: {{plan_name}} for {{company_name}} ended on {{access_end_date}}. {{renewal_summary}} {{renew_url}}",
        bodyHtml: '<table><tr><td>{{company_name}}</td><td>{{renewal_summary}}</td><td><a href="{{renew_url}}">Renew</a></td></tr></table>',
        lastRunAt: null,
        createdAt: new Date("2026-06-12T00:00:00.000Z"),
        updatedAt: new Date("2026-06-12T00:00:00.000Z")
      }
    ]);
    raw.organization.findUnique.mockResolvedValueOnce({ id: "org-1", name: "Customer <Inc>", slug: "customer", ownerUserId: null });
    raw.subscriptionGrant.findMany.mockResolvedValueOnce([
      {
        id: "grant-1",
        principalType: "organization",
        principalId: "org-1",
        planId: "plan-plus",
        status: "active",
        startsAt: new Date("2026-05-12T00:00:00.000Z"),
        expiresAt: new Date("2026-06-11T12:00:00.000Z"),
        cycleAnchorAt: new Date("2026-05-12T00:00:00.000Z"),
        note: null,
        createdAt: new Date("2026-05-12T00:00:00.000Z"),
        updatedAt: new Date("2026-05-12T00:00:00.000Z"),
        plan: {
          id: "plan-plus",
          name: "Plus",
          billingPriceCents: 9900,
          billingCurrency: "usd"
        }
      }
    ]);
    const send = vi.fn(async (_input: Parameters<AuthEmailSender["send"]>[0]) => ({ delivered: true, mode: "smtp" as const }));
    const emailSender: AuthEmailSender = { send };
    const service = new BillingService({
      db,
      config: { ...createBillingConfig(), billingEmailEnabled: true },
      emailSender,
      resolveBrandName: async () => "Bailey"
    });

    await expect(service.runReminderSweep({ now: new Date("2026-06-12T00:00:00.000Z") })).resolves.toMatchObject({
      ok: true,
      results: [{ ruleId: "billing-email-rule-expired-0", sent: 1, skipped: 0, failed: 0 }]
    });

    const findManyArgs = raw.subscriptionGrant.findMany.mock.calls[0]?.[0] as unknown as { where: { expiresAt: { gte: Date; lt: Date } } };
    expect(findManyArgs.where.expiresAt.gte.toISOString()).toBe("2026-06-11T00:00:00.000Z");
    expect(findManyArgs.where.expiresAt.lt.toISOString()).toBe("2026-06-12T00:00:00.000Z");
    const html = send.mock.calls[0]?.[0]?.html ?? "";
    expect(send.mock.calls[0]?.[0]?.to).toEqual(["customer@example.com"]);
    expect(html).toContain("Customer &lt;Inc&gt;");
    expect(html).toContain("Auto-renew is off. Choose a plan before the access end date to avoid interruption.");
    expect(html).toContain("https://bailey.baicells.com/?billing=renew");
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

  it("links a unique existing Stripe customer before checkout", async () => {
    const { db, raw } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [
        {
          id: "cus_existing_123",
          email: "customer@example.com",
          name: "Customer Inc",
          invoice_settings: { default_payment_method: "pm_saved_123" },
          created: 1781452800
        }
      ],
      has_more: false
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const customer = await (service as unknown as {
        ensureBillingCustomerForOrganization(input: {
          organization: { id: string; name: string; slug: string; type: string };
          user: { id: string; email: string; displayName: string };
        }): Promise<Record<string, unknown>>;
      }).ensureBillingCustomerForOrganization({
        organization: { id: "org-1", name: "Customer Inc", slug: "customer", type: "customer" },
        user: { id: "user-1", email: "customer@example.com", displayName: "Customer User" }
      });

      expect(customer.stripeCustomerId).toBe("cus_existing_123");
      expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/customers/search?");
      const upsertArgs = raw.billingCustomer.upsert.mock.calls[0]?.[0] as unknown as { create: { metadataJson: Record<string, unknown> } };
      expect(upsertArgs.create.metadataJson.stripeCustomerLookup).toMatchObject({
        status: "matched",
        email: "customer@example.com",
        stripeCustomerId: "cus_existing_123"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("does not auto-bind when Stripe has multiple customers for the same email", async () => {
    const { db, raw } = createDbMock();
    const service = new BillingService({ db, config: createBillingConfig() });
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({
      data: [
        { id: "cus_existing_1", email: "customer@example.com", name: "Customer A" },
        { id: "cus_existing_2", email: "customer@example.com", name: "Customer B" }
      ],
      has_more: false
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    try {
      const customer = await (service as unknown as {
        ensureBillingCustomerForOrganization(input: {
          organization: { id: string; name: string; slug: string; type: string };
          user: { id: string; email: string; displayName: string };
        }): Promise<Record<string, unknown>>;
      }).ensureBillingCustomerForOrganization({
        organization: { id: "org-1", name: "Customer Inc", slug: "customer", type: "customer" },
        user: { id: "user-1", email: "customer@example.com", displayName: "Customer User" }
      });

      expect(customer.stripeCustomerId).toBeNull();
      const upsertArgs = raw.billingCustomer.upsert.mock.calls[0]?.[0] as unknown as { create: { metadataJson: Record<string, unknown> } };
      expect(upsertArgs.create.metadataJson.stripeCustomerLookup).toMatchObject({
        status: "multiple",
        email: "customer@example.com"
      });
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("keeps an existing Agent Studio Stripe customer binding without lookup", async () => {
    const { db } = createDbMock({
      id: "billing-customer-1",
      organizationId: "org-1",
      businessEmail: "customer@example.com",
      billingEmail: "customer@example.com",
      companyName: "Customer Inc",
      contactName: null,
      countryRegion: null,
      sn: null,
      salesContact: null,
      stripeCustomerId: "cus_already_bound",
      defaultAutoRenew: true,
      metadataJson: { inferredFrom: "current_user" }
    });
    const service = new BillingService({ db, config: createBillingConfig() });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    try {
      const customer = await (service as unknown as {
        ensureBillingCustomerForOrganization(input: {
          organization: { id: string; name: string; slug: string; type: string };
          user: { id: string; email: string; displayName: string };
        }): Promise<Record<string, unknown>>;
      }).ensureBillingCustomerForOrganization({
        organization: { id: "org-1", name: "Customer Inc", slug: "customer", type: "customer" },
        user: { id: "user-1", email: "customer@example.com", displayName: "Customer User" }
      });

      expect(customer.stripeCustomerId).toBe("cus_already_bound");
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
