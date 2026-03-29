import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { QuotaPolicyRepository } from "./quota-policy-repository.js";

describe("QuotaPolicyRepository", () => {
  it("upserts quota policies and lists active policies", async () => {
    const repository = new QuotaPolicyRepository(new FakeOperationsDb() as never);

    await repository.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "10",
      enforcementMode: "soft_block"
    });

    await repository.upsert({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "5",
      enforcementMode: "soft_block"
    });

    const rows = await repository.list({
      organizationId: "org-1",
      scopeType: "department"
    });

    expect(rows).toHaveLength(1);
    expect(rows[0]?.scopeId).toBe("dept-rd");
    expect(rows[0]?.thresholdValue).toBe("5.000000");
  });

  it("treats omitted scope fields as exact null matches when upserting", async () => {
    const repository = new QuotaPolicyRepository(new FakeOperationsDb() as never);

    const first = await repository.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "10"
    });
    const second = await repository.upsert({
      organizationId: "org-1",
      scopeType: "platform",
      scopeId: "platform",
      featureType: "chat",
      metricType: "request_count",
      windowType: "daily",
      thresholdValue: "20"
    });

    expect(first.id).not.toBe(second.id);
    expect(second.featureType).toBe("chat");
  });
});
