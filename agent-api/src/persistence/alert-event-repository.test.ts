import { describe, expect, it } from "vitest";

import { FakeOperationsDb } from "./operations-test-helpers.js";
import { AlertEventRepository } from "./alert-event-repository.js";

describe("AlertEventRepository", () => {
  it("creates alert events and lists newest first", async () => {
    const repository = new AlertEventRepository(new FakeOperationsDb() as never);

    await repository.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "warning",
      status: "open",
      title: "Quota threshold exceeded",
      detail: "Internal cost reached 120.000000 against 100.000000",
      payload: { metricType: "internal_cost" }
    });
    await repository.create({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      severity: "warning",
      status: "open",
      title: "Quota threshold exceeded",
      detail: "Internal cost reached 140.000000 against 100.000000",
      payload: { metricType: "internal_cost" }
    });

    const rows = await repository.list({
      organizationId: "org-1",
      scopeType: "department",
      scopeId: "dept-rd",
      status: "open"
    });

    expect(rows).toHaveLength(2);
    expect(rows[0]?.detail).toContain("140.000000");
  });
});
