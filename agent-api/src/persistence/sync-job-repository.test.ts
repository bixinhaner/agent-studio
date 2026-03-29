import { describe, expect, it } from "vitest";

import { SyncJobRepository } from "./sync-job-repository.js";

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

type FakeSyncJobEventRow = {
  id: string;
  syncJobId: string;
  level: string;
  eventType: string;
  message: string;
  payload: unknown;
  createdAt: Date;
};

type FakeSyncSnapshotRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  scopeType: string;
  scopeExternalId: string | null;
  snapshotPayload: unknown;
  createdAt: Date;
};

type FakeSyncDiffRow = {
  id: string;
  syncJobId: string;
  entityType: string;
  entityExternalId: string | null;
  changeType: string;
  beforePayload: unknown;
  afterPayload: unknown;
  createdAt: Date;
};

class FakeSyncJobDb {
  private jobCounter = 0;
  private eventCounter = 0;
  private snapshotCounter = 0;
  private diffCounter = 0;

  constructor(
    readonly jobs: FakeSyncJobRow[] = [],
    readonly events: FakeSyncJobEventRow[] = [],
    readonly snapshots: FakeSyncSnapshotRow[] = [],
    readonly diffs: FakeSyncDiffRow[] = []
  ) {}

  readonly syncJob = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      return row ? clone(row) : null;
    },
    findMany: async ({
      orderBy,
      take
    }: {
      orderBy?: { createdAt?: "asc" | "desc" };
      take?: number;
    } = {}) => {
      const rows = [...this.jobs];
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "asc" ? diff : -diff;
      });
      return clone(typeof take === "number" ? rows.slice(0, take) : rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeSyncJobRow = {
        id: typeof data.id === "string" ? data.id : `sync-job-${++this.jobCounter}`,
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
        createdAt: data.createdAt instanceof Date ? data.createdAt : now,
        updatedAt: data.updatedAt instanceof Date ? data.updatedAt : now
      };
      this.jobs.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      if (!row) throw new Error("sync job not found");
      Object.assign(row, clone(data));
      row.updatedAt = data.updatedAt instanceof Date ? data.updatedAt : new Date();
      return clone(row);
    }
  };

  readonly syncJobEvent = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.events.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeSyncJobEventRow = {
        id: typeof data.id === "string" ? data.id : `sync-job-event-${++this.eventCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        level: typeof data.level === "string" ? data.level : "",
        eventType: typeof data.eventType === "string" ? data.eventType : "",
        message: typeof data.message === "string" ? data.message : "",
        payload: data.payload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.events.push(row);
      return clone(row);
    }
  };

  readonly syncSnapshot = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.snapshots.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { syncJobId: string } }) => {
      const before = this.snapshots.length;
      this.snapshots.splice(0, this.snapshots.length, ...this.snapshots.filter((item) => item.syncJobId !== where.syncJobId));
      return { count: before - this.snapshots.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeSyncSnapshotRow = {
        id: typeof data.id === "string" ? data.id : `sync-snapshot-${++this.snapshotCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        entityType: typeof data.entityType === "string" ? data.entityType : "",
        scopeType: typeof data.scopeType === "string" ? data.scopeType : "",
        scopeExternalId: typeof data.scopeExternalId === "string" ? data.scopeExternalId : null,
        snapshotPayload: data.snapshotPayload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.snapshots.push(row);
      return clone(row);
    }
  };

  readonly syncDiff = {
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.diffs.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    deleteMany: async ({ where }: { where: { syncJobId: string } }) => {
      const before = this.diffs.length;
      this.diffs.splice(0, this.diffs.length, ...this.diffs.filter((item) => item.syncJobId !== where.syncJobId));
      return { count: before - this.diffs.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeSyncDiffRow = {
        id: typeof data.id === "string" ? data.id : `sync-diff-${++this.diffCounter}`,
        syncJobId: typeof data.syncJobId === "string" ? data.syncJobId : "",
        entityType: typeof data.entityType === "string" ? data.entityType : "",
        entityExternalId: typeof data.entityExternalId === "string" ? data.entityExternalId : null,
        changeType: typeof data.changeType === "string" ? data.changeType : "",
        beforePayload: data.beforePayload,
        afterPayload: data.afterPayload,
        createdAt: data.createdAt instanceof Date ? data.createdAt : new Date()
      };
      this.diffs.push(row);
      return clone(row);
    }
  };

  async $transaction<T>(callback: (tx: FakeSyncJobDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

describe("SyncJobRepository", () => {
  it("tracks job lifecycle, events, snapshots, and diffs in job detail", async () => {
    const repository = new SyncJobRepository(new FakeSyncJobDb() as never);

    const job = await repository.create({
      scopeType: "organization",
      scopeExternalId: "root",
      triggerType: "manual",
      triggeredByUserId: "user-1"
    });

    await repository.markRunning(job.id, new Date("2026-03-29T01:00:00.000Z"));
    await repository.appendEvent(job.id, {
      level: "info",
      eventType: "sync_started",
      message: "Sync started",
      payload: { batch: 1 }
    });
    await repository.replaceSnapshots(job.id, [
      {
        entityType: "department",
        scopeType: "organization",
        scopeExternalId: "root",
        snapshotPayload: { total: 2 }
      }
    ]);
    await repository.replaceDiffs(job.id, [
      {
        entityType: "user",
        entityExternalId: "ding-union-1",
        changeType: "updated",
        beforePayload: { status: "active" },
        afterPayload: { status: "disabled" }
      }
    ]);
    await repository.markSucceeded(job.id, { departments: 2, users: 1 });

    const detail = await repository.getDetail(job.id);
    expect(detail).toMatchObject({
      id: job.id,
      status: "succeeded",
      scopeType: "organization",
      scopeExternalId: "root",
      triggerType: "manual",
      triggeredByUserId: "user-1",
      summary: { departments: 2, users: 1 }
    });
    expect(detail?.events).toEqual([
      expect.objectContaining({
        level: "info",
        eventType: "sync_started",
        message: "Sync started",
        payload: { batch: 1 }
      })
    ]);
    expect(detail?.snapshots).toEqual([
      expect.objectContaining({
        entityType: "department",
        scopeType: "organization",
        scopeExternalId: "root",
        snapshotPayload: { total: 2 }
      })
    ]);
    expect(detail?.diffs).toEqual([
      expect.objectContaining({
        entityType: "user",
        entityExternalId: "ding-union-1",
        changeType: "updated",
        beforePayload: { status: "active" },
        afterPayload: { status: "disabled" }
      })
    ]);
  });

  it("marks failed jobs and lists recent jobs newest first", async () => {
    const db = new FakeSyncJobDb();
    const repository = new SyncJobRepository(db as never);

    const olderJob = await repository.create({
      scopeType: "organization",
      scopeExternalId: "root",
      triggerType: "manual",
      triggeredByUserId: null
    });
    db.jobs[0]!.createdAt = new Date("2026-03-29T00:00:00.000Z");

    const newerJob = await repository.create({
      scopeType: "department",
      scopeExternalId: "rd",
      triggerType: "schedule",
      triggeredByUserId: null
    });
    db.jobs[1]!.createdAt = new Date("2026-03-29T02:00:00.000Z");

    await repository.markFailed(newerJob.id, { reason: "timeout" });

    const recent = await repository.listRecent(1);
    expect(recent).toHaveLength(1);
    expect(recent[0]).toMatchObject({
      id: newerJob.id,
      status: "failed"
    });

    const detail = await repository.getDetail(newerJob.id);
    expect(detail).toMatchObject({
      id: newerJob.id,
      status: "failed",
      summary: { reason: "timeout" }
    });
    expect(olderJob.id).not.toBe(newerJob.id);
  });

  it("replaces prior snapshots and diffs instead of appending to them", async () => {
    const db = new FakeSyncJobDb();
    const repository = new SyncJobRepository(db as never);
    const job = await repository.create({
      scopeType: "organization",
      scopeExternalId: "root",
      triggerType: "manual",
      triggeredByUserId: null
    });

    await repository.replaceSnapshots(job.id, [
      {
        entityType: "department",
        scopeType: "organization",
        scopeExternalId: "root",
        snapshotPayload: { total: 1 }
      }
    ]);
    await repository.replaceDiffs(job.id, [
      {
        entityType: "user",
        entityExternalId: "user-1",
        changeType: "created",
        afterPayload: { role: "employee" }
      }
    ]);

    await repository.replaceSnapshots(job.id, [
      {
        entityType: "department",
        scopeType: "organization",
        scopeExternalId: "root",
        snapshotPayload: { total: 2 }
      }
    ]);
    await repository.replaceDiffs(job.id, [
      {
        entityType: "user",
        entityExternalId: "user-2",
        changeType: "updated",
        beforePayload: { role: "employee" },
        afterPayload: { role: "admin" }
      }
    ]);

    const detail = await repository.getDetail(job.id);
    expect(detail?.snapshots).toEqual([
      expect.objectContaining({
        entityType: "department",
        snapshotPayload: { total: 2 }
      })
    ]);
    expect(detail?.diffs).toEqual([
      expect.objectContaining({
        entityExternalId: "user-2",
        changeType: "updated",
        beforePayload: { role: "employee" },
        afterPayload: { role: "admin" }
      })
    ]);
    expect(db.snapshots).toHaveLength(1);
    expect(db.diffs).toHaveLength(1);
  });
});
