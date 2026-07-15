export type BillingCycle = "month" | "year";

export type BillingPlanLike = {
  id: string;
  slug: string;
  name: string;
  description?: string | null;
  billingInterval: string;
  billingIntervalCount: number;
  billingPriceCents: number | null;
  monthlyCompletedTurnLimit?: number | null;
};

export type BillingPlanFamily<TPlan extends BillingPlanLike> = {
  key: string;
  title: string;
  subtitle: string;
  monthly: TPlan | null;
  annual: TPlan | null;
  other: TPlan[];
  limit: number | null;
};

const BILLING_CADENCE_SUFFIX = /[-_](?:monthly|annual|month|year)$/i;
const BILLING_CADENCE_NAME_SUFFIX = /\s+(?:monthly|annual)$/i;

export function billingCycleForPlan(plan?: BillingPlanLike | null): BillingCycle | null {
  if (!plan || plan.billingIntervalCount !== 1) return null;
  if (plan.billingInterval === "month" || plan.billingInterval === "year") return plan.billingInterval;
  return null;
}

export function billingPlanFamilyKey(plan: BillingPlanLike): string {
  return plan.slug.replace(BILLING_CADENCE_SUFFIX, "") || plan.id;
}

function planFamilyTitle<TPlan extends BillingPlanLike>(family: Pick<BillingPlanFamily<TPlan>, "monthly" | "annual" | "other">): string {
  const representative = family.annual ?? family.monthly ?? family.other[0];
  return representative?.name.replace(BILLING_CADENCE_NAME_SUFFIX, "").trim() || "Unnamed plan";
}

function planFamilySubtitle<TPlan extends BillingPlanLike>(family: Pick<BillingPlanFamily<TPlan>, "monthly" | "annual" | "other">): string {
  const representative = family.annual ?? family.monthly ?? family.other[0];
  return representative?.description?.trim() || "Billing terms configured by plan";
}

function planFamilyPrice<TPlan extends BillingPlanLike>(family: BillingPlanFamily<TPlan>): number {
  const prices = [family.monthly, family.annual, ...family.other]
    .map((plan) => plan?.billingPriceCents)
    .filter((price): price is number => price !== null && price !== undefined);
  return prices.length ? Math.min(...prices) : Number.MAX_SAFE_INTEGER;
}

export function groupBillingPlans<TPlan extends BillingPlanLike>(plans: TPlan[]): BillingPlanFamily<TPlan>[] {
  const groups = new Map<string, BillingPlanFamily<TPlan>>();

  for (const plan of plans) {
    const key = billingPlanFamilyKey(plan);
    const current = groups.get(key) ?? {
      key,
      title: "",
      subtitle: "",
      monthly: null,
      annual: null,
      other: [],
      limit: null
    };
    current.limit = current.limit ?? plan.monthlyCompletedTurnLimit ?? null;
    const cycle = billingCycleForPlan(plan);
    if (cycle === "month") current.monthly = plan;
    else if (cycle === "year") current.annual = plan;
    else current.other.push(plan);
    groups.set(key, current);
  }

  const families = [...groups.values()];
  for (const family of families) {
    family.title = planFamilyTitle(family);
    family.subtitle = planFamilySubtitle(family);
  }
  return families.sort((left, right) => {
    const priceDifference = planFamilyPrice(left) - planFamilyPrice(right);
    return priceDifference || left.title.localeCompare(right.title);
  });
}

export function planForBillingCycle<TPlan extends BillingPlanLike>(
  family: BillingPlanFamily<TPlan> | null | undefined,
  cycle: BillingCycle
): TPlan | null {
  if (!family) return null;
  return cycle === "year"
    ? family.annual ?? family.monthly ?? family.other[0] ?? null
    : family.monthly ?? family.annual ?? family.other[0] ?? null;
}
