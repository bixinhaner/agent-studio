import { Router, type Request, type Response } from "express";

import type { SubscriptionEntitlementService } from "../operations/subscription-entitlement-service.js";
import type { BillingService } from "./service.js";

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function detailFromError(error: unknown): string {
  return error instanceof Error ? error.message : "Request failed";
}

function parseBoolean(value: unknown, fallback: boolean): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (typeof item === "string" ? item.trim() : "")).filter(Boolean);
}

function parseInteger(value: unknown, fallback = 0): number {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  return Number.isFinite(parsed) ? Math.floor(parsed) : fallback;
}

function parseOptionalNullableInteger(value: unknown, fieldLabel: string): number | null | undefined {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new Error(`${fieldLabel} must be a number`);
  }
  return Math.floor(parsed);
}

function currentBillingUser(req: Request) {
  return {
    id: req.currentUser?.id ?? "system",
    email: req.currentUser?.email ?? null,
    displayName: req.currentUser?.displayName ?? null
  };
}

function currentBillingOrganization(req: Request) {
  const organization = req.currentOrganization;
  if (!organization?.id) {
    throw new Error("current organization is required");
  }
  return {
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    type: organization.type
  };
}

function requirePortalBillingCustomer(req: Request, res: Response) {
  const organization = req.currentOrganization;
  if (!req.currentUser) {
    res.status(401).json({ detail: "Unauthorized" });
    return null;
  }
  if (!organization?.id) {
    res.status(403).json({ detail: "Organization context is required" });
    return null;
  }
  if (req.currentUser.userType !== "external_user" || organization.type !== "customer") {
    res.status(403).json({ detail: "Customer billing is only available to external customer organizations" });
    return null;
  }
  return {
    organization: currentBillingOrganization(req),
    user: currentBillingUser(req)
  };
}

function portalSubscriptionStatusPayload(status: Awaited<ReturnType<SubscriptionEntitlementService["getPortalSubscriptionStatus"]>>) {
  return {
    accessState: status.accessState,
    tone: status.tone,
    sourceType: status.sourceType,
    sourceLabel: status.sourceLabel,
    title: status.title,
    summary: status.summary,
    detail: status.detail,
    actionLabel: status.actionLabel,
    planName: status.planName,
    expiresAt: status.expiresAt,
    cycleEndsAt: status.cycleEndsAt,
    remainingCompletedTurns: status.remainingCompletedTurns,
    completedTurnLimit: status.completedTurnLimit,
    reasonCode: status.reasonCode
  };
}

export function createAdminBillingRouter(service: BillingService): Router {
  const router = Router();

  router.get("/billing/overview", async (_req: Request, res: Response) => {
    try {
      res.json(await service.getAdminOverview());
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/stripe-settings", async (req: Request, res: Response) => {
    try {
      const stripe = await service.updateStripeSettings({
        mode: req.body?.mode,
        stripeSecretKey: req.body?.stripeSecretKey,
        webhookSigningSecret: req.body?.webhookSigningSecret,
        successUrl: req.body?.successUrl,
        cancelUrl: req.body?.cancelUrl,
        portalBillingUrl: req.body?.portalBillingUrl,
        defaultCurrency: req.body?.defaultCurrency,
        defaultAutoRenew: typeof req.body?.defaultAutoRenew === "boolean" ? req.body.defaultAutoRenew : undefined,
        clearStripeSecretKey: req.body?.clearStripeSecretKey === true,
        clearWebhookSigningSecret: req.body?.clearWebhookSigningSecret === true,
        userId: req.currentUser?.id ?? null
      });
      res.json({ stripe });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/email-settings", async (req: Request, res: Response) => {
    try {
      const emailSettings = await service.updateEmailSettings({
        enabled: typeof req.body?.enabled === "boolean" ? req.body.enabled : undefined,
        userId: req.currentUser?.id ?? null
      });
      res.json({ emailSettings });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/plans/:planId", async (req: Request, res: Response) => {
    try {
      const plan = await service.updatePlanBilling(req.params.planId, {
        billingCurrency: req.body?.billingCurrency,
        billingInterval: req.body?.billingInterval,
        billingIntervalCount: parseOptionalNullableInteger(req.body?.billingIntervalCount, "billingIntervalCount") ?? undefined,
        billingPriceCents: parseOptionalNullableInteger(req.body?.billingPriceCents, "billingPriceCents"),
        billingStatus: req.body?.billingStatus
      });
      res.json({ plan });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/promotion-codes", async (req: Request, res: Response) => {
    try {
      const created = await service.createPromotionCode({
        code: String(req.body?.code ?? ""),
        name: req.body?.name,
        description: req.body?.description,
        type: String(req.body?.type ?? ""),
        value: parseInteger(req.body?.value, 0),
        currency: req.body?.currency,
        status: req.body?.status,
        maxRedemptions: req.body?.maxRedemptions === null ? null : parseInteger(req.body?.maxRedemptions, 0) || null,
        perCustomerLimit: req.body?.perCustomerLimit === null ? null : parseInteger(req.body?.perCustomerLimit, 1),
        startsAt: req.body?.startsAt,
        expiresAt: req.body?.expiresAt,
        eligiblePlanIds: stringArray(req.body?.eligiblePlanIds),
        eligibleOrganizationIds: stringArray(req.body?.eligibleOrganizationIds),
        eligibleEmailDomains: stringArray(req.body?.eligibleEmailDomains),
        eligibleSnValues: stringArray(req.body?.eligibleSnValues),
        ownerUserId: req.body?.ownerUserId,
        createdByUserId: req.currentUser?.id ?? null,
        note: req.body?.note
      });
      res.status(201).json({ promotionCode: created });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/promotion-codes/:promotionCodeId", async (req: Request, res: Response) => {
    try {
      const updated = await service.updatePromotionCode(req.params.promotionCodeId, {
        name: req.body?.name,
        description: req.body?.description,
        status: req.body?.status,
        maxRedemptions: req.body?.maxRedemptions,
        perCustomerLimit: req.body?.perCustomerLimit,
        expiresAt: req.body?.expiresAt,
        note: req.body?.note
      });
      res.json({ promotionCode: updated });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/payment-links", async (req: Request, res: Response) => {
    try {
      const organizationId = trimOrUndefined(req.body?.organizationId);
      const planId = trimOrUndefined(req.body?.planId);
      if (!organizationId || !planId) {
        res.status(400).json({ detail: "organizationId and planId are required" });
        return;
      }
      const result = await service.createAdminPaymentLink({
        organizationId,
        user: currentBillingUser(req),
        planId,
        promotionCode: req.body?.promotionCode,
        autoRenew: parseBoolean(req.body?.autoRenew, true)
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/customers/:billingCustomerId/stripe-customer/lookup", async (req: Request, res: Response) => {
    try {
      const billingCustomer = await service.lookupStripeCustomerForBillingCustomer({
        billingCustomerId: req.params.billingCustomerId
      });
      res.json({ billingCustomer });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/customers/:billingCustomerId/stripe-customer", async (req: Request, res: Response) => {
    try {
      const billingCustomer = await service.bindBillingCustomerToStripeCustomer({
        billingCustomerId: req.params.billingCustomerId,
        stripeCustomerId: String(req.body?.stripeCustomerId ?? ""),
        userId: req.currentUser?.id ?? null
      });
      res.json({ billingCustomer });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/gift-days", async (req: Request, res: Response) => {
    try {
      const organizationId = trimOrUndefined(req.body?.organizationId);
      const planId = trimOrUndefined(req.body?.planId);
      if (!organizationId || !planId) {
        res.status(400).json({ detail: "organizationId and planId are required" });
        return;
      }
      const result = await service.grantGiftDays({
        organizationId,
        planId,
        days: parseInteger(req.body?.days, 0),
        reason: req.body?.reason,
        promotionCodeId: req.body?.promotionCodeId,
        userId: req.currentUser?.id ?? null
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.patch("/billing/email-rules/:ruleId", async (req: Request, res: Response) => {
    try {
      const rule = await service.updateEmailRule(req.params.ruleId, {
        status: req.body?.status,
        audience: req.body?.audience,
        subject: req.body?.subject,
        bodyText: req.body?.bodyText,
        bodyHtml: req.body?.bodyHtml,
        userId: req.currentUser?.id ?? null
      });
      res.json({ emailRule: rule });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/email-reminders/run", async (req: Request, res: Response) => {
    try {
      const result = await service.runReminderSweep({
        testEmail: req.body?.testEmail
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/email-rules/:ruleId/test", async (req: Request, res: Response) => {
    try {
      const result = await service.sendReminderTestEmail({
        ruleId: req.params.ruleId,
        testEmail: String(req.body?.testEmail ?? "")
      });
      res.json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}

export function createPortalBillingRouter(
  service: BillingService,
  options: {
    subscriptionEntitlements?: Pick<SubscriptionEntitlementService, "getPortalSubscriptionStatus">;
  } = {}
): Router {
  const router = Router();

  router.get("/billing/summary", async (req: Request, res: Response) => {
    try {
      const actor = requirePortalBillingCustomer(req, res);
      if (!actor) return;
      const { organization, user } = actor;
      const [billing, subscriptionStatus] = await Promise.all([
        service.getPortalSummary({ organization, user }),
        options.subscriptionEntitlements
          ? options.subscriptionEntitlements.getPortalSubscriptionStatus({
              currentUser: {
                id: user.id,
                organizationId: organization.id,
                organizationType: organization.type ?? undefined
              },
              model: ""
            })
          : Promise.resolve(null)
      ]);
      res.json({
        billing,
        subscriptionStatus: subscriptionStatus ? portalSubscriptionStatusPayload(subscriptionStatus) : null
      });
    } catch (error) {
      res.status(500).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/promotion/preview", async (req: Request, res: Response) => {
    try {
      const actor = requirePortalBillingCustomer(req, res);
      if (!actor) return;
      const { organization, user } = actor;
      const billing = await service.getPortalSummary({ organization, user });
      const planId = trimOrUndefined(req.body?.planId);
      if (!planId) {
        res.status(400).json({ detail: "planId is required" });
        return;
      }
      const preview = await service.previewPromotion({
        code: req.body?.code,
        planId,
        organizationId: organization.id,
        businessEmail: billing.billingCustomer.businessEmail,
        sn: billing.billingCustomer.sn
      });
      res.json({ promotion: preview });
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  router.post("/billing/checkout", async (req: Request, res: Response) => {
    try {
      const actor = requirePortalBillingCustomer(req, res);
      if (!actor) return;
      const planId = trimOrUndefined(req.body?.planId);
      if (!planId) {
        res.status(400).json({ detail: "planId is required" });
        return;
      }
      const result = await service.createPortalCheckout({
        organization: actor.organization,
        user: actor.user,
        planId,
        promotionCode: req.body?.promotionCode,
        autoRenew: parseBoolean(req.body?.autoRenew, true)
      });
      res.status(201).json(result);
    } catch (error) {
      res.status(400).json({ detail: detailFromError(error) });
    }
  });

  return router;
}
