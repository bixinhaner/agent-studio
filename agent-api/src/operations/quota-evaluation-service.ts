import {
  QuotaPolicyRepository,
  type QuotaPolicyMetricType,
  type QuotaPolicyRecord,
} from "../persistence/quota-policy-repository.js";
import { UsageRollupRepository, type UsageDailyRollupRecord } from "../persistence/usage-rollup-repository.js";

export type QuotaDecision = "allow" | "soft_block";

export type QuotaEvaluationInput = {
  organizationId?: string;
  departmentId?: string;
  model?: string;
  featureType?: string;
  rollupDate?: string | Date;
};

export type QuotaEvaluationResult = {
  decision: QuotaDecision;
  policy?: QuotaPolicyRecord;
  observedValue: number;
  thresholdValue?: number;
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
    const departmentPolicies = input.departmentId
      ? await this.deps.policies.list({
          organizationId: input.organizationId,
          scopeType: "department",
          scopeId: input.departmentId,
          isActive: true
        })
      : [];
    const platformPolicies = await this.deps.policies.list({
      organizationId: input.organizationId,
      scopeType: "platform",
      scopeId: "platform",
      isActive: true
    });
    const policy = selectBestPolicy(departmentPolicies, input) ?? selectBestPolicy(platformPolicies, input);

    if (!policy) {
      return {
        decision: "allow",
        observedValue: 0
      };
    }

    const rollups = await this.deps.rollups.list({
      organizationId: input.organizationId,
      rollupDate,
      scopeType: policy.scopeType,
      scopeId: policy.scopeId,
      model: policy.model,
      featureType: policy.featureType
    });
    const observedValue = summarizeMetric(policy.metricType, rollups);
    const thresholdValue = Number(policy.thresholdValue);
    const exceeded = Number.isFinite(thresholdValue) && observedValue >= thresholdValue;

    return {
      decision: exceeded && policy.enforcementMode === "soft_block" ? "soft_block" : "allow",
      policy,
      observedValue,
      thresholdValue: Number.isFinite(thresholdValue) ? thresholdValue : undefined
    };
  }
}

function selectBestPolicy(policies: QuotaPolicyRecord[], input: QuotaEvaluationInput): QuotaPolicyRecord | undefined {
  return [...policies]
    .filter((policy) => matchesPolicyFilters(policy, input))
    .sort((left, right) => {
      const specificityDiff = specificityScore(right) - specificityScore(left);
      if (specificityDiff !== 0) return specificityDiff;
      return right.updatedAt.localeCompare(left.updatedAt, "en");
    })[0];
}

function matchesPolicyFilters(policy: QuotaPolicyRecord, input: QuotaEvaluationInput): boolean {
  if (policy.model && policy.model !== trimOrUndefined(input.model)) return false;
  if (policy.featureType && policy.featureType !== trimOrUndefined(input.featureType)) return false;
  return true;
}

function specificityScore(policy: QuotaPolicyRecord): number {
  let score = 0;
  if (policy.model) score += 2;
  if (policy.featureType) score += 1;
  return score;
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
