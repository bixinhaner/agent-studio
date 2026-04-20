import { describe, expect, it, vi } from "vitest";

import type { SubscriptionGrantRecord } from "../persistence/subscription-grant-repository.js";
import type { SubscriptionPlanRecord } from "../persistence/subscription-plan-repository.js";
import { SubscriptionEntitlementService } from "./subscription-entitlement-service.js";

function createService(options?: {
  userGrant?: SubscriptionGrantRecord | null;
  organizationGrant?: SubscriptionGrantRecord | null;
  plan?: SubscriptionPlanRecord | null;
  usageCount?: number;
  usedTokens?: number;
}) {
  const usageCount = options?.usageCount ?? 0;
  const usedTokens = options?.usedTokens ?? 0;
  const tokenChunks =
    usageCount > 0 ? Array.from({ length: usageCount }, (_item, index) => (index === 0 ? usedTokens : 0)) : [];

  return new SubscriptionEntitlementService({
    grants: {
      getByPrincipal: vi.fn(async (principalType: "user" | "organization") =>
        principalType === "user" ? options?.userGrant ?? null : options?.organizationGrant ?? null
      )
    },
    plans: {
      getById: vi.fn(async () => options?.plan ?? null)
    },
    usageEvents: {
      listByExactCreatedAtRange: vi.fn(async () =>
        tokenChunks.map((tokens, index) => ({
          id: `usage-${index}`,
          organizationId: "org-1",
          userId: "user-1",
          model: "gpt-5.4",
          featureType: "chat",
          inputTokens: tokens,
          cachedInputTokens: 0,
          outputTokens: 0,
          estimatedCost: "0.000000",
          internalCost: "0.000000",
          resultStatus: "success",
          metadata: null,
          createdAt: new Date().toISOString()
        }))
      )
    }
  });
}

function createGrant(overrides?: Partial<SubscriptionGrantRecord>): SubscriptionGrantRecord {
  return {
    id: "grant-1",
    principalType: "user",
    principalId: "user-1",
    status: "active",
    startsAt: "2026-04-01T00:00:00.000Z",
    expiresAt: "2026-05-01T00:00:00.000Z",
    cycleAnchorAt: "2026-04-01T00:00:00.000Z",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides
  };
}

function createPlan(overrides?: Partial<SubscriptionPlanRecord>): SubscriptionPlanRecord {
  return {
    id: "plan-1",
    slug: "pro",
    name: "Pro",
    status: "active",
    featureType: "chat",
    createdAt: "2026-04-01T00:00:00.000Z",
    updatedAt: "2026-04-01T00:00:00.000Z",
    ...overrides
  };
}

describe("SubscriptionEntitlementService", () => {
  it("allows internal users without any subscription", async () => {
    const service = createService();

    const decision = await service.evaluateAccessForChat({
      currentUser: {
        id: "user-1",
        organizationId: "org-1",
        organizationType: "internal"
      },
      model: "gpt-5.4",
      now: new Date("2026-04-20T00:00:00.000Z")
    });

    expect(decision.allowed).toBe(true);
    expect(decision.defaultPolicy).toBe("internal_unlimited");
  });

  it("blocks external users without any subscription", async () => {
    const service = createService();

    const decision = await service.evaluateAccessForChat({
      currentUser: {
        id: "user-1",
        organizationId: "org-1",
        organizationType: "customer"
      },
      model: "gpt-5.4",
      now: new Date("2026-04-20T00:00:00.000Z")
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("external_subscription_required");
  });

  it("blocks when completed turn limit has been exhausted", async () => {
    const service = createService({
      userGrant: createGrant(),
      plan: createPlan({ monthlyCompletedTurnLimit: 3 }),
      usageCount: 3
    });

    const decision = await service.evaluateAccessForChat({
      currentUser: {
        id: "user-1",
        organizationId: "org-1",
        organizationType: "customer"
      },
      model: "gpt-5.4",
      now: new Date("2026-04-20T00:00:00.000Z")
    });

    expect(decision.allowed).toBe(false);
    expect(decision.reasonCode).toBe("user_turn_limit_exceeded");
    expect(decision.userGrant?.usage?.usedCompletedTurns).toBe(3);
  });
});
