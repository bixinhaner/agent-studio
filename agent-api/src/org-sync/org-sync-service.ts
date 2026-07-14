import type { DingTalkOrgProvider, NormalizedOrgSnapshot } from "./dingtalk-org-provider.js";
import {
  ensureInternalOrganization,
  INTERNAL_ORGANIZATION_ID,
  INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE
} from "../auth/internal-organization.js";
import { DepartmentMembershipRepository } from "../persistence/department-membership-repository.js";
import { DepartmentRepository } from "../persistence/department-repository.js";
import type { OrganizationMembershipRepository } from "../persistence/organization-membership-repository.js";
import type { OrganizationRepository } from "../persistence/organization-repository.js";
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
    findMany(args?: {
      where?: { userId?: string; departmentId?: { in: string[] } };
    }): Promise<Array<Record<string, unknown>>>;
  };
  enterpriseUserProfile?: {
    findFirst(args?: { where?: Record<string, unknown> }): Promise<Record<string, unknown> | null>;
    upsert(args: {
      where: { userId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<Record<string, unknown>>;
  };
  authIdentity?: {
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
  organizations?: Pick<OrganizationRepository, "getById" | "getBySlug" | "create">;
  organizationMemberships?: Pick<OrganizationMembershipRepository, "upsert">;
  jobs: SyncJobRepository;
  resourceAccessLogs?: {
    record(input: {
      userId?: string;
      resourceType: string;
      resourceId: string;
      actionType: string;
      resultStatus: string;
      metadata?: unknown;
    }): Promise<unknown>;
  };
  afterSuccessfulSync?: () => Promise<void>;
};

type DepartmentSnapshot = NormalizedOrgSnapshot["departments"][number];
type UserSnapshot = NormalizedOrgSnapshot["users"][number];

type UserRow = {
  id: string;
  externalId: string | null;
  email: string | null;
  displayName: string | null;
  role: string | null;
  primaryOrganizationId: string | null;
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
  position: string | null;
  sortOrder: number | null;
  isLeader: boolean | null;
  source: string;
  lastSyncedAt: Date | string | null;
  createdAt: Date | string;
  updatedAt: Date | string;
};

type AuthIdentityRow = {
  userId: string;
  provider: string;
  providerSubject: string;
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

const RUNNING_JOB_STATUSES = new Set(["running"]);
const STALE_PENDING_JOB_SUMMARY = {
  detail: "Recovered stale pending org sync job after interrupted startup"
};
const STALE_RUNNING_JOB_SUMMARY = {
  detail: "Recovered stale running org sync job after interrupted startup"
};
const STALE_RUNNING_JOB_AGE_MS = 15 * 60 * 1000;
const JOB_HEARTBEAT_INTERVAL_MS = 60 * 1000;
const FULL_SYNC_DEPARTURE_MIN_COVERAGE = 0.8;
const FULL_SYNC_DEPARTURE_SMALL_DIRECTORY_MAX = 10;

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

function getSnapshotUserKey(user: UserSnapshot): string {
  return trimOrUndefined(user.unionId) ?? user.userId;
}

function getUserRowKey(row: UserRow): string {
  return trimOrUndefined(row.externalId) ?? trimOrUndefined(row.dingtalkUserId) ?? row.id;
}

function addUserRowKey(target: Map<string, UserRow>, row: UserRow, key: string | null | undefined): boolean {
  const normalized = trimOrUndefined(key);
  if (!normalized || target.has(normalized)) {
    return false;
  }
  target.set(normalized, row);
  return true;
}

function indexUserRowByStableKeys(target: Map<string, UserRow>, row: UserRow): void {
  const addedExternalId = addUserRowKey(target, row, row.externalId);
  const addedDingTalkUserId = addUserRowKey(target, row, row.dingtalkUserId);
  if (!addedExternalId && !addedDingTalkUserId) {
    addUserRowKey(target, row, row.id);
  }
}

function uniqueUserRows(rows: Iterable<UserRow>): UserRow[] {
  const seen = new Set<string>();
  const result: UserRow[] = [];
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    result.push(row);
  }
  return result;
}

function isDingTalkSyncManagedUser(row: UserRow): boolean {
  if (!row.lastSyncedAt) {
    return false;
  }
  return Boolean(trimOrUndefined(row.externalId) || trimOrUndefined(row.dingtalkUserId));
}

function hasSafeFullSyncDepartureCoverage(snapshotUserCount: number, existingManagedUserCount: number): boolean {
  if (snapshotUserCount <= 0 || existingManagedUserCount <= 0) {
    return false;
  }
  if (existingManagedUserCount <= FULL_SYNC_DEPARTURE_SMALL_DIRECTORY_MAX) {
    return true;
  }
  return snapshotUserCount / existingManagedUserCount >= FULL_SYNC_DEPARTURE_MIN_COVERAGE;
}

function shouldHandleMissingFullSyncUser(row: UserRow, processedUserIds: Set<string>): boolean {
  if (processedUserIds.has(row.id)) {
    return false;
  }
  return isDingTalkSyncManagedUser(row);
}

function resolveMissingFullSyncStatus(row: UserRow): { status: string; statusSource: string; syncState: string } {
  return {
    status: "disabled",
    statusSource: row.manualDisabled ? "manual_disable" : "sync",
    syncState: "departed"
  };
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
    title: user.title ?? null,
    jobNumber: user.jobNumber ?? null,
    workPlace: user.workPlace ?? null,
    managerDingTalkUserId: user.managerDingTalkUserId ?? null,
    isAdmin: user.isAdmin ?? null,
    isBoss: user.isBoss ?? null,
    isLeader: user.isLeader ?? null,
    lifecycleState: user.lifecycleState
  };
}

function normalizeMembershipPayload(input: {
  userId: string;
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
  departmentPositions?: UserSnapshot["departmentPositions"];
}) {
  return {
    userId: input.userId,
    departmentExternalIds: input.departmentExternalIds,
    primaryDepartmentExternalId: input.primaryDepartmentExternalId ?? null,
    departmentPositions:
      input.departmentPositions?.map((position) => ({
        departmentExternalId: position.departmentExternalId,
        position: position.position ?? null,
        isPrimary: position.isPrimary ?? null,
        sortOrder: position.sortOrder ?? null,
        isLeader: position.isLeader ?? null
      })) ?? []
  };
}

function profileDataFromUser(user: UserSnapshot, userId: string, now: Date) {
  const hiredAt = user.hiredAt ? new Date(user.hiredAt) : null;
  const detailAttemptedAt = user.detailAttemptedAt ? new Date(user.detailAttemptedAt) : null;
  const detailSyncedAt = user.detailSyncedAt ? new Date(user.detailSyncedAt) : null;
  return {
    userId,
    employeeNo: trimOrUndefined(user.jobNumber) ?? null,
    title: trimOrUndefined(user.title) ?? null,
    mobile: trimOrUndefined(user.mobile) ?? null,
    telephone: trimOrUndefined(user.telephone) ?? null,
    avatarUrl: trimOrUndefined(user.avatarUrl) ?? null,
    workPlace: trimOrUndefined(user.workPlace) ?? null,
    hiredAt: hiredAt && !Number.isNaN(hiredAt.getTime()) ? hiredAt : null,
    managerDingTalkUserId: trimOrUndefined(user.managerDingTalkUserId) ?? null,
    managerUserId: null,
    isAdmin: user.isAdmin ?? null,
    isBoss: user.isBoss ?? null,
    isLeader: user.isLeader ?? null,
    extensionJson: user.extension ?? null,
    departmentPositionsJson: user.departmentPositions ?? null,
    detailAttemptedAt: detailAttemptedAt && !Number.isNaN(detailAttemptedAt.getTime()) ? detailAttemptedAt : undefined,
    detailSyncedAt: detailSyncedAt && !Number.isNaN(detailSyncedAt.getTime()) ? detailSyncedAt : undefined,
    detailSyncStatus: user.detailSyncStatus ?? undefined,
    source: "dingtalk",
    lastSyncedAt: now
  };
}

function compareRecords(before: Record<string, unknown> | undefined, after: Record<string, unknown>): boolean {
  return JSON.stringify(before ?? null) === JSON.stringify(after);
}

function toTimestamp(value: unknown): number | null {
  if (value instanceof Date) {
    return value.getTime();
  }
  if (typeof value === "string") {
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
  }
  return null;
}

function toNullableInt32(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }
  if (!Number.isInteger(value) || value < -2147483648 || value > 2147483647) {
    return null;
  }
  return value;
}

function isStaleRunningJob(job: Record<string, unknown>, now = Date.now()): boolean {
  if (String(job.status ?? "") !== "running") {
    return false;
  }
  const startedAt = toTimestamp(job.startedAt) ?? toTimestamp(job.updatedAt) ?? toTimestamp(job.createdAt);
  return startedAt !== null && now - startedAt >= STALE_RUNNING_JOB_AGE_MS;
}

function resolveComparableParentExternalId(
  parentDepartmentId: string | null | undefined,
  departmentRowsById: Map<string, DepartmentRow>
): string | null {
  if (!parentDepartmentId) return null;
  return departmentRowsById.get(parentDepartmentId)?.externalId ?? parentDepartmentId;
}

function resolvePersistableParentExternalId(
  parentExternalId: string | null | undefined,
  knownDepartmentExternalIds: Set<string>
): string | null {
  const normalized = trimOrUndefined(parentExternalId ?? null);
  if (!normalized) return null;
  return knownDepartmentExternalIds.has(normalized) ? normalized : null;
}

function compareDepartment(
  before: DepartmentRow | null | undefined,
  after: DepartmentSnapshot,
  departmentRowsById: Map<string, DepartmentRow>,
  knownDepartmentExternalIds: Set<string>
): DepartmentDiff | null {
  const beforePayload = before
    ? {
        externalId: before.externalId,
        name: before.name,
        parentExternalId: resolveComparableParentExternalId(before.parentDepartmentId, departmentRowsById),
        sortOrder: before.sortOrder,
        status: before.status ?? "active"
      }
    : undefined;
  const afterPayload = {
    ...normalizeDepartmentPayload(after),
    parentExternalId: resolvePersistableParentExternalId(after.parentExternalId, knownDepartmentExternalIds)
  };
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
  const resolvedOpenId = trimOrUndefined(after.openId) ?? before?.dingtalkOpenId ?? null;
  const resolvedCorpId = trimOrUndefined(after.corpId) ?? before?.dingtalkCorpId ?? null;
  const afterPayload = {
    userId: after.userId,
    unionId: after.unionId ?? null,
    openId: resolvedOpenId,
    corpId: resolvedCorpId,
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

function compareMissingFullSyncUser(before: UserRow): UserDiff | null {
  const status = resolveMissingFullSyncStatus(before);
  const beforePayload = {
    userId: before.dingtalkUserId ?? before.externalId ?? before.id,
    unionId: before.externalId ?? null,
    openId: before.dingtalkOpenId ?? null,
    corpId: before.dingtalkCorpId ?? null,
    displayName: before.displayName,
    email: before.email,
    status: before.status ?? "active",
    statusSource: before.statusSource ?? "sync",
    syncState: before.syncState ?? "active",
    manualDisabled: Boolean(before.manualDisabled)
  };
  const afterPayload = {
    ...beforePayload,
    status: status.status,
    statusSource: status.statusSource,
    syncState: status.syncState
  };

  if (compareRecords(beforePayload, afterPayload)) {
    return null;
  }

  return {
    entityType: "user",
    entityExternalId: getUserRowKey(before),
    changeType: beforePayload.status !== "disabled" ? "disabled" : "updated",
    beforePayload,
    afterPayload
  };
}

function compareMembership(
  before: Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }>,
  after: Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }>,
  userKey: string
): MembershipDiff | null {
  const sortMemberships = (
    items: Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }>
  ) =>
    [...items]
      .map((item) => ({
        departmentId: item.departmentId,
        isPrimary: item.isPrimary,
        position: trimOrUndefined(item.position ?? undefined) ?? null,
        sortOrder: item.sortOrder ?? null,
        isLeader: item.isLeader ?? null
      }))
      .sort((left, right) => {
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

function membershipComparableFromRow(
  membership: MembershipRow,
  departmentRowsById: Map<string, DepartmentRow>
): { departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null } {
  return {
    departmentId: departmentRowsById.get(membership.departmentId)?.externalId ?? membership.departmentId,
    isPrimary: Boolean(membership.isPrimary),
    position: trimOrUndefined(membership.position ?? undefined) ?? null,
    sortOrder: membership.sortOrder ?? null,
    isLeader: membership.isLeader ?? null
  };
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
  private activeRun = false;

  constructor(private readonly dependencies: OrgSyncRepositories) {}

  private async resolveInternalOrganizationId(): Promise<string> {
    if (!this.dependencies.organizations) {
      return INTERNAL_ORGANIZATION_ID;
    }
    return (await ensureInternalOrganization(this.dependencies.organizations)).id;
  }

  private async upsertInternalOrganizationMembership(input: {
    organizationId: string;
    userId: string;
    status: string;
    title?: string | null;
    joinedAt: Date;
  }): Promise<void> {
    if (!this.dependencies.organizationMemberships) {
      return;
    }
    await this.dependencies.organizationMemberships.upsert({
      organizationId: input.organizationId,
      userId: input.userId,
      membershipType: INTERNAL_ORGANIZATION_MEMBERSHIP_TYPE,
      status: input.status,
      title: trimOrUndefined(input.title ?? undefined) ?? null,
      joinedAt: input.joinedAt
    });
  }

  private async upsertEnterpriseProfile(
    db: OrgSyncDb,
    user: UserSnapshot,
    userId: string,
    syncedAt: Date
  ): Promise<void> {
    if (!db.enterpriseUserProfile?.upsert) {
      return;
    }
    const data = profileDataFromUser(user, userId, syncedAt);
    await db.enterpriseUserProfile.upsert({
      where: { userId },
      create: data,
      update: {
        ...data,
        updatedAt: new Date()
      }
    });
  }

  async run(input: OrgSyncRunInput): Promise<OrgSyncRunResult> {
    const normalizedScopeExternalId = trimOrUndefined(input.scopeExternalId);
    if ((input.scopeType === "department" || input.scopeType === "user") && !normalizedScopeExternalId) {
      throw new Error(`scopeExternalId is required for ${input.scopeType} sync`);
    }

    if (this.activeRun) {
      throw new Error("org sync is already running");
    }
    this.activeRun = true;

    let jobId = "";
    let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
    const startedAt = new Date();

    try {
      const db = getDb(this.dependencies.jobs as unknown as { db: OrgSyncDb });
      const knownJobs = await db.syncJob.findMany();
      for (const job of knownJobs) {
        if (String(job.provider ?? "dingtalk") !== "dingtalk") continue;
        const jobId = trimOrUndefined(job.id as string | null);
        if (!jobId) continue;
        if (String(job.status ?? "") === "pending") {
          await this.dependencies.jobs.markFailed(jobId, STALE_PENDING_JOB_SUMMARY);
          continue;
        }
        if (isStaleRunningJob(job)) {
          await this.dependencies.jobs.markFailed(jobId, STALE_RUNNING_JOB_SUMMARY);
        }
      }
      const activeJobs = await db.syncJob.findMany();
      const activeJob = activeJobs.find(
        (job) =>
          RUNNING_JOB_STATUSES.has(String(job.status ?? "")) &&
          String(job.provider ?? "dingtalk") === "dingtalk"
      );
      if (activeJob) {
        throw new Error("org sync is already running");
      }

      const createdJob = await this.dependencies.jobs.create({
        scopeType: input.scopeType,
        scopeExternalId: normalizedScopeExternalId,
        triggerType: input.triggerType,
        triggeredByUserId: trimOrUndefined(input.triggeredByUserId)
      });
      jobId = createdJob.id;
      await this.dependencies.jobs.markRunning(jobId, startedAt);
      heartbeatTimer = setInterval(() => {
        void this.dependencies.jobs.touch(jobId).catch(() => undefined);
      }, JOB_HEARTBEAT_INTERVAL_MS);
      heartbeatTimer.unref?.();

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

      const diffData = await this.computeDiffs(snapshot, input.scopeType);
      await this.dependencies.jobs.appendEvent(jobId, {
        level: "info",
        eventType: "diff_summary",
        message: "Organization diff summary computed",
        payload: buildDiffSummary(diffData.diffs)
      });

      await this.persistSnapshot(snapshot, diffData, input.scopeType);

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
              primaryDepartmentExternalId: user.primaryDepartmentExternalId,
              departmentPositions: user.departmentPositions
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
      if (this.dependencies.afterSuccessfulSync) {
        try {
          await this.dependencies.afterSuccessfulSync();
        } catch (error) {
          await this.dependencies.jobs.appendEvent(jobId, {
            level: "warn",
            eventType: "security_domain_refresh_failed",
            message: "Organization sync succeeded, but security domain membership needs attention",
            payload: { detail: error instanceof Error ? error.message : String(error) }
          });
        }
      }
      if (this.dependencies.resourceAccessLogs) {
        await this.dependencies.resourceAccessLogs.record({
          userId: trimOrUndefined(input.triggeredByUserId),
          resourceType: "org_sync",
          resourceId: normalizedScopeExternalId ?? input.scopeType,
          actionType: "sync",
          resultStatus: "success",
          metadata: {
            jobId,
            scopeType: input.scopeType,
            scopeExternalId: normalizedScopeExternalId,
            triggerType: input.triggerType
          }
        });
      }
      return { jobId, status: "succeeded" };
    } catch (error) {
      if (!jobId) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "organization sync failed";
      if (jobId) {
        await this.dependencies.jobs.appendEvent(jobId, {
          level: "error",
          eventType: "sync_failed",
          message: "Organization sync failed",
          payload: { detail: message }
        });
        await this.dependencies.jobs.markFailed(jobId, { detail: message });
        if (this.dependencies.resourceAccessLogs) {
          await this.dependencies.resourceAccessLogs.record({
            userId: trimOrUndefined(input.triggeredByUserId),
            resourceType: "org_sync",
            resourceId: normalizedScopeExternalId ?? input.scopeType,
            actionType: "sync",
            resultStatus: "failed",
            metadata: {
              jobId,
              detail: message,
              scopeType: input.scopeType,
              scopeExternalId: normalizedScopeExternalId,
              triggerType: input.triggerType
            }
          });
        }
      }
      return { jobId, status: "failed" };
    } finally {
      if (heartbeatTimer) {
        clearInterval(heartbeatTimer);
      }
      this.activeRun = false;
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

  private async computeDiffs(snapshot: NormalizedOrgSnapshot, scopeType: OrgSyncScopeType): Promise<{
    diffs: SyncDiff[];
    summary: Record<string, unknown>;
    departmentRowsByExternalId: Map<string, DepartmentRow>;
    userRowsByKey: Map<string, UserRow>;
  }> {
    const db = getDb(this.dependencies.jobs as unknown as { db: OrgSyncDb });
    const departmentRows = (await db.department.findMany()) as DepartmentRow[];
    const userRows = (await db.user.findMany()) as UserRow[];

    const departmentRowsByExternalId = new Map<string, DepartmentRow>();
    const departmentRowsById = new Map<string, DepartmentRow>();
    for (const row of departmentRows) {
      departmentRowsByExternalId.set(row.externalId, row);
      departmentRowsById.set(row.id, row);
    }
    const knownDepartmentExternalIds = new Set([
      ...departmentRowsByExternalId.keys(),
      ...snapshot.departments.map((department) => department.externalId)
    ]);

    const userRowsByKey = new Map<string, UserRow>();
    const userRowsById = new Map<string, UserRow>();
    for (const row of userRows) {
      indexUserRowByStableKeys(userRowsByKey, row);
      userRowsById.set(row.id, row);
    }

    if (typeof db.authIdentity?.findMany === "function") {
      const authIdentityRows = (await db.authIdentity.findMany({ where: { provider: "dingtalk" } })) as AuthIdentityRow[];
      for (const identity of authIdentityRows) {
        if (identity.provider !== "dingtalk") continue;
        const row = userRowsById.get(identity.userId);
        if (!row) continue;
        addUserRowKey(userRowsByKey, row, identity.providerSubject);
      }
    }

    const diffs: SyncDiff[] = [];
    const scopedDepartmentExternalIds = new Set(snapshot.departments.map((department) => department.externalId));
    const snapshotUserKeys = new Set(snapshot.users.map((user) => getSnapshotUserKey(user)));
    const processedUserIds = new Set<string>();
    const uniqueUserRowsByKey = uniqueUserRows(userRowsByKey.values());
    const canHandleMissingFullSyncUsers =
      scopeType === "full" &&
      hasSafeFullSyncDepartureCoverage(
        snapshot.users.length,
        uniqueUserRowsByKey.filter((row) => isDingTalkSyncManagedUser(row)).length
      );

    for (const department of snapshot.departments) {
      const before = departmentRowsByExternalId.get(department.externalId) ?? null;
      const diff = compareDepartment(before, department, departmentRowsById, knownDepartmentExternalIds);
      if (diff) diffs.push(diff);
    }

    for (const user of snapshot.users) {
      const key = getSnapshotUserKey(user);
      const before = userRowsByKey.get(key) ?? userRowsByKey.get(user.userId) ?? null;
      if (before) {
        processedUserIds.add(before.id);
      }
      const status = resolveUserStatus(
        user.lifecycleState,
        Boolean(before?.manualDisabled)
      );
      const diff = compareUser(before, user, status.status, status.statusSource, status.syncState);
      if (diff) diffs.push(diff);
    }

    for (const user of snapshot.users) {
      const beforeUser = userRowsByKey.get(getSnapshotUserKey(user)) ?? userRowsByKey.get(user.userId) ?? null;
      if (!beforeUser) {
        if (user.departmentExternalIds.length > 0 || user.primaryDepartmentExternalId) {
          diffs.push({
            entityType: "membership",
            entityExternalId: getSnapshotUserKey(user),
            changeType: "created",
            afterPayload: normalizeMembershipPayload({
              userId: getSnapshotUserKey(user),
              departmentExternalIds: user.departmentExternalIds,
              primaryDepartmentExternalId: user.primaryDepartmentExternalId,
              departmentPositions: user.departmentPositions
            })
          });
        }
        continue;
      }
      processedUserIds.add(beforeUser.id);
      const currentMemberships = (await db.departmentMembership.findMany({ where: { userId: beforeUser.id } })) as MembershipRow[];
      const current = currentMemberships.map((membership) => membershipComparableFromRow(membership, departmentRowsById));
      const target = this.resolveTargetMembershipsByExternalId(
        user,
        currentMemberships,
        departmentRowsById,
        scopeType,
        scopedDepartmentExternalIds
      );
      const diff = compareMembership(current, target, getSnapshotUserKey(user));
      if (diff) diffs.push(diff);
    }

    if (canHandleMissingFullSyncUsers) {
      for (const staleUser of uniqueUserRowsByKey) {
        if (!shouldHandleMissingFullSyncUser(staleUser, processedUserIds)) {
          continue;
        }

        const userDiff = compareMissingFullSyncUser(staleUser);
        if (userDiff) diffs.push(userDiff);

        const currentMemberships = (await db.departmentMembership.findMany({ where: { userId: staleUser.id } })) as MembershipRow[];
        const current = currentMemberships.map((membership) => membershipComparableFromRow(membership, departmentRowsById));
        const target = currentMemberships
          .filter((membership) => membership.source !== "sync")
          .map((membership) => membershipComparableFromRow(membership, departmentRowsById));
        const membershipDiff = compareMembership(current, target, getUserRowKey(staleUser));
        if (membershipDiff) diffs.push(membershipDiff);
      }
    }

    if (scopeType === "department") {
      const scopedMemberships = (await db.departmentMembership.findMany({
        where: {
          departmentId: {
            in: [...scopedDepartmentExternalIds]
              .map((externalId) => departmentRowsByExternalId.get(externalId)?.id)
              .filter(Boolean) as string[]
          }
        }
      })) as MembershipRow[];
      const staleScopedUserIds = new Set(scopedMemberships.map((membership) => membership.userId));

      for (const staleUserId of staleScopedUserIds) {
        const staleUser = userRowsById.get(staleUserId);
        if (!staleUser) continue;
        const staleUserKey = getUserRowKey(staleUser);
        if (snapshotUserKeys.has(staleUserKey)) {
          continue;
        }

        const currentMemberships = (await db.departmentMembership.findMany({ where: { userId: staleUserId } })) as MembershipRow[];
        const current = currentMemberships.map((membership) => membershipComparableFromRow(membership, departmentRowsById));
        const target = currentMemberships
          .map((membership) => {
            const departmentExternalId = departmentRowsById.get(membership.departmentId)?.externalId;
            if (!departmentExternalId) {
              return null;
            }
            if (scopedDepartmentExternalIds.has(departmentExternalId) && membership.source === "sync") {
              return null;
            }
            return {
              departmentId: departmentExternalId,
              isPrimary: Boolean(membership.isPrimary),
              position: trimOrUndefined(membership.position ?? undefined) ?? null,
              sortOrder: membership.sortOrder ?? null,
              isLeader: membership.isLeader ?? null
            };
          })
          .filter(
            (membership): membership is {
              departmentId: string;
              isPrimary: boolean;
              position: string | null;
              sortOrder: number | null;
              isLeader: boolean | null;
            } => Boolean(membership)
          )
          .sort((left, right) => left.departmentId.localeCompare(right.departmentId));
        const diff = compareMembership(current, target, staleUserKey);
        if (diff) diffs.push(diff);
      }
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
    diffData: Awaited<ReturnType<OrgSyncService["computeDiffs"]>>,
    scopeType: OrgSyncScopeType
  ): Promise<void> {
    const now = new Date();
    const internalOrganizationId = await this.resolveInternalOrganizationId();
    const departmentUpserts = snapshot.departments.map((department) => ({
      organizationId: internalOrganizationId,
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
    const scopedDepartmentIds =
      scopeType === "department"
        ? [...new Set(snapshot.departments.map((department) => departmentIdsByExternalId.get(department.externalId)).filter(Boolean) as string[])]
        : undefined;

    const persistedUserRowsByKey = new Map(diffData.userRowsByKey);
    const processedUserIds = new Set<string>();
    const uniquePersistedUserRowsByKey = uniqueUserRows(persistedUserRowsByKey.values());
    const canHandleMissingFullSyncUsers =
      scopeType === "full" &&
      hasSafeFullSyncDepartureCoverage(
        snapshot.users.length,
        uniquePersistedUserRowsByKey.filter((row) => isDingTalkSyncManagedUser(row)).length
      );

    for (const user of snapshot.users) {
      const key = getSnapshotUserKey(user);
      const existing = persistedUserRowsByKey.get(key) ?? persistedUserRowsByKey.get(user.userId) ?? null;
      const status = resolveUserStatus(user.lifecycleState, Boolean(existing?.manualDisabled));
      const record = {
        externalId: trimOrUndefined(user.unionId) ?? user.userId,
        email: trimOrUndefined(user.email)?.toLowerCase() ?? existing?.email ?? null,
        displayName: user.displayName,
        role: existing?.role ?? "employee",
        primaryOrganizationId: existing?.primaryOrganizationId ?? internalOrganizationId,
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
        indexUserRowByStableKeys(persistedUserRowsByKey, saved);
        await this.upsertEnterpriseProfile(db, user, saved.id, now);
        await this.upsertInternalOrganizationMembership({
          organizationId: internalOrganizationId,
          userId: saved.id,
          status: status.status === "active" ? "active" : "disabled",
          title: user.title ?? null,
          joinedAt: now
        });
      } else {
        const saved = (await db.user.create({
          data: record
        })) as UserRow;
        indexUserRowByStableKeys(persistedUserRowsByKey, saved);
        await this.upsertEnterpriseProfile(db, user, saved.id, now);
        await this.upsertInternalOrganizationMembership({
          organizationId: internalOrganizationId,
          userId: saved.id,
          status: status.status === "active" ? "active" : "disabled",
          title: user.title ?? null,
          joinedAt: now
        });
      }
    }

    for (const user of snapshot.users) {
      const existing = persistedUserRowsByKey.get(getSnapshotUserKey(user)) ?? persistedUserRowsByKey.get(user.userId) ?? null;
      if (!existing) {
        continue;
      }
      processedUserIds.add(existing.id);

      const memberships = this.resolveTargetMemberships(user, departmentIdsByExternalId);
      await this.dependencies.memberships.replaceSyncedMemberships({
        userId: existing.id,
        memberships,
        ...(scopedDepartmentIds ? { replaceDepartmentIds: scopedDepartmentIds } : {}),
        syncedAt: now
      });
    }

    if (canHandleMissingFullSyncUsers) {
      for (const staleUser of uniquePersistedUserRowsByKey) {
        if (!shouldHandleMissingFullSyncUser(staleUser, processedUserIds)) {
          continue;
        }
        const status = resolveMissingFullSyncStatus(staleUser);
        await db.user.update({
          where: { id: staleUser.id },
          data: {
            status: status.status,
            statusSource: status.statusSource,
            syncState: status.syncState,
            lastSyncedAt: now
          }
        });
        await this.upsertInternalOrganizationMembership({
          organizationId: internalOrganizationId,
          userId: staleUser.id,
          status: "disabled",
          joinedAt: now
        });
        await this.dependencies.memberships.replaceSyncedMemberships({
          userId: staleUser.id,
          memberships: [],
          syncedAt: now
        });
      }
    }

    if (scopedDepartmentIds?.length) {
      const scopedMemberships = (await db.departmentMembership.findMany({
        where: { departmentId: { in: scopedDepartmentIds } }
      })) as MembershipRow[];
      const staleUserIds = [...new Set(scopedMemberships.map((membership) => membership.userId))].filter(
        (userId) => !processedUserIds.has(userId)
      );

      for (const staleUserId of staleUserIds) {
        await this.dependencies.memberships.replaceSyncedMemberships({
          userId: staleUserId,
          memberships: [],
          replaceDepartmentIds: scopedDepartmentIds,
          syncedAt: now
        });
      }
    }

  }

  private resolveTargetMemberships(
    user: UserSnapshot,
    departmentRowsByExternalId: Map<string, string | DepartmentRow>
  ): Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }> {
    const membershipExternalIds = new Set(user.departmentExternalIds);
    if (user.primaryDepartmentExternalId) {
      membershipExternalIds.add(user.primaryDepartmentExternalId);
    }
    const positionByDepartment = new Map((user.departmentPositions ?? []).map((position) => [position.departmentExternalId, position] as const));

    const memberships: Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }> = [];
    for (const departmentExternalId of membershipExternalIds) {
      const department = departmentRowsByExternalId.get(departmentExternalId);
      const departmentId = typeof department === "string" ? department : department?.id;
      if (!departmentId) continue;
      const position = positionByDepartment.get(departmentExternalId);
      memberships.push({
        departmentId,
        isPrimary: departmentExternalId === user.primaryDepartmentExternalId || Boolean(position?.isPrimary),
        position: trimOrUndefined(position?.position ?? undefined) ?? null,
        sortOrder: toNullableInt32(position?.sortOrder),
        isLeader: position?.isLeader ?? null
      });
    }

    if (!user.primaryDepartmentExternalId && memberships.length === 1) {
      memberships[0]!.isPrimary = true;
    }

    return memberships;
  }

  private resolveTargetMembershipsByExternalId(
    user: UserSnapshot,
    currentMemberships: MembershipRow[],
    departmentRowsById: Map<string, DepartmentRow>,
    scopeType: OrgSyncScopeType,
    scopedDepartmentExternalIds: Set<string>
  ): Array<{ departmentId: string; isPrimary: boolean; position?: string | null; sortOrder?: number | null; isLeader?: boolean | null }> {
    const membershipExternalIds = new Set(user.departmentExternalIds);
    if (user.primaryDepartmentExternalId) {
      membershipExternalIds.add(user.primaryDepartmentExternalId);
    }
    const positionByDepartment = new Map((user.departmentPositions ?? []).map((position) => [position.departmentExternalId, position] as const));

    const memberships = [...membershipExternalIds].map((departmentExternalId) => {
      const position = positionByDepartment.get(departmentExternalId);
      return {
        departmentId: departmentExternalId,
        isPrimary: departmentExternalId === user.primaryDepartmentExternalId || Boolean(position?.isPrimary),
        position: trimOrUndefined(position?.position ?? undefined) ?? null,
        sortOrder: toNullableInt32(position?.sortOrder),
        isLeader: position?.isLeader ?? null
      };
    });

    if (scopeType === "department") {
      const incomingHasPrimary = memberships.some((membership) => membership.isPrimary);
      for (const currentMembership of currentMemberships) {
        const departmentExternalId = departmentRowsById.get(currentMembership.departmentId)?.externalId;
        if (!departmentExternalId) {
          continue;
        }
        if (currentMembership.source === "sync" && scopedDepartmentExternalIds.has(departmentExternalId)) {
          continue;
        }
        if (memberships.some((membership) => membership.departmentId === departmentExternalId)) {
          continue;
        }
        memberships.push({
          departmentId: departmentExternalId,
          isPrimary: currentMembership.source === "sync" && incomingHasPrimary ? false : Boolean(currentMembership.isPrimary),
          position: trimOrUndefined(currentMembership.position ?? undefined) ?? null,
          sortOrder: toNullableInt32(currentMembership.sortOrder),
          isLeader: currentMembership.isLeader ?? null
        });
      }
    }

    if (!user.primaryDepartmentExternalId && memberships.length === 1) {
      memberships[0]!.isPrimary = true;
    }

    return memberships.sort((left, right) => left.departmentId.localeCompare(right.departmentId));
  }
}
