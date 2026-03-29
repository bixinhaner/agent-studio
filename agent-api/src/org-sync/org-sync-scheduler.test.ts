import { describe, expect, it } from "vitest";

import { DepartmentMembershipRepository } from "../persistence/department-membership-repository.js";
import { DepartmentRepository } from "../persistence/department-repository.js";
import { SyncJobRepository } from "../persistence/sync-job-repository.js";
import { UserRepository } from "../persistence/user-repository.js";
import { OrgSyncScheduler } from "./org-sync-scheduler.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeSyncJobRow = {
  id: string;
  organizationId: string | null;
  provider: string;
  scopeType: string;
  scopeExternalId: string | null;
  status: string;
  triggerType: string;
  triggeredByUserId: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  summary: unknown;
  createdAt: Date;
  updatedAt: Date;
};

class FakeSyncJobDb {
  constructor(readonly jobs: FakeSyncJobRow[] = []) {}

  readonly syncJob = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      return row ? clone(row) : null;
    },
    findMany: async ({ where }: { where?: { status?: string; scopeType?: string; scopeExternalId?: string | null } } = {}) => {
      return clone(
        this.jobs.filter((item) => {
          if (where?.status && item.status !== where.status) return false;
          if (where?.scopeType && item.scopeType !== where.scopeType) return false;
          if (where && Object.prototype.hasOwnProperty.call(where, "scopeExternalId") && item.scopeExternalId !== where.scopeExternalId) return false;
          return true;
        })
      );
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSyncJobRow = {
        id: typeof data.id === "string" ? data.id : `job-${this.jobs.length + 1}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        provider: typeof data.provider === "string" ? data.provider : "dingtalk",
        scopeType: typeof data.scopeType === "string" ? data.scopeType : "",
        scopeExternalId: typeof data.scopeExternalId === "string" ? data.scopeExternalId : null,
        status: typeof data.status === "string" ? data.status : "pending",
        triggerType: typeof data.triggerType === "string" ? data.triggerType : "",
        triggeredByUserId: typeof data.triggeredByUserId === "string" ? data.triggeredByUserId : null,
        startedAt: data.startedAt instanceof Date ? data.startedAt : null,
        finishedAt: data.finishedAt instanceof Date ? data.finishedAt : null,
        summary: data.summary,
        createdAt: now,
        updatedAt: now
      };
      this.jobs.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("sync job not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = new Date();
      return clone(row);
    }
  };

  readonly syncJobEvent = {
    findMany: async () => [],
    create: async () => {
      throw new Error("not used");
    }
  };

  readonly syncSnapshot = {
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    create: async () => {
      throw new Error("not used");
    }
  };

  readonly syncDiff = {
    findMany: async () => [],
    deleteMany: async () => ({ count: 0 }),
    create: async () => {
      throw new Error("not used");
    }
  };

  async $transaction<T>(callback: (tx: FakeSyncJobDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("OrgSyncScheduler", () => {
  it("starts on a daily interval when enabled and skips a tick while a full sync is already running", async () => {
    const timers: Array<() => unknown> = [];
    const clearCalls: unknown[] = [];
    const serviceRuns: Array<Record<string, unknown>> = [];
    const db = new FakeSyncJobDb([
      {
        id: "job-1",
        organizationId: null,
        provider: "dingtalk",
        scopeType: "full",
        scopeExternalId: null,
        status: "running",
        triggerType: "scheduled",
        triggeredByUserId: null,
        startedAt: new Date("2026-03-29T00:00:00.000Z"),
        finishedAt: null,
        summary: null,
        createdAt: new Date("2026-03-29T00:00:00.000Z"),
        updatedAt: new Date("2026-03-29T00:00:00.000Z")
      }
    ]);
    const scheduler = new OrgSyncScheduler(
      {
        run: async (input: Record<string, unknown>) => {
          serviceRuns.push(input);
          return { jobId: "job-2", status: "succeeded" as const };
        }
      },
      new SyncJobRepository(db as never),
      {
        enabled: true,
        intervalMinutes: 24 * 60,
        setIntervalFn: ((callback: () => unknown) => {
          timers.push(callback);
          return { unref() {} } as never;
        }) as never,
        clearIntervalFn: ((handle: unknown) => {
          clearCalls.push(handle);
        }) as never
      }
    );

    scheduler.start();
    expect(timers).toHaveLength(1);
    await timers[0]?.();
    expect(serviceRuns).toHaveLength(0);

    scheduler.stop();
    expect(clearCalls).toHaveLength(1);
  });

  it("does not start when disabled", () => {
    const timers: Array<() => unknown> = [];
    const scheduler = new OrgSyncScheduler(
      {
        run: async () => ({ jobId: "job-1", status: "succeeded" as const })
      },
      new SyncJobRepository(new FakeSyncJobDb() as never),
      {
        enabled: false,
        intervalMinutes: 60,
        setIntervalFn: ((callback: () => unknown) => {
          timers.push(callback);
          return { unref() {} } as never;
        }) as never
      }
    );

    scheduler.start();
    expect(timers).toHaveLength(0);
  });
});
