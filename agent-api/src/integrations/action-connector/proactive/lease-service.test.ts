import { describe, expect, it, vi } from "vitest";

import { ProactiveLeaseService } from "./lease-service.js";

describe("ProactiveLeaseService", () => {
  it("issues an independent token for every tool invocation in a batch", async () => {
    let query = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        query += 1;
        if (query === 1) return [{ id: "invocation-1" }, { id: "invocation-2" }];
        const id = `invocation-${query - 1}`;
        return [{
          id, run_id: "run-1", scenario_key: "task-failure-analysis",
          package_digest: "sha256:package", handbook_digest: "sha256:handbook",
          operation_id: "getTask", method: "GET", path: `/api/v1/tasks/${id}`,
          arguments: {}, resource_scope: {}, lease_expires_at: new Date(),
          deadline_at: new Date(), trace_id: "trace-1"
        }];
      })
    };
    const db = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };

    const items = await new ProactiveLeaseService(db as never).leaseTools("connector-1", "worker-1", 8, 60);

    expect(items).toHaveLength(2);
    expect(items[0]?.leaseToken).toBeTruthy();
    expect(items[0]?.leaseToken).not.toBe(items[1]?.leaseToken);
  });

  it("issues an independent token for every finding delivery in a batch", async () => {
    let query = 0;
    let finding = 0;
    const tx = {
      $queryRaw: vi.fn(async () => {
        query += 1;
        return query === 1 ? [{ id: "delivery-1" }, { id: "delivery-2" }] : [{ id: `delivery-${query - 1}` }];
      }),
      proactiveFindingDelivery: {
        findUnique: vi.fn(async () => {
          finding += 1;
          return {
            id: `delivery-${finding}`, leaseExpiresAt: new Date(),
            finding: {
              id: `finding-${finding}`, runId: "run-1", scenarioKey: "task-failure-analysis",
              scenarioVersion: 1, packageDigest: "sha256:package", handbookDigest: "sha256:handbook",
              title: "Task failed", summary: "A task failed", severity: "high", confidence: 0.9,
              resourceRefs: [], facts: [], hypotheses: [], details: {}, suggestedActions: [], presentation: {},
              expiresAt: null
            }
          };
        })
      }
    };
    const db = { $transaction: (callback: (client: typeof tx) => unknown) => callback(tx) };

    const items = await new ProactiveLeaseService(db as never).leaseFindings("connector-1", "worker-1", 8, 60);

    expect(items).toHaveLength(2);
    expect(items[0]?.leaseToken).toBeTruthy();
    expect(items[0]?.leaseToken).not.toBe(items[1]?.leaseToken);
  });
});
