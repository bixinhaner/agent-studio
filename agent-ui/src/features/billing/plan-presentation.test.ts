import { describe, expect, it } from "vitest";

import {
  billingPlanFamilyKey,
  groupBillingPlans,
  planForBillingCycle,
  recommendedBillingPlanFamily,
  type BillingPlanLike
} from "./plan-presentation";

function plan(overrides: Partial<BillingPlanLike> & Pick<BillingPlanLike, "id" | "slug" | "name">): BillingPlanLike {
  return {
    description: null,
    billingInterval: "year",
    billingIntervalCount: 1,
    billingPriceCents: null,
    monthlyCompletedTurnLimit: null,
    ...overrides
  };
}

describe("billing plan presentation", () => {
  it("groups cadence variants by stable slug without inspecting the marketing name", () => {
    const monthly = plan({
      id: "standard-monthly",
      slug: "standard-monthly",
      name: "Any monthly name",
      billingInterval: "month",
      billingPriceCents: 9900,
      monthlyCompletedTurnLimit: 300
    });
    const annual = plan({
      id: "standard-annual",
      slug: "standard-annual",
      name: "Customer-facing variable name",
      billingPriceCents: 99900,
      monthlyCompletedTurnLimit: 300
    });

    const [family] = groupBillingPlans([monthly, annual]);

    expect(family.key).toBe("standard");
    expect(family.title).toBe("Customer-facing variable name");
    expect(family.limit).toBe(300);
    expect(planForBillingCycle(family, "month")?.id).toBe(monthly.id);
    expect(planForBillingCycle(family, "year")?.id).toBe(annual.id);
  });

  it("keeps non-cadence plans separate and sorts priced families by price", () => {
    const trial = plan({ id: "trial", slug: "trial-for-standard", name: "Trial", billingInterval: "day" });
    const premium = plan({ id: "premium", slug: "premium-annual", name: "Premium Edition", billingPriceCents: 299900 });
    const primary = plan({ id: "primary", slug: "primary-annual", name: "Primary Edition", billingPriceCents: 59900 });

    const families = groupBillingPlans([trial, premium, primary]);

    expect(families.map((family) => family.key)).toEqual(["primary", "premium", "trial-for-standard"]);
    expect(billingPlanFamilyKey(trial)).toBe("trial-for-standard");
  });

  it("uses backend names after removing only a cadence suffix", () => {
    const [family] = groupBillingPlans([
      plan({ id: "custom", slug: "custom-annual", name: "Renamed by Marketing Annual", billingPriceCents: 100 })
    ]);

    expect(family.title).toBe("Renamed by Marketing");
  });

  it("recommends the middle-priced family without depending on its display name", () => {
    const families = groupBillingPlans([
      plan({ id: "entry", slug: "entry-annual", name: "Entry", billingPriceCents: 59900 }),
      plan({ id: "growth", slug: "growth-annual", name: "Marketing can rename this", billingPriceCents: 99900 }),
      plan({ id: "scale", slug: "scale-annual", name: "Scale", billingPriceCents: 299900 })
    ]);

    expect(recommendedBillingPlanFamily(families, "year")?.key).toBe("growth");
  });
});
