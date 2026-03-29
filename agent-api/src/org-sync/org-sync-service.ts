import type { DingTalkOrgProvider, NormalizedOrgSnapshot } from "./dingtalk-org-provider.js";
import { DepartmentMembershipRepository } from "../persistence/department-membership-repository.js";
import { DepartmentRepository } from "../persistence/department-repository.js";
import { SyncJobRepository } from "../persistence/sync-job-repository.js";
import { UserRepository } from "../persistence/user-repository.js";

type OrgSyncScopeType = "full" | "department" | "user";
type OrgSyncTriggerType = "manual" | "scheduled";
type OrgSyncStatus = "succeeded" | "failed";

export type OrgSyncRunInput = {
  scopeType: OrgSyncScopeType;
  scopeExternalId?: string;
  triggerType: OrgSyncTriggerType;
  triggeredByUserId?: string;
};

export type OrgSyncRunResult = {
  jobId: string;
  status: OrgSyncStatus;
};

type OrgSyncProvider = Pick<
  DingTalkOrgProvider,
  "fetchFullOrganization" | "fetchDepartmentScope" | "fetchUserScope"
>;

type OrgSyncDb = {
  user: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    create(args: { data: Record<string, unknown> }): Promise<Record<string, unknown>>;
    update(args: { where: Record<string, unknown>; data: Record<string, unknown> }): Promise<Record<string, unknown>>;
  };
  department: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
    findUnique(args: { where: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
  };
  departmentMembership: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
  };
  syncJob: {
    findMany(args?: { where?: Record<string, unknown> }): Promise<Array<Record<string, unknown>>>;
  };
};

type OrgSyncRepositories = {
  provider: OrgSyncProvider;
  departments: DepartmentRepository;
  users: UserRepository;
  memberships: DepartmentMembershipRepository;
  jobs: SyncJobRepository;
};

type DepartmentSnapshot = NormalizedOrgSnapshot["departments"][number];
type UserSnapshot = NormalizedOrgSnapshot["users"][number];

type UserRow = {
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
  lastSyncedAt: Date | string | null;
  dingtalkOpenId: string | null;
  dingtalkUserId: string | null;
  dingtalkCorpId: string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DepartmentRow = {
  id: string;
  organizationId: string | null;
  externalId: string;
  name: string;
  parentDepartmentId: string | null;
  sortOrder: number;
  status: string | null;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type MembershipRow = {
  id: string;
  userId: string;
  departmentId: string;
  isPrimary: boolean;
  source: string;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type DepartmentDiff = {
  entityType: "department";
  entityExternalId: string;
  changeType: "created" | "updated";
  beforePayload?: Record<string, unknown>;
  afterPayload?: Record<string, unknown>;
};

type UserDiff = {
  entityType: "user";
  entityExternalId: string;
  changeType: "created" | "updated" | "disabled" | "restored";
  beforePayload?: Record<string, unknown>;
  afterPayload?: Record<string, unknown>;
};

type MembershipDiff = {
  entityType: "membership";
  entityExternalId: string;
  changeType: "created" | "updated" | "removed" | "primary_changed";
  beforePayload?: Record<string, unknown>;
  afterPayload?: Record<string, unknown>;
};

type SyncDiff = DepartmentDiff | UserDiff | MembershipDiff;

const RUNNING_JOB_STATUSES = new Set(["pending", "running"]);

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  if (!value) return undefined;
  if (value instanceof Date) return value.toISOString();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed.toISOString();
}

function getDb(repository: { [key: string]: unknown }): OrgSyncDb {
  const db = (repository as { db?: OrgSyncDb }).db;
  if (!db) {
    throw new Error("repository db is unavailable");
  }
  return db;
}

function scopeKey(input: OrgSyncRunInput): string {
  return `${input.scopeType}:${trimOrUndefined(input.scopeExternalId) ?? ""}`;
}

function getSnapshotUserKey(user: UserSnapshot): string {
  return trimOrUndefined(user.unionId) ?? user.userId;
}

function normalizeDepartmentPayload(department: DepartmentSnapshot) {
  return {
    externalId: department.externalId,
    name: department.name,
    parentExternalId: department.parentExternalId ?? null,
    sortOrder: department.sortOrder,
    status: "active"
  };
}

function normalizeUserPayload(user: UserSnapshot) {
  return {
    userId: user.userId,
    unionId: user.unionId ?? null,
    openId: user.openId ?? null,
    corpId: user.corpId ?? null,
    displayName: user.displayName,
    email: user.email ?? null,
    departmentExternalIds: user.departmentExternalIds,
    primaryDepartmentExternalId: user.primaryDepartmentExternalId ?? null,
    lifecycleState: user.lifecycleState
  };
}

function normalizeMembershipPayload(input: {
  userId: string;
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
}) {
  return {
    userId: input.userId,
    departmentExternalIds: input.departmentExternalIds,
    primaryDepartmentExternalId: input.primaryDepartmentExternalId ?? null
  };
}

function compareRecords(before: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  return JSON.stringify(before ?? null) === JSON.stringify(after);
}

function compareDepartment(before: DepartmentRow | null | undefined, after: DepartmentSnapshot): DepartmentDiff | null {
  const beforePayload = before
    ? {
        externalId: before.externalId,
        name: before.name,
        parentExternalId: before.parentDepartmentId ?? null,
        sortOrder: before.sortOrder,
        status: before.status ?? "active"
      }
    : undefined;
  const afterPayload = normalizeDepartmentPayload(after);
  if (!before) {
    return {
      entityType: "department",
      entityExternalId: after.externalId,
      changeType: "created",
      afterPayload
    };
  }
  if (!compareRecords(beforePayload, afterPayload)) {
    return {
      entityType: "department",
      entityExternalId: after.externalId,
      changeType: "updated",
      beforePayload,
      afterPayload
    };
  }
  return null;
}

function compareUser(
  before: UserRow | null | undefined,
  after: UserSnapshot,
  resolvedStatus: string,
  resolvedStatusSource: string,
  resolvedSyncState: string
): UserDiff | null {
  const afterPayload = {
    userId: after.userId,
    unionId: after.unionId ?? null,
    openId: after.openId ?? null,
    corpId: after.corpId ?? null,
    displayName: after.displayName,
    email: after.email ?? null,
    status: resolvedStatus,
    statusSource: resolvedStatusSource,
    syncState: resolvedSyncState,
    manualDisabled: Boolean(before?.manualDisabled),
    departmentExternalIds: after.departmentExternalIds,
    primaryDepartmentExternalId: after.primaryDepartmentExternalId ?? null
  };

  if (!before) {
    return {
      entityType: "user",
      entityExternalId: getSnapshotUserKey(after),
      changeType: "created",
      afterPayload
    };
  }

  const beforePayload = {
    userId: before.dingtalkUserId ?? before.externalId ?? after.userId,
    unionId: before.externalId ?? null,
    openId: before.dingtalkOpenId ?? null,
    corpId: before.dingtalkCorpId ?? null,
    displayName: before.displayName,
    email: before.email,
    status: before.status ?? "active",
    statusSource: before.statusSource ?? "sync",
    syncState: before.syncState ?? "active",
    manualDisabled: Boolean(before.manualDisabled),
    departmentExternalIds: after.departmentExternalIds,
    primaryDepartmentExternalId: after.primaryDepartmentExternalId ?? null
  };

  if (!compareRecords(beforePayload, afterPayload)) {
    const beforeStatus = (before.status ?? "active").toLowerCase();
    const afterStatus = resolvedStatus.toLowerCase();
    const changeType: UserDiff["changeType"] =
      beforeStatus !== afterStatus && afterStatus === "active"
        ? "restored"
        : beforeStatus !== afterStatus && afterStatus === "disabled"
          ? "disabled"
          : "updated";

    return {
      entityType: "user",
      entityExternalId: getSnapshotUserKey(after),
      changeType,
      beforePayload,
      afterPayload
    };
  }
  return null;
}

function compareMembership(
  before: Array<{ departmentId: string; isPrimary: boolean }>,
  after: Array<{ departmentId: string; isPrimary: boolean }>,
  userKey: string
): MembershipDiff | null {
  const sortMemberships = (items: Array<{ departmentId: string; isPrimary: boolean }>) =>
    [...items].sort((left, right) => {
      if (left.departmentId !== right.departmentId) {
        return left.departmentId.localeCompare(right.departmentId);
      }
      return Number(right.isPrimary) - Number(left.isPrimary);
    });

  const normalizedBefore = sortMemberships(before);
  const normalizedAfter = sortMemberships(after);
  const beforePayload = {
    userId: userKey,
    memberships: normalizedBefore
  };
  const afterPayload = {
    userId: userKey,
    memberships: normalizedAfter
  };

  if (!normalizedBefore.length && normalizedAfter.length) {
    return {
      entityType: "membership",
      entityExternalId: userKey,
      changeType: "created",
      afterPayload
    };
  }
  if (normalizedBefore.length && !normalizedAfter.length) {
    return {
      entityType: "membership",
      entityExternalId: userKey,
      changeType: "removed",
      beforePayload
    };
  }
  if (!compareRecords(beforePayload, afterPayload)) {
    const primaryChanged =
      normalizedBefore.find((item) => item.isPrimary)?.departmentId !==
      normalizedAfter.find((item) => item.isPrimary)?.departmentId;
    return {
      entityType: "membership",
      entityExternalId: userKey,
      changeType: primaryChanged ? "primary_changed" : "updated",
      beforePayload,
      afterPayload
    };
  }
  return null;
}

function buildDiffSummary(diffs: SyncDiff[]) {
  return diffs.reduce(
    (summary, diff) => {
      summary.total += 1;
      summary[diff.entityType] += 1;
      summary.byChangeType[diff.changeType] = (summary.byChangeType[diff.changeType] ?? 0) + 1;
      return summary;
    },
    {
      total: 0,
      department: 0,
      user: 0,
      membership: 0,
      byChangeType: {} as Record<string, number>
    }
  );
}

function resolveUserStatus(
  lifecycleState: UserSnapshot["lifecycleState"],
  manualDisabled: boolean
): {
  status: string;
  statusSource: string;
  syncState: string;
} {
  if (manualDisabled) {
    return {
      status: "disabled",
      statusSource: "manual_disable",
      syncState: lifecycleState
    };
  }

  if (lifecycleState === "active") {
    return {
      status: "active",
      statusSource: "sync",
      syncState: "active"
    };
  }

  return {
    status: "disabled",
    statusSource: "sync",
    syncState: lifecycleState
  };
}

export class OrgSyncService {
  private readonly activeScopes = new Set<string>();

  constructor(private readonly dependencies: OrgSyncRepositories) {}

  async run(input: OrgSyncRunInput): Promise<OrgSyncRunResult> {
    const normalizedScopeExternalId = trimOrUndefined(input.scopeExternalId);
    if ((input.scopeType === "department" || input.scopeType === "user") && !normalizedScopeExternalId) {
      throw new Error(`scopeExternalId is required for ${input.scopeType} sync`);
    }

    const key = scopeKey(input);
    if (this.activeScopes.has(key)) {
      throw new Error(`org sync for ${key} is already running`);
    }
    this.activeScopes.add(key);

    const db = getDb(this.dependencies.jobs as unknown as { db: OrgSyncDb });
    const activeJob = (await db.syncJob.findMany()).find((job) => {
      const jobScopeKey = `${String(job.scopeType ?? "")}:${trimOrUndefined(job.scopeExternalId as string | null) ?? ""}`;
      return (
        jobScopeKey === key &&
        RUNNING_JOB_STATUSES.has(String(job.status ?? "")) &&
        String(job.provider ?? "dingtalk") === "dingtalk"
      );
    });
    if (activeJob) {
      this.activeScopes.delete(key);
      throw new Error(`org sync for ${key} is already running`);
    }

    let jobId = "";
    const startedAt = new Date();

    try {
      const createdJob = await this.dependencies.jobs.create({
        scopeType: input.scopeType,
        scopeExternalId: normalizedScopeExternalId,
        triggerType: input.triggerType,
        triggeredByUserId: trimOrUndefined(input.triggeredByUserId)
      });
      jobId = createdJob.id;
      await this.dependencies.jobs.markRunning(jobId, startedAt);

      await this.dependencies.jobs.appendEvent(jobId, {
        level: "info",
        eventType: "remote_fetch_started",
        message: "Organization fetch started",
        payload: {
          scopeType: input.scopeType,
          scopeExternalId: normalizedScopeExternalId ?? null,
          triggerType: input.triggerType
        }
      });

      const snapshot = await this.fetchSnapshot(input);
      await this.dependencies.jobs.appendEvent(jobId, {
        level: "info",
        eventType: "remote_fetch_completed",
        message: "Organization fetch completed",
        payload: {
          departments: snapshot.departments.length,
          users: snapshot.users.length
        }
      });

      const diffData = await this.computeDiffs(snapshot, input.scopeType, normalizedScopeExternalId);
      await this.dependencies.jobs.appendEvent(jobId, {
        level: "info",
        eventType: "diff_summary",
        message: "Organization diff summary computed",
        payload: buildDiffSummary(diffData.diffs)
      });

      await this.persistSnapshot(snapshot, diffData);

      await this.dependencies.jobs.replaceSnapshots(jobId, [
        {
          entityType: "department",
          scopeType: input.scopeType,
          scopeExternalId: normalizedScopeExternalId,
          snapshotPayload: snapshot.departments
        },
        {
          entityType: "user",
          scopeType: input.scopeType,
          scopeExternalId: normalizedScopeExternalId,
          snapshotPayload: snapshot.users
        },
        {
          entityType: "membership",
          scopeType: input.scopeType,
          scopeExternalId: normalizedScopeExternalId,
          snapshotPayload: snapshot.users.map((user) =>
            normalizeMembershipPayload({
              userId: user.userId,
              departmentExternalIds: user.departmentExternalIds,
              primaryDepartmentExternalId: user.primaryDepartmentExternalId
            })
          )
        }
      ]);
      await this.dependencies.jobs.replaceDiffs(jobId, diffData.diffs.map((diff) => ({
        entityType: diff.entityType,
        entityExternalId: diff.entityExternalId,
        changeType: diff.changeType,
        beforePayload: diff.beforePayload,
        afterPayload: diff.afterPayload
      })));

      await this.dependencies.jobs.appendEvent(jobId, {
        level: "info",
        eventType: "persistence_completed",
        message: "Organization sync persistence completed",
        payload: diffData.summary
      });

      await this.dependencies.jobs.markSucceeded(jobId, diffData.summary);
      return { jobId, status: "succeeded" };
    } catch (error) {
      const message = error instanceof Error ? error.message : "organization sync failed";
      if (jobId) {
        await this.dependencies.jobs.appendEvent(jobId, {
          level: "error",
          eventType: "sync_failed",
          message: "Organization sync failed",
          payload: { detail: message }
        });
        await this.dependencies.jobs.markFailed(jobId, { detail: message });
      }
      return { jobId, status: "failed" };
    } finally {
      this.activeScopes.delete(key);
    }
  }

  private async fetchSnapshot(input: OrgSyncRunInput): Promise<NormalizedOrgSnapshot> {
    if (input.scopeType === "full") {
      return this.dependencies.provider.fetchFullOrganization();
    }
    if (input.scopeType === "department") {
      return this.dependencies.provider.fetchDepartmentScope(trimOrUndefined(input.scopeExternalId) ?? "");
    }
    return this.dependencies.provider.fetchUserScope(trimOrUndefined(input.scopeExternalId) ?? "");
  }

  private async computeDiffs(
    snapshot: NormalizedOrgSnapshot,
    scopeType: OrgSyncScopeType,
    scopeExternalId?: string
  ): Promise<{
    diffs: SyncDiff[];
    summary: Record<string, unknown>;
    departmentRowsByExternalId: Map<string, DepartmentRow>;
    userRowsByKey: Map<string, UserRow>;
  }> {
    const db = getDb(this.dependencies.jobs as unknown as { db: OrgSyncDb });
    const departmentRows = (await db.department.findMany()) as DepartmentRow[];
    const userRows = (await db.user.findMany()) as UserRow[];

    const departmentRowsByExternalId = new Map<string, DepartmentRow>();
    for (const row of departmentRows) {
      departmentRowsByExternalId.set(row.externalId, row);
    }

    const userRowsByKey = new Map<string, UserRow>();
    for (const row of userRows) {
      const key = trimOrUndefined(row.externalId) ?? trimOrUndefined(row.dingtalkUserId) ?? row.id;
      userRowsByKey.set(key, row);
    }

    const diffs: SyncDiff[] = [];

    for (const department of snapshot.departments) {
      const before = departmentRowsByExternalId.get(department.externalId) ?? null;
      const diff = compareDepartment(before, department);
      if (diff) diffs.push(diff);
    }

    for (const user of snapshot.users) {
      const key = getSnapshotUserKey(user);
      const before = userRowsByKey.get(key) ?? userRowsByKey.get(user.userId) ?? null;
      const status = resolveUserStatus(
        user.lifecycleState,
        Boolean(before?.manualDisabled)
      );
      const diff = compareUser(before, user, status.status, status.statusSource, status.syncState);
      if (diff) diffs.push(diff);
    }

    for (const user of snapshot.users) {
      const beforeUser = userRowsByKey.get(getSnapshotUserKey(user)) ?? userRowsByKey.get(user.userId) ?? null;
      if (!beforeUser) continue;
      const currentMemberships = (await db.departmentMembership.findMany({ where: { userId: beforeUser.id } })) as MembershipRow[];
      const current = currentMemberships.map((membership) => ({
        departmentId: membership.departmentId,
        isPrimary: Boolean(membership.isPrimary)
      }));
      const target = this.resolveTargetMemberships(snapshot, user, departmentRowsByExternalId);
      const diff = compareMembership(current, target, getSnapshotUserKey(user));
      if (diff) diffs.push(diff);
    }

    return {
      diffs,
      summary: buildDiffSummary(diffs),
      departmentRowsByExternalId,
      userRowsByKey
    };
  }

  private async persistSnapshot(
    snapshot: NormalizedOrgSnapshot,
    diffData: Awaited<ReturnType<OrgSyncService["computeDiffs"]>>
  ): Promise<void> {
    const now = new Date();
    const departmentUpserts = snapshot.departments.map((department) => ({
      externalId: department.externalId,
      name: department.name,
      parentExternalId: department.parentExternalId,
      sortOrder: department.sortOrder,
      status: "active",
      lastSyncedAt: now
    }));
    await this.dependencies.departments.upsertMany(departmentUpserts);

    const db = getDb(this.dependencies.jobs as unknown as { db: OrgSyncDb });
    const departmentRows = (await db.department.findMany()) as DepartmentRow[];
    const departmentIdsByExternalId = new Map<string, string>();
    for (const row of departmentRows) {
      departmentIdsByExternalId.set(row.externalId, row.id);
    }

    const persistedUserRowsByKey = new Map(diffData.userRowsByKey);

    for (const user of snapshot.users) {
      const key = getSnapshotUserKey(user);
      const existing = persistedUserRowsByKey.get(key) ?? persistedUserRowsByKey.get(user.userId) ?? null;
      const status = resolveUserStatus(user.lifecycleState, Boolean(existing?.manualDisabled));
      const record = {
        externalId: trimOrUndefined(user.unionId) ?? user.userId,
        email: trimOrUndefined(user.email)?.toLowerCase() ?? existing?.email ?? null,
        displayName: user.displayName,
        role: existing?.role ?? "employee",
        status: status.status,
        statusSource: status.statusSource,
        syncState: status.syncState,
        manualDisabled: Boolean(existing?.manualDisabled),
        adminNote: existing?.adminNote ?? null,
        lastSyncedAt: now,
        dingtalkOpenId: trimOrUndefined(user.openId) ?? existing?.dingtalkOpenId ?? null,
        dingtalkUserId: trimOrUndefined(user.userId) ?? existing?.dingtalkUserId ?? null,
        dingtalkCorpId: trimOrUndefined(user.corpId) ?? existing?.dingtalkCorpId ?? null
      };

      if (existing) {
        const saved = (await db.user.update({
          where: { id: existing.id },
          data: record
        })) as UserRow;
        const savedKey = trimOrUndefined(saved.externalId) ?? trimOrUndefined(saved.dingtalkUserId) ?? saved.id;
        persistedUserRowsByKey.set(savedKey, saved);
        const dingtalkUserId = trimOrUndefined(saved.dingtalkUserId);
        if (dingtalkUserId) {
          persistedUserRowsByKey.set(dingtalkUserId, saved);
        }
      } else {
        const saved = (await db.user.create({
          data: record
        })) as UserRow;
        const savedKey = trimOrUndefined(saved.externalId) ?? trimOrUndefined(saved.dingtalkUserId) ?? saved.id;
        persistedUserRowsByKey.set(savedKey, saved);
        const dingtalkUserId = trimOrUndefined(saved.dingtalkUserId);
        if (dingtalkUserId) {
          persistedUserRowsByKey.set(dingtalkUserId, saved);
        }
      }
    }

    for (const user of snapshot.users) {
      const existing = persistedUserRowsByKey.get(getSnapshotUserKey(user)) ?? persistedUserRowsByKey.get(user.userId) ?? null;
      if (!existing) {
        continue;
      }

      const memberships = this.resolveTargetMemberships(snapshot, user, departmentIdsByExternalId);
      await this.dependencies.memberships.replaceSyncedMemberships({
        userId: existing.id,
        memberships,
        syncedAt: now
      });
    }

  }

  private resolveTargetMemberships(
    snapshot: NormalizedOrgSnapshot,
    user: UserSnapshot,
    departmentRowsByExternalId: Map<string, string | DepartmentRow>
  ): Array<{ departmentId: string; isPrimary: boolean }> {
    const membershipExternalIds = new Set(user.departmentExternalIds);
    if (user.primaryDepartmentExternalId) {
      membershipExternalIds.add(user.primaryDepartmentExternalId);
    }

    const memberships: Array<{ departmentId: string; isPrimary: boolean }> = [];
    for (const departmentExternalId of membershipExternalIds) {
      const department = departmentRowsByExternalId.get(departmentExternalId);
      const departmentId = typeof department === "string" ? department : department?.id;
      if (!departmentId) continue;
      memberships.push({
        departmentId,
        isPrimary: departmentExternalId === user.primaryDepartmentExternalId
      });
    }

    if (!user.primaryDepartmentExternalId && memberships.length === 1) {
      memberships[0]!.isPrimary = true;
    }

    return memberships;
  }
}
