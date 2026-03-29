import { describe, expect, it } from "vitest";

import { DingTalkOrgProvider, type NormalizedOrgSnapshot } from "./dingtalk-org-provider.js";
import { DepartmentMembershipRepository } from "../persistence/department-membership-repository.js";
import { DepartmentRepository } from "../persistence/department-repository.js";
import { SyncJobRepository } from "../persistence/sync-job-repository.js";
import { UserRepository } from "../persistence/user-repository.js";
import { OrgSyncService } from "./org-sync-service.js";

function clone<T>(value: T): T {
  return structuredClone(value);
}

type FakeUserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  status: string | null;
  statusSource: string | null;
  syncState: string | null;
  manualDisabled: boolean;
  adminNote: string | null;
  lastSyncedAt: Date | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeDepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

type FakeMembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary: boolean;
  source: string;
  lastSyncedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

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

type FakeSyncEventRow = {
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

type FakeDbSeed = {
  users?: FakeUserRow[];
  departments?: FakeDepartmentRow[];
  memberships?: FakeMembershipRow[];
  jobs?: FakeSyncJobRow[];
  events?: FakeSyncEventRow[];
  snapshots?: FakeSyncSnapshotRow[];
  diffs?: FakeSyncDiffRow[];
};

class FakeOrgSyncDb {
  private userCounter = 0;
  private departmentCounter = 0;
  private membershipCounter = 0;
  private jobCounter = 0;
  private eventCounter = 0;
  private snapshotCounter = 0;
  private diffCounter = 0;

  constructor(
    readonly users: FakeUserRow[] = [],
    readonly departments: FakeDepartmentRow[] = [],
    readonly memberships: FakeMembershipRow[] = [],
    readonly jobs: FakeSyncJobRow[] = [],
    readonly events: FakeSyncEventRow[] = [],
    readonly snapshots: FakeSyncSnapshotRow[] = [],
    readonly diffs: FakeSyncDiffRow[] = []
  ) {}

  static fromSeed(seed: FakeDbSeed = {}): FakeOrgSyncDb {
    return new FakeOrgSyncDb(
      seed.users ? clone(seed.users) : [],
      seed.departments ? clone(seed.departments) : [],
      seed.memberships ? clone(seed.memberships) : [],
      seed.jobs ? clone(seed.jobs) : [],
      seed.events ? clone(seed.events) : [],
      seed.snapshots ? clone(seed.snapshots) : [],
      seed.diffs ? clone(seed.diffs) : []
    );
  }

  readonly user = {
    count: async () => this.users.length,
    findUnique: async ({ where }: { where: { id?: string; externalId?: string; email?: string; dingtalkUserId?: string } }) => {
      const row = this.users.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        if (where.email) return item.email === where.email;
        if (where.dingtalkUserId) return item.dingtalkUserId === where.dingtalkUserId;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async ({ where }: { where?: { status?: string; role?: string } } = {}) => {
      const rows = this.users.filter((item) => {
        if (where?.status && item.status !== where.status) return false;
        if (where?.role && item.role !== where.role) return false;
        return true;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeUserRow = {
        id: typeof data.id === "string" ? data.id : `user-${++this.userCounter}`,
        externalId: typeof data.externalId === "string" ? data.externalId : null,
        email: typeof data.email === "string" ? data.email : null,
        displayName: typeof data.displayName === "string" ? data.displayName : null,
        role: typeof data.role === "string" ? data.role : null,
        status: typeof data.status === "string" ? data.status : null,
        statusSource: typeof data.statusSource === "string" ? data.statusSource : null,
        syncState: typeof data.syncState === "string" ? data.syncState : null,
        manualDisabled: typeof data.manualDisabled === "boolean" ? data.manualDisabled : false,
        adminNote: typeof data.adminNote === "string" ? data.adminNote : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        dingtalkOpenId: typeof data.dingtalkOpenId === "string" ? data.dingtalkOpenId : null,
        dingtalkUserId: typeof data.dingtalkUserId === "string" ? data.dingtalkUserId : null,
        dingtalkCorpId: typeof data.dingtalkCorpId === "string" ? data.dingtalkCorpId : null,
        createdAt: now,
        updatedAt: now
      };
      this.users.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.users.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("user not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = new Date();
      return clone(row);
    }
  };

  readonly department = {
    findUnique: async ({ where }: { where: { id?: string; externalId?: string } }) => {
      const row = this.departments.find((item) => {
        if (where.id) return item.id === where.id;
        if (where.externalId) return item.externalId === where.externalId;
        return false;
      });
      return row ? clone(row) : null;
    },
    findMany: async () => clone(this.departments),
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeDepartmentRow = {
        id: typeof data.id === "string" ? data.id : `department-${++this.departmentCounter}`,
        organizationId: typeof data.organizationId === "string" ? data.organizationId : null,
        externalId: typeof data.externalId === "string" ? data.externalId : "",
        name: typeof data.name === "string" ? data.name : "",
        parentDepartmentId: typeof data.parentDepartmentId === "string" ? data.parentDepartmentId : null,
        sortOrder: typeof data.sortOrder === "number" ? data.sortOrder : 0,
        status: typeof data.status === "string" ? data.status : null,
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: now,
        updatedAt: now
      };
      this.departments.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.departments.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("department not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = new Date();
      return clone(row);
    }
  };

  readonly departmentMembership = {
    findMany: async ({
      where
    }: {
      where: { userId?: string; departmentId?: { in: string[] } };
    }) => {
      return clone(
        this.memberships.filter((item) => {
          if (where.userId && item.userId !== where.userId) return false;
          if (where.departmentId?.in && !where.departmentId.in.includes(item.departmentId)) return false;
          return true;
        })
      );
    },
    deleteMany: async ({
      where
    }: {
      where: { userId: string; source?: string; departmentId?: { in: string[] } };
    }) => {
      const before = this.memberships.length;
      this.memberships.splice(
        0,
        this.memberships.length,
        ...this.memberships.filter((item) => {
          if (item.userId !== where.userId) return true;
          if (where.source && item.source !== where.source) return true;
          if (where.departmentId?.in && !where.departmentId.in.includes(item.departmentId)) return true;
          return false;
        })
      );
      return { count: before - this.memberships.length };
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const now = new Date();
      const row: FakeMembershipRow = {
        id: typeof data.id === "string" ? data.id : `membership-${++this.membershipCounter}`,
        userId: typeof data.userId === "string" ? data.userId : "",
        departmentId: typeof data.departmentId === "string" ? data.departmentId : "",
        isPrimary: typeof data.isPrimary === "boolean" ? data.isPrimary : false,
        source: typeof data.source === "string" ? data.source : "sync",
        lastSyncedAt: data.lastSyncedAt instanceof Date ? data.lastSyncedAt : null,
        createdAt: now,
        updatedAt: now
      };
      this.memberships.push(row);
      return clone(row);
    },
    update: async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
      const row = this.memberships.find((item) => item.id === where.id);
      if (!row) {
        throw new Error("membership not found");
      }
      Object.assign(row, clone(data));
      row.updatedAt = new Date();
      return clone(row);
    }
  };

  readonly syncJob = {
    findUnique: async ({ where }: { where: { id: string } }) => {
      const row = this.jobs.find((item) => item.id === where.id);
      return row ? clone(row) : null;
    },
    findMany: async ({ where, orderBy, take }: { where?: { status?: string; scopeType?: string; scopeExternalId?: string | null }; orderBy?: { createdAt?: "asc" | "desc" }; take?: number } = {}) => {
      const rows = this.jobs.filter((item) => {
        if (where?.status && item.status !== where.status) return false;
        if (where?.scopeType && item.scopeType !== where.scopeType) return false;
        if (where && Object.prototype.hasOwnProperty.call(where, "scopeExternalId") && item.scopeExternalId !== where.scopeExternalId) return false;
        return true;
      });
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
    findMany: async ({ where, orderBy }: { where: { syncJobId: string }; orderBy?: { createdAt?: "asc" | "desc" } }) => {
      const rows = this.events.filter((item) => item.syncJobId === where.syncJobId);
      rows.sort((left, right) => {
        const diff = left.createdAt.getTime() - right.createdAt.getTime();
        return orderBy?.createdAt === "desc" ? -diff : diff;
      });
      return clone(rows);
    },
    create: async ({ data }: { data: Record<string, unknown> }) => {
      const row: FakeSyncEventRow = {
        id: typeof data.id === "string" ? data.id : `sync-event-${++this.eventCounter}`,
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
      this.snapshots.splice(
        0,
        this.snapshots.length,
        ...this.snapshots.filter((item) => item.syncJobId !== where.syncJobId)
      );
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

  async $transaction<T>(callback: (tx: FakeOrgSyncDb) => Promise<T>): Promise<T> {
    return callback(this);
  }
}

class FakeDingTalkOrgProvider {
  constructor(
    private readonly snapshots: {
      full?: NormalizedOrgSnapshot;
      department?: NormalizedOrgSnapshot;
      user?: NormalizedOrgSnapshot;
    }
  ) {}

  async fetchFullOrganization(): Promise<NormalizedOrgSnapshot> {
    return clone(this.snapshots.full ?? { departments: [], users: [] });
  }

  async fetchDepartmentScope(): Promise<NormalizedOrgSnapshot> {
    return clone(this.snapshots.department ?? { departments: [], users: [] });
  }

  async fetchUserScope(): Promise<NormalizedOrgSnapshot> {
    return clone(this.snapshots.user ?? { departments: [], users: [] });
  }
}

function buildRepositories(seed: FakeDbSeed, providerSnapshots: {
  full?: NormalizedOrgSnapshot;
  department?: NormalizedOrgSnapshot;
  user?: NormalizedOrgSnapshot;
}) {
  const db = FakeOrgSyncDb.fromSeed(seed);
  return {
    db,
    provider: new FakeDingTalkOrgProvider(providerSnapshots),
    departments: new DepartmentRepository(db as never),
    memberships: new DepartmentMembershipRepository(db as never),
    jobs: new SyncJobRepository(db as never),
    users: new UserRepository(db as never)
  };
}

function makeDepartment(id: string, externalId: string, name: string, parentDepartmentId: string | null = null): FakeDepartmentRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id,
    organizationId: null,
    externalId,
    name,
    parentDepartmentId,
    sortOrder: 0,
    status: "active",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

function makeUser(input: {
  id: string;
  externalId: string | null;
  displayName: string;
  status?: string;
  statusSource?: string;
  syncState?: string;
  manualDisabled?: boolean;
  lastSyncedAt?: Date | null;
  dingtalkUserId?: string | null;
  dingtalkOpenId?: string | null;
}): FakeUserRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id: input.id,
    externalId: input.externalId,
    email: null,
    displayName: input.displayName,
    role: "employee",
    status: input.status ?? "active",
    statusSource: input.statusSource ?? "sync",
    syncState: input.syncState ?? "active",
    manualDisabled: input.manualDisabled ?? false,
    adminNote: null,
    lastSyncedAt: input.lastSyncedAt ?? null,
    dingtalkOpenId: input.dingtalkOpenId ?? null,
    dingtalkUserId: input.dingtalkUserId ?? null,
    dingtalkCorpId: null,
    createdAt: now,
    updatedAt: now
  };
}

function makeMembership(input: {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary?: boolean;
  source?: string;
}): FakeMembershipRow {
  const now = new Date("2026-03-29T00:00:00.000Z");
  return {
    id: input.id,
    userId: input.userId,
    departmentId: input.departmentId,
    isPrimary: input.isPrimary ?? false,
    source: input.source ?? "sync",
    lastSyncedAt: null,
    createdAt: now,
    updatedAt: now
  };
}

describe("OrgSyncService", () => {
  it("creates departments, users, memberships, snapshots, and diffs during a full sync", async () => {
    const repositories = buildRepositories(
      {
        departments: [
          makeDepartment("department-root", "root", "旧总部"),
          makeDepartment("department-rd", "rd", "旧研发", "department-root")
        ],
        users: [
          makeUser({
            id: "user-u1",
            externalId: "union-1",
            displayName: "旧 Alice",
            dingtalkUserId: "ding-u1"
          }),
          makeUser({
            id: "user-u2",
            externalId: "union-2",
            displayName: "旧 Bob",
            status: "disabled",
            statusSource: "sync",
            syncState: "disabled",
            dingtalkUserId: "ding-u2"
          })
        ],
        memberships: [
          makeMembership({ id: "membership-1", userId: "user-u1", departmentId: "department-root", isPrimary: true })
        ]
      },
      {
        full: {
          departments: [
            { externalId: "root", name: "总部", parentExternalId: null, sortOrder: 10 },
            { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20 }
          ],
          users: [
            {
              userId: "ding-u1",
              unionId: "union-1",
              displayName: "Alice",
              departmentExternalIds: ["root", "rd"],
              primaryDepartmentExternalId: "root",
              lifecycleState: "active"
            },
            {
              userId: "ding-u2",
              unionId: "union-2",
              displayName: "Bob",
              departmentExternalIds: ["rd"],
              lifecycleState: "disabled"
            },
            {
              userId: "ding-u3",
              unionId: "union-3",
              displayName: "Carol",
              departmentExternalIds: ["rd"],
              primaryDepartmentExternalId: "rd",
              lifecycleState: "active"
            }
          ]
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "full",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    expect(await repositories.departments.listTree()).toMatchObject([
      {
        externalId: "root",
        children: [
          {
            externalId: "rd",
            children: []
          }
        ]
      }
    ]);
    expect(await repositories.jobs.listRecent()).toHaveLength(1);

    const detail = await repositories.jobs.getDetail(result.jobId);
    expect(detail?.snapshots.map((snapshot) => snapshot.entityType)).toEqual([
      "department",
      "user",
      "membership"
    ]);
    expect(detail?.diffs.length).toBeGreaterThan(0);
    expect(detail?.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "membership",
          entityExternalId: "union-3",
          changeType: "created",
          afterPayload: {
            userId: "union-3",
            departmentExternalIds: ["rd"],
            primaryDepartmentExternalId: "rd"
          }
        })
      ])
    );
    expect(detail?.events.map((event) => event.eventType)).toEqual([
      "remote_fetch_started",
      "remote_fetch_completed",
      "diff_summary",
      "persistence_completed"
    ]);

    const updatedUser = repositories.db.users.find((row) => row.id === "user-u1");
    expect(updatedUser).toMatchObject({
      displayName: "Alice",
      status: "active",
      statusSource: "sync",
      syncState: "active",
      manualDisabled: false
    });

    const memberships = await repositories.memberships.listForUser("user-u1");
    expect(memberships).toEqual([
      { departmentId: "department-root", isPrimary: true },
      { departmentId: "department-rd", isPrimary: false }
    ]);
  });

  it("syncs only the selected department subtree and its users", async () => {
    const repositories = buildRepositories(
      {
        departments: [
          makeDepartment("department-root", "root", "总部"),
          makeDepartment("department-rd", "rd", "旧研发", "department-root"),
          makeDepartment("department-sales", "sales", "旧销售", "department-root")
        ],
        users: [
          makeUser({
            id: "user-u2",
            externalId: "union-2",
            displayName: "旧 Bob",
            dingtalkUserId: "ding-u2"
          })
        ],
        memberships: [
          makeMembership({ id: "membership-1", userId: "user-u2", departmentId: "department-sales", isPrimary: true })
        ]
      },
      {
        department: {
          departments: [
            { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20 },
            { externalId: "platform", name: "平台", parentExternalId: "rd", sortOrder: 30 }
          ],
          users: [
            {
              userId: "ding-u2",
              unionId: "union-2",
              displayName: "Bob",
              departmentExternalIds: ["rd", "platform"],
              primaryDepartmentExternalId: "rd",
              lifecycleState: "active"
            }
          ]
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "department",
      scopeExternalId: "rd",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    expect((await repositories.departments.getByExternalId("sales"))?.name).toBe("旧销售");
    expect((await repositories.departments.getByExternalId("rd"))?.name).toBe("研发");
    const detail = await repositories.jobs.getDetail(result.jobId);
    expect(detail?.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "membership",
          entityExternalId: "union-2",
          changeType: "primary_changed",
          afterPayload: {
            userId: "union-2",
            memberships: [
              { departmentId: "platform", isPrimary: false },
              { departmentId: "rd", isPrimary: true },
              { departmentId: "sales", isPrimary: false }
            ]
          }
        })
      ])
    );
    expect((await repositories.memberships.listForUser("user-u2"))).toEqual([
      { departmentId: "department-sales", isPrimary: false },
      { departmentId: "department-rd", isPrimary: true },
      { departmentId: "department-1", isPrimary: false }
    ]);
  });

  it("removes stale scoped sync memberships for users omitted from a department snapshot", async () => {
    const repositories = buildRepositories(
      {
        departments: [
          makeDepartment("department-root", "root", "总部"),
          makeDepartment("department-rd", "rd", "研发", "department-root"),
          makeDepartment("department-sales", "sales", "销售", "department-root")
        ],
        users: [
          makeUser({
            id: "user-u2",
            externalId: "union-2",
            displayName: "Bob",
            dingtalkUserId: "ding-u2"
          })
        ],
        memberships: [
          makeMembership({ id: "membership-rd", userId: "user-u2", departmentId: "department-rd", isPrimary: true }),
          makeMembership({ id: "membership-sales", userId: "user-u2", departmentId: "department-sales", isPrimary: false })
        ]
      },
      {
        department: {
          departments: [{ externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20 }],
          users: []
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "department",
      scopeExternalId: "rd",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    expect(await repositories.memberships.listForUser("user-u2")).toEqual([
      { departmentId: "department-sales", isPrimary: false }
    ]);

    const detail = await repositories.jobs.getDetail(result.jobId);
    expect(detail?.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "membership",
          entityExternalId: "union-2",
          changeType: "primary_changed",
          afterPayload: {
            userId: "union-2",
            memberships: [{ departmentId: "sales", isPrimary: false }]
          }
        })
      ])
    );
  });

  it("preserves manual scoped memberships in department diff targets", async () => {
    const repositories = buildRepositories(
      {
        departments: [
          makeDepartment("department-root", "root", "总部"),
          makeDepartment("department-rd", "rd", "研发", "department-root"),
          makeDepartment("department-sales", "sales", "销售", "department-root")
        ],
        users: [
          makeUser({
            id: "user-u2",
            externalId: "union-2",
            displayName: "Bob",
            dingtalkUserId: "ding-u2"
          })
        ],
        memberships: [
          makeMembership({ id: "membership-rd-manual", userId: "user-u2", departmentId: "department-rd", isPrimary: false, source: "manual" }),
          makeMembership({ id: "membership-sales-sync", userId: "user-u2", departmentId: "department-sales", isPrimary: true })
        ]
      },
      {
        department: {
          departments: [
            { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20 },
            { externalId: "platform", name: "平台", parentExternalId: "rd", sortOrder: 30 }
          ],
          users: [
            {
              userId: "ding-u2",
              unionId: "union-2",
              displayName: "Bob",
              departmentExternalIds: ["rd", "platform"],
              primaryDepartmentExternalId: "rd",
              lifecycleState: "active"
            }
          ]
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "department",
      scopeExternalId: "rd",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    const detail = await repositories.jobs.getDetail(result.jobId);
    expect(detail?.diffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          entityType: "membership",
          entityExternalId: "union-2",
          afterPayload: {
            userId: "union-2",
            memberships: [
              { departmentId: "platform", isPrimary: false },
              { departmentId: "rd", isPrimary: true },
              { departmentId: "sales", isPrimary: false }
            ]
          }
        })
      ])
    );
  });

  it("preserves manual disables when DingTalk later reports the user active", async () => {
    const repositories = buildRepositories(
      {
        users: [
          makeUser({
            id: "user-u1",
            externalId: "union-1",
            displayName: "Alice",
            status: "disabled",
            statusSource: "manual_disable",
            syncState: "active",
            manualDisabled: true,
            dingtalkUserId: "ding-u1"
          })
        ],
        departments: [makeDepartment("department-root", "root", "总部")]
      },
      {
        user: {
          departments: [
            { externalId: "root", name: "总部", parentExternalId: null, sortOrder: 10 }
          ],
          users: [
            {
              userId: "ding-u1",
              unionId: "union-1",
              displayName: "Alice",
              departmentExternalIds: ["root"],
              primaryDepartmentExternalId: "root",
              lifecycleState: "active"
            }
          ]
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "user",
      scopeExternalId: "ding-u1",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    expect(repositories.db.users[0]).toMatchObject({
      manualDisabled: true,
      status: "disabled",
      statusSource: "manual_disable",
      syncState: "active"
    });
  });

  it("blocks overlapping runs while any org sync job is running", async () => {
    const repositories = buildRepositories(
      {
        jobs: [
          {
            id: "job-1",
            organizationId: null,
            provider: "dingtalk",
            scopeType: "full",
            scopeExternalId: null,
            status: "running",
            triggerType: "manual",
            triggeredByUserId: "admin-1",
            startedAt: new Date("2026-03-29T00:00:00.000Z"),
            finishedAt: null,
            summary: null,
            createdAt: new Date("2026-03-29T00:00:00.000Z"),
            updatedAt: new Date("2026-03-29T00:00:00.000Z")
          }
        ]
      },
      {
        department: {
          departments: [
            { externalId: "rd", name: "研发", parentExternalId: "root", sortOrder: 20 }
          ],
          users: []
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    await expect(
      service.run({
        scopeType: "department",
        scopeExternalId: "rd",
        triggerType: "manual",
        triggeredByUserId: "admin-1"
      })
    ).rejects.toThrow(/already running/i);
  });

  it("ignores stale pending jobs from a previous crashed run", async () => {
    const repositories = buildRepositories(
      {
        jobs: [
          {
            id: "job-1",
            organizationId: null,
            provider: "dingtalk",
            scopeType: "full",
            scopeExternalId: null,
            status: "pending",
            triggerType: "manual",
            triggeredByUserId: "admin-1",
            startedAt: null,
            finishedAt: null,
            summary: null,
            createdAt: new Date("2026-03-29T00:00:00.000Z"),
            updatedAt: new Date("2026-03-29T00:00:00.000Z")
          }
        ]
      },
      {
        full: {
          departments: [],
          users: []
        }
      }
    );
    const service = new OrgSyncService({
      provider: repositories.provider as never,
      departments: repositories.departments,
      users: repositories.users,
      memberships: repositories.memberships,
      jobs: repositories.jobs
    });

    const result = await service.run({
      scopeType: "full",
      triggerType: "manual",
      triggeredByUserId: "admin-1"
    });

    expect(result.status).toBe("succeeded");
    expect(repositories.db.jobs.find((job) => job.id === "job-1")).toMatchObject({
      status: "failed",
      summary: {
        detail: "Recovered stale pending org sync job after interrupted startup"
      }
    });
  });
});
