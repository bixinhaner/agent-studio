import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { AlertEventRepository } from "../persistence/alert-event-repository.js";
import { AlertRuleRepository } from "../persistence/alert-rule-repository.js";
import { AlertEvaluationService } from "./alert-evaluation-service.js";

describe("AlertEvaluationService", () => {
  it("creates a quota alert event when a soft-block threshold is exceeded", async () => {
    const db = new FakeOperationsDb();
    const rules = new AlertRuleRepository(db as never);
    await rules.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "quota_threshold",
      name: "Department quota soft-block",
      conditions: { metricType: "internal_cost" },
      channels: ["in_app"]
    });
    const service = new AlertEvaluationService({
      alertRules: rules,
      alertEvents: new AlertEventRepository(db as never)
    });

    const created = await service.evaluateQuotaResult({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      metricType: "internal_cost",
      triggeredValue: "120.00",
      thresholdValue: "100.00"
    });

    expect(created).toEqual(
      expect.objectContaining({
        severity: "warning",
        status: "open",
        scopeType: "department",
        scopeId: "dept-rd"
      })
    );
  });

  it("does not create alerts when no matching rule exists", async () => {
    const db = new FakeOperationsDb();
    const service = new AlertEvaluationService({
      alertRules: new AlertRuleRepository(db as never),
      alertEvents: new AlertEventRepository(db as never)
    });

    const quota = await service.evaluateQuotaResult({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      metricType: "internal_cost",
      triggeredValue: "120.00",
      thresholdValue: "100.00"
    });

    const security = await service.evaluateSecurityEvent({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      resourceType: "knowledge_set",
      resourceId: "ks-faq",
      actionType: "mount",
      resultStatus: "denied",
      userId: "user-1"
    });

    expect(quota).toBeUndefined();
    expect(security).toBeUndefined();
  });

  it("creates a warning for a single denied access and a critical alert only after repeated denials reach the threshold", async () => {
    const db = new FakeOperationsDb();
    const rules = new AlertRuleRepository(db as never);
    await rules.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "security_event",
      name: "Denied access alert",
      conditions: { actionType: "mount", resourceType: "knowledge_set" },
      channels: ["in_app"]
    });
    await rules.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      ruleType: "security_event",
      name: "Repeated denial alert",
      conditions: {},
      channels: ["in_app"]
    });
    const service = new AlertEvaluationService({
      alertRules: rules,
      alertEvents: new AlertEventRepository(db as never)
    });

    const denied = await service.evaluateSecurityEvent({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      resourceType: "knowledge_set",
      resourceId: "ks-faq",
      actionType: "mount",
      resultStatus: "denied",
      userId: "user-1",
      denialPattern: {
        deniedCount: 2,
        thresholdCount: 3
      }
    });

    const repeated = await service.evaluateSecurityEvent({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      denialPattern: {
        deniedCount: 3,
        thresholdCount: 3
      },
      userId: "user-1"
    });

    expect(denied).toEqual(expect.objectContaining({ severity: "warning", status: "open" }));
    expect(repeated).toEqual(expect.objectContaining({ severity: "critical", status: "open" }));
  });
});
