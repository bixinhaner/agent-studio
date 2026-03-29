import { QuotaPolicyRepository, type QuotaPolicyMetricType, type QuotaPolicyRecord } from "../persistence/quota-policy-repository.js";
import { UsageRollupRepository, type UsageDailyRollupRecord } from "../persistence/usage-rollup-repository.js";

export type QuotaDecision = "allow" | "soft_block";

export type QuotaEvaluationInput = {
  organizationId?: string;
  departmentId?: string;
  model?: string;
  featureType?: string;
  rollupDate?: string | Date;
};

export type EvaluatedQuotaPolicy = {
  policy: QuotaPolicyRecord;
  observedValue: number;
  thresholdValue: number;
  exceeded: boolean;
};

export type QuotaEvaluationResult = {
  decision: QuotaDecision;
  policy?: QuotaPolicyRecord;
  observedValue: number;
  thresholdValue?: number;
  evaluatedPolicies: EvaluatedQuotaPolicy[];
};

export class QuotaEvaluationService {
  constructor(
    private readonly deps: {
      policies: QuotaPolicyRepository;
      rollups: UsageRollupRepository;
    }
  ) {}

  async evaluate(input: QuotaEvaluationInput): Promise<QuotaEvaluationResult> {
    const rollupDate = toDayKey(input.rollupDate ?? new Date());
    const organizationId = input.organizationId === undefined ? null : input.organizationId;
    const departmentPolicies = input.departmentId
      ? await this.deps.policies.list({
          organizationId,
          scopeType: "department",
          scopeId: input.departmentId,
          isActive: true
        })
      : [];
    const platformPolicies = await this.deps.policies.list({
      organizationId,
      scopeType: "platform",
      scopeId: "platform",
      isActive: true
    });

    const policies = [...departmentPolicies, ...platformPolicies];
    const evaluatedPolicies: EvaluatedQuotaPolicy[] = [];
    let firstExceededPolicy: QuotaPolicyRecord | undefined;
    let firstObservedValue = 0;
    let firstThresholdValue: number | undefined;
    let firstBlockingPolicy: QuotaPolicyRecord | undefined;
    let firstBlockingObservedValue = 0;
    let firstBlockingThresholdValue: number | undefined;
    let anySoftBlock = false;

    for (const policy of policies) {
      if (!matchesPolicyFilters(policy, input)) continue;
      const scopedRollups = await this.deps.rollups.list({
        organizationId,
        rollupDate,
        scopeType: policy.scopeType,
        scopeId: policy.scopeId,
        model: policy.model,
        featureType: policy.featureType
      });
      const observedValue = summarizeMetric(policy.metricType, scopedRollups);
      const thresholdValue = Number(policy.thresholdValue);
      const hasThreshold = Number.isFinite(thresholdValue);
      const exceeded = hasThreshold && observedValue >= thresholdValue;
      evaluatedPolicies.push({
        policy,
        observedValue,
        thresholdValue: hasThreshold ? thresholdValue : 0,
        exceeded
      });
      if (exceeded && !firstExceededPolicy) {
        firstExceededPolicy = policy;
        firstObservedValue = observedValue;
        firstThresholdValue = hasThreshold ? thresholdValue : undefined;
      }
      if (exceeded && policy.enforcementMode === "soft_block") {
        anySoftBlock = true;
        if (!firstBlockingPolicy) {
          firstBlockingPolicy = policy;
          firstBlockingObservedValue = observedValue;
          firstBlockingThresholdValue = hasThreshold ? thresholdValue : undefined;
        }
      }
    }

    if (!evaluatedPolicies.length) {
      return {
        decision: "allow",
        observedValue: 0,
        evaluatedPolicies: []
      };
    }

    return {
      decision: anySoftBlock ? "soft_block" : "allow",
      policy: firstBlockingPolicy ?? firstExceededPolicy ?? evaluatedPolicies[0]?.policy,
      observedValue: firstBlockingPolicy
        ? firstBlockingObservedValue
        : firstExceededPolicy
          ? firstObservedValue
          : evaluatedPolicies[0]?.observedValue ?? 0,
      thresholdValue: firstBlockingPolicy
        ? firstBlockingThresholdValue
        : firstExceededPolicy
          ? firstThresholdValue
          : evaluatedPolicies[0]?.thresholdValue,
      evaluatedPolicies
    };
  }
}

function matchesPolicyFilters(policy: QuotaPolicyRecord, input: QuotaEvaluationInput): boolean {
  if (policy.model && policy.model !== trimOrUndefined(input.model)) return false;
  if (policy.featureType && policy.featureType !== trimOrUndefined(input.featureType)) return false;
  return true;
}

function summarizeMetric(metricType: QuotaPolicyMetricType, rows: UsageDailyRollupRecord[]): number {
  switch (metricType) {
    case "request_count":
      return rows.reduce((sum, row) => sum + row.requestCount, 0);
    case "total_tokens":
      return rows.reduce((sum, row) => sum + row.inputTokens + row.cachedInputTokens + row.outputTokens, 0);
    case "estimated_cost":
      return rows.reduce((sum, row) => sum + Number(row.estimatedCost), 0);
    case "internal_cost":
      return rows.reduce((sum, row) => sum + Number(row.internalCost), 0);
  }
}

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toDayKey(value: string | Date): string {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (trimmed) return trimmed.slice(0, 10);
    return new Date().toLocaleDateString("en-CA");
  }
  return value.toLocaleDateString("en-CA");
}
