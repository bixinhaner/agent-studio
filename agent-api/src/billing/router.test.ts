import express, { type RequestHandler } from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";

import { createPortalBillingRouter } from "./router.js";
import type { BillingService } from "./service.js";

type PortalActor = {
  userType: string;
  organizationType: string;
};

function createServiceMock() {
  return {
    getPortalSummary: vi.fn(async () => ({
      billingCustomer: {
        id: "billing-customer-1",
        organizationId: "org-1",
        businessEmail: "customer@example.com",
        companyName: "Customer Inc",
        contactName: "Customer User",
        countryRegion: "US",
        billingEmail: "customer@example.com",
        sn: null,
        salesContact: null,
        stripeCustomerId: null,
        createdAt: "2026-06-15T00:00:00.000Z",
        updatedAt: "2026-06-15T00:00:00.000Z"
      },
      currentAccess: null,
      autoRenewal: null,
      plans: [],
      orders: [],
      promotionRedemptions: []
    })),
    previewPromotion: vi.fn(async () => ({ promotion: null, discountCents: 0, giftDays: 0, amountTotalCents: 0, message: null })),
    createPortalCheckout: vi.fn(async () => ({ order: { id: "order-1" }, checkoutUrl: "https://stripe.example/checkout", promotion: null }))
  };
}

function buildApp(
  service: ReturnType<typeof createServiceMock>,
  actor: PortalActor,
  publicBrand?: { billingEnabled: boolean; subscriptionPlanIds: string[]; billingSuccessUrl?: string; billingCancelUrl?: string }
) {
  const app = express();
  app.use(express.json());
  app.use(((req, _res, next) => {
    req.currentUser = {
      id: "user-1",
      userType: actor.userType,
      role: "employee",
      status: "active",
      email: "user@example.com",
      displayName: "Portal User",
      primaryOrganizationId: "org-1",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    };
    req.currentOrganization = {
      id: "org-1",
      slug: "org-1",
      name: "Org 1",
      type: actor.organizationType,
      status: "active",
      createdAt: "2026-06-15T00:00:00.000Z",
      updatedAt: "2026-06-15T00:00:00.000Z"
    };
    next();
  }) as RequestHandler);
  app.use(createPortalBillingRouter(service as unknown as BillingService, {
    publicBrands: publicBrand ? { getForOrganization: async () => publicBrand } as never : undefined
  }));
  return app;
}

describe("createPortalBillingRouter", () => {
  it("rejects internal organization access to customer billing routes", async () => {
    const service = createServiceMock();
    const app = buildApp(service, { userType: "internal_employee", organizationType: "internal" });

    await request(app).get("/billing/summary").expect(403);
    await request(app).post("/billing/promotion/preview").send({ planId: "plan-1", code: "PROMO" }).expect(403);
    await request(app).post("/billing/checkout").send({ planId: "plan-1" }).expect(403);

    expect(service.getPortalSummary).not.toHaveBeenCalled();
    expect(service.previewPromotion).not.toHaveBeenCalled();
    expect(service.createPortalCheckout).not.toHaveBeenCalled();
  });

  it("allows external customer organizations to read their billing summary", async () => {
    const service = createServiceMock();
    const app = buildApp(service, { userType: "external_user", organizationType: "customer" });

    const response = await request(app).get("/billing/summary").expect(200);

    expect(response.body.billing.billingCustomer.businessEmail).toBe("customer@example.com");
    expect(service.getPortalSummary).toHaveBeenCalledWith({
      organization: {
        id: "org-1",
        name: "Org 1",
        slug: "org-1",
        type: "customer"
      },
      user: {
        id: "user-1",
        email: "user@example.com",
        displayName: "Portal User"
      }
    });
  });

  it("rejects plans that are not assigned to the organization brand", async () => {
    const service = createServiceMock();
    const app = buildApp(
      service,
      { userType: "external_user", organizationType: "customer" },
      { billingEnabled: true, subscriptionPlanIds: ["plan-ranley"] }
    );

    await request(app).post("/billing/checkout").send({ planId: "plan-bailey" }).expect(403);

    expect(service.createPortalCheckout).not.toHaveBeenCalled();
  });
});
