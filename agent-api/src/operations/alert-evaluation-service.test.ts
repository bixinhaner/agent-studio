import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "../persistence/operations-test-helpers.js";
import { AlertEventRepository } from "../persistence/alert-event-repository.js";
import { AlertRuleRepository } from "../persistence/alert-rule-repository.js";
import { AlertEvaluationService } from "./alert-evaluation-service.js";

describe("AlertEvaluationService", () => {
  it("creates a quota alert event when a soft-block threshold is exceeded", async () => {
    const service = new AlertEvaluationService({
      alertRules: new AlertRuleRepository(new FakeOperationsDb() as never),
      alertEvents: new AlertEventRepository(new FakeOperationsDb() as never)
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

  it("creates a security alert event for denied access and repeated permission denials", async () => {
    const service = new AlertEvaluationService({
      alertRules: new AlertRuleRepository(new FakeOperationsDb() as never),
      alertEvents: new AlertEventRepository(new FakeOperationsDb() as never)
    });

    const denied = await service.evaluateSecurityEvent({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      resourceType: "knowledge_set",
      resourceId: "ks-faq",
      actionType: "mount",
      resultStatus: "denied",
      userId: "user-1"
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
