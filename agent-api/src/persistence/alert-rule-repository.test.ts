import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { AlertRuleRepository } from "./alert-rule-repository.js";

describe("AlertRuleRepository", () => {
  it("creates and lists active alert rules for a scope", async () => {
    const repository = new AlertRuleRepository(new FakeOperationsDb() as never);

    await repository.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "quota",
      name: "Department internal cost warning",
      description: "Warn when internal cost soft-blocks",
      conditions: { metricType: "internal_cost", thresholdValue: "100.000000" },
      channels: ["in_app", "dingtalk"]
    });

    const rules = await repository.list({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "quota",
      isActive: true
    });

    expect(rules).toHaveLength(1);
    expect(rules[0]).toEqual(
      expect.objectContaining({
        scopeId: "dept-rd",
        ruleType: "quota",
        channels: ["in_app", "dingtalk"]
      })
    );
  });
});
