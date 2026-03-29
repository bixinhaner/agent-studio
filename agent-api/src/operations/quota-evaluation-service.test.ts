import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { QuotaPolicyRepository } from "../persistence/quota-policy-repository.js";
import { UsageRollupRepository } from "../persistence/usage-rollup-repository.js";
import { QuotaEvaluationService } from "./quota-evaluation-service.js";

describe("QuotaEvaluationService", () => {
  it("evaluates matching department and platform policies without shadowing other metrics", async () => {
    const db = new FakeOperationsDb();
    const policies = new QuotaPolicyRepository(db as never);
    const rollups = new UsageRollupRepository(db as never);
    const service = new QuotaEvaluationService({ policies, rollups });

    await policies.upsert({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "10",
      enforcementMode: "soft_block"
    });
    await policies.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      featureType: "chat",
      metricType: "total_tokens",
      windowType: "daily",
      thresholdValue: "100",
      enforcementMode: "soft_block"
    });

    await rollups.replaceDaily({
      rollupDate: "2026-03-30",
      records: [
        {
          organizationId: "org-1",
          scopeType: "department",
          scopeId: "dept-rd",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 2,
          successCount: 2,
          failureCount: 0,
          inputTokens: 40,
          cachedInputTokens: 20,
          outputTokens: 10,
          estimatedCost: "1.000000",
          internalCost: "1.500000"
        },
        {
          organizationId: "org-1",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 2,
          successCount: 2,
          failureCount: 0,
          inputTokens: 80,
          cachedInputTokens: 30,
          outputTokens: 10,
          estimatedCost: "1.000000",
          internalCost: "1.500000"
        }
      ]
    });

    const result = await service.evaluate({
      organizationId: "org-1",
      departmentId: "dept-rd",
      rollupDate: "2026-03-30",
      model: "gpt-5.4",
      featureType: "chat"
    });

    expect(result.decision).toBe("soft_block");
    expect(result.evaluatedPolicies).toHaveLength(2);
    expect(result.evaluatedPolicies?.map((item) => item.policy.scopeType)).toEqual(["department", "platform"]);
  });

  it("soft-blocks when any matching active policy is exceeded", async () => {
    const db = new FakeOperationsDb();
    const policies = new QuotaPolicyRepository(db as never);
    const rollups = new UsageRollupRepository(db as never);
    const service = new QuotaEvaluationService({ policies, rollups });

    await policies.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      featureType: "chat",
      metricType: "total_tokens",
      windowType: "daily",
      thresholdValue: "100",
      enforcementMode: "soft_block"
    });

    await rollups.replaceDaily({
      rollupDate: "2026-03-30",
      records: [
        {
          organizationId: "org-1",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 1,
          successCount: 1,
          failureCount: 0,
          inputTokens: 70,
          cachedInputTokens: 10,
          outputTokens: 30,
          estimatedCost: "1.000000",
          internalCost: "1.500000"
        }
      ]
    });

    const result = await service.evaluate({
      organizationId: "org-1",
      rollupDate: "2026-03-30",
      model: "gpt-5.4",
      featureType: "chat"
    });

    expect(result.decision).toBe("soft_block");
    expect(result.evaluatedPolicies).toHaveLength(1);
    expect(result.policy?.metricType).toBe("total_tokens");
  });

  it("lets department policy override the platform default for the same metric", async () => {
    const db = new FakeOperationsDb();
    const policies = new QuotaPolicyRepository(db as never);
    const rollups = new UsageRollupRepository(db as never);
    const service = new QuotaEvaluationService({ policies, rollups });

    await policies.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "1",
      enforcementMode: "soft_block"
    });
    await policies.upsert({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "10",
      enforcementMode: "soft_block"
    });

    await rollups.replaceDaily({
      rollupDate: "2026-03-30",
      records: [
        {
          organizationId: "org-1",
          scopeType: "platform",
          scopeId: "platform",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 2,
          successCount: 2,
          failureCount: 0,
          inputTokens: 80,
          cachedInputTokens: 30,
          outputTokens: 10,
          estimatedCost: "1.000000",
          internalCost: "1.500000"
        },
        {
          organizationId: "org-1",
          scopeType: "department",
          scopeId: "dept-rd",
          model: "gpt-5.4",
          featureType: "chat",
          requestCount: 2,
          successCount: 2,
          failureCount: 0,
          inputTokens: 80,
          cachedInputTokens: 30,
          outputTokens: 10,
          estimatedCost: "1.000000",
          internalCost: "1.500000"
        }
      ]
    });

    const result = await service.evaluate({
      organizationId: "org-1",
      departmentId: "dept-rd",
      rollupDate: "2026-03-30",
      model: "gpt-5.4",
      featureType: "chat"
    });

    expect(result.decision).toBe("allow");
    expect(result.evaluatedPolicies).toHaveLength(1);
    expect(result.evaluatedPolicies[0]?.policy.scopeType).toBe("department");
    expect(result.evaluatedPolicies[0]?.policy.metricType).toBe("request_count");
  });
});
