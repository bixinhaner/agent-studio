import {
  DINGTALK_ROOT_DEPARTMENT_ID,
  type DingTalkClient,
  type DingTalkDepartment,
  type DingTalkDepartmentPosition,
  type DingTalkOrganizationUser
} from "../auth/dingtalk.js";

export type NormalizedOrgDepartment = {
  externalId: string;
  name: string;
  parentExternalId: string | null;
  sortOrder: number;
};

export type NormalizedOrgUser = {
  userId: string;
  unionId?: string;
  openId?: string;
  corpId?: string;
  displayName: string;
  email?: string;
  avatarUrl?: string;
  mobile?: string;
  telephone?: string;
  jobNumber?: string;
  title?: string;
  workPlace?: string;
  hiredAt?: string;
  managerDingTalkUserId?: string;
  isAdmin?: boolean;
  isBoss?: boolean;
  isLeader?: boolean;
  extension?: Record<string, unknown>;
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
  departmentPositions?: DingTalkDepartmentPosition[];
  detailAttemptedAt?: string;
  detailSyncedAt?: string;
  detailSyncStatus?: "success" | "not_found" | "failed";
  lifecycleState: "active" | "disabled" | "departed";
};

export type NormalizedOrgSnapshot = {
  departments: NormalizedOrgDepartment[];
  users: NormalizedOrgUser[];
};

export type DingTalkUserDetailCacheEntry = {
  detailAttemptedAt?: Date | string | null;
  detailSyncedAt?: Date | string | null;
  detail?: Partial<Pick<
    DingTalkOrganizationUser,
    | "avatarUrl"
    | "mobile"
    | "telephone"
    | "jobNumber"
    | "title"
    | "workPlace"
    | "hiredAt"
    | "managerDingTalkUserId"
    | "isAdmin"
    | "isBoss"
    | "isLeader"
    | "extension"
    | "departmentPositions"
  >>;
};

export type DingTalkOrgProviderOptions = {
  detailRefreshIntervalMs?: number;
  detailFetchConcurrency?: number;
  loadUserDetailCache?: (
    userIds: string[]
  ) => Promise<Map<string, DingTalkUserDetailCacheEntry> | Record<string, DingTalkUserDetailCacheEntry | undefined>>;
  now?: () => Date;
};

const DEFAULT_DETAIL_REFRESH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_DETAIL_FETCH_CONCURRENCY = 3;

const LIFECYCLE_PRIORITY: Record<NormalizedOrgUser["lifecycleState"], number> = {
  active: 0,
  disabled: 1,
  departed: 2
};

function uniqueStrings(values: Iterable<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function normalizeDepartment(department: DingTalkDepartment): NormalizedOrgDepartment {
  return {
    externalId: department.externalId,
    name: department.name,
    parentExternalId: department.parentExternalId,
    sortOrder: department.sortOrder
  };
}

function mergeDepartmentPositions(
  existing: DingTalkDepartmentPosition[] | undefined,
  incoming: DingTalkDepartmentPosition[] | undefined,
  sourceDepartmentId?: string
): DingTalkDepartmentPosition[] | undefined {
  const byDepartment = new Map<string, DingTalkDepartmentPosition>();
  for (const position of [...(existing ?? []), ...(incoming ?? [])]) {
    if (!position.departmentExternalId) continue;
    const current = byDepartment.get(position.departmentExternalId);
    byDepartment.set(position.departmentExternalId, {
      departmentExternalId: position.departmentExternalId,
      position: current?.position ?? position.position,
      isPrimary: Boolean(current?.isPrimary) || Boolean(position.isPrimary),
      sortOrder: current?.sortOrder ?? position.sortOrder,
      isLeader: current?.isLeader ?? position.isLeader
    });
  }
  if (sourceDepartmentId && !byDepartment.has(sourceDepartmentId)) {
    byDepartment.set(sourceDepartmentId, { departmentExternalId: sourceDepartmentId });
  }
  const values = [...byDepartment.values()].sort((left, right) => left.departmentExternalId.localeCompare(right.departmentExternalId));
  return values.length > 0 ? values : undefined;
}

function toValidDate(value: Date | string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function toIsoString(value: Date | string | null | undefined): string | undefined {
  return toValidDate(value)?.toISOString();
}

function normalizeCacheResult(
  input: Map<string, DingTalkUserDetailCacheEntry> | Record<string, DingTalkUserDetailCacheEntry | undefined>
): Map<string, DingTalkUserDetailCacheEntry> {
  if (input instanceof Map) return input;
  return new Map(
    Object.entries(input).flatMap(([userId, entry]) => (entry ? [[userId, entry] as const] : []))
  );
}

function isDetailRefreshDue(
  entry: DingTalkUserDetailCacheEntry | undefined,
  now: Date,
  intervalMs: number
): boolean {
  const lastAttempt = toValidDate(entry?.detailAttemptedAt) ?? toValidDate(entry?.detailSyncedAt);
  if (!lastAttempt) return true;
  return now.getTime() - lastAttempt.getTime() >= intervalMs;
}

function applyEnterpriseDetail(
  user: NormalizedOrgUser,
  detail: DingTalkUserDetailCacheEntry["detail"] | undefined
): NormalizedOrgUser {
  if (!detail) return user;

  const merged: NormalizedOrgUser = { ...user };
  if (detail.avatarUrl) merged.avatarUrl = detail.avatarUrl;
  if (detail.mobile) merged.mobile = detail.mobile;
  if (detail.telephone) merged.telephone = detail.telephone;
  if (detail.jobNumber) merged.jobNumber = detail.jobNumber;
  if (detail.title) merged.title = detail.title;
  if (detail.workPlace) merged.workPlace = detail.workPlace;
  if (detail.hiredAt) merged.hiredAt = detail.hiredAt;
  if (detail.managerDingTalkUserId) merged.managerDingTalkUserId = detail.managerDingTalkUserId;
  if (detail.isAdmin !== undefined) merged.isAdmin = detail.isAdmin;
  if (detail.isBoss !== undefined) merged.isBoss = detail.isBoss;
  if (detail.isLeader !== undefined) merged.isLeader = detail.isLeader;
  if (detail.extension) merged.extension = detail.extension;

  const activeDepartmentIds = new Set(merged.departmentExternalIds);
  if (merged.primaryDepartmentExternalId) {
    activeDepartmentIds.add(merged.primaryDepartmentExternalId);
  }
  const detailPositions = detail.departmentPositions?.filter((position) =>
    activeDepartmentIds.has(position.departmentExternalId)
  );
  const departmentPositions = mergeDepartmentPositions(detailPositions, merged.departmentPositions);
  if (departmentPositions) {
    merged.departmentPositions = departmentPositions;
  }

  return merged;
}

function copyEnterpriseFields(
  target: NormalizedOrgUser,
  existing: NormalizedOrgUser | undefined,
  incoming: DingTalkOrganizationUser
): void {
  if (existing?.avatarUrl ?? incoming.avatarUrl) target.avatarUrl = existing?.avatarUrl ?? incoming.avatarUrl;
  if (existing?.mobile ?? incoming.mobile) target.mobile = existing?.mobile ?? incoming.mobile;
  if (existing?.telephone ?? incoming.telephone) target.telephone = existing?.telephone ?? incoming.telephone;
  if (existing?.jobNumber ?? incoming.jobNumber) target.jobNumber = existing?.jobNumber ?? incoming.jobNumber;
  if (existing?.title ?? incoming.title) target.title = existing?.title ?? incoming.title;
  if (existing?.workPlace ?? incoming.workPlace) target.workPlace = existing?.workPlace ?? incoming.workPlace;
  if (existing?.hiredAt ?? incoming.hiredAt) target.hiredAt = existing?.hiredAt ?? incoming.hiredAt;
  if (existing?.managerDingTalkUserId ?? incoming.managerDingTalkUserId) {
    target.managerDingTalkUserId = existing?.managerDingTalkUserId ?? incoming.managerDingTalkUserId;
  }
  const isAdmin = existing?.isAdmin ?? incoming.isAdmin;
  if (isAdmin !== undefined) target.isAdmin = isAdmin;
  const isBoss = existing?.isBoss ?? incoming.isBoss;
  if (isBoss !== undefined) target.isBoss = isBoss;
  const isLeader = existing?.isLeader ?? incoming.isLeader;
  if (isLeader !== undefined) target.isLeader = isLeader;
  if (existing?.extension ?? incoming.extension) target.extension = existing?.extension ?? incoming.extension;
}

function mergeUser(
  existing: NormalizedOrgUser | undefined,
  incoming: DingTalkOrganizationUser,
  sourceDepartmentId?: string
): NormalizedOrgUser {
  const incomingDepartmentIds = uniqueStrings([
    ...incoming.departmentExternalIds,
    sourceDepartmentId
  ]);

  if (!existing) {
    const created: NormalizedOrgUser = {
      userId: incoming.userId,
      displayName: incoming.displayName,
      departmentExternalIds: incomingDepartmentIds,
      lifecycleState: incoming.lifecycleState
    };
    if (incoming.unionId) created.unionId = incoming.unionId;
    if (incoming.openId) created.openId = incoming.openId;
    if (incoming.corpId) created.corpId = incoming.corpId;
    if (incoming.email) created.email = incoming.email;
    copyEnterpriseFields(created, undefined, incoming);
    const departmentPositions = mergeDepartmentPositions(undefined, incoming.departmentPositions, sourceDepartmentId);
    if (departmentPositions) created.departmentPositions = departmentPositions;
    if (
      incoming.primaryDepartmentExternalId &&
      incomingDepartmentIds.includes(incoming.primaryDepartmentExternalId)
    ) {
      created.primaryDepartmentExternalId = incoming.primaryDepartmentExternalId;
    }
    return created;
  }

  const mergedDepartmentIds = uniqueStrings([
    ...existing.departmentExternalIds,
    ...incomingDepartmentIds
  ]);
  const existingPriority = LIFECYCLE_PRIORITY[existing.lifecycleState];
  const incomingPriority = LIFECYCLE_PRIORITY[incoming.lifecycleState];

  const merged: NormalizedOrgUser = {
    userId: existing.userId,
    displayName: existing.displayName || incoming.displayName,
    departmentExternalIds: mergedDepartmentIds,
    lifecycleState: incomingPriority > existingPriority ? incoming.lifecycleState : existing.lifecycleState
  };
  if (existing.unionId ?? incoming.unionId) merged.unionId = existing.unionId ?? incoming.unionId;
  if (existing.openId ?? incoming.openId) merged.openId = existing.openId ?? incoming.openId;
  if (existing.corpId ?? incoming.corpId) merged.corpId = existing.corpId ?? incoming.corpId;
  if (existing.email ?? incoming.email) merged.email = existing.email ?? incoming.email;
  copyEnterpriseFields(merged, existing, incoming);
  const departmentPositions = mergeDepartmentPositions(existing.departmentPositions, incoming.departmentPositions, sourceDepartmentId);
  if (departmentPositions) merged.departmentPositions = departmentPositions;

  const primaryDepartmentExternalId =
    existing.primaryDepartmentExternalId && mergedDepartmentIds.includes(existing.primaryDepartmentExternalId)
      ? existing.primaryDepartmentExternalId
      : incoming.primaryDepartmentExternalId && mergedDepartmentIds.includes(incoming.primaryDepartmentExternalId)
        ? incoming.primaryDepartmentExternalId
        : undefined;
  if (primaryDepartmentExternalId) {
    merged.primaryDepartmentExternalId = primaryDepartmentExternalId;
  }

  return merged;
}

function filterUserToDepartmentSet(
  user: NormalizedOrgUser,
  allowedDepartmentIds: Set<string>
): NormalizedOrgUser {
  const departmentExternalIds = user.departmentExternalIds.filter((departmentId) =>
    allowedDepartmentIds.has(departmentId)
  );

  const filtered: NormalizedOrgUser = {
    ...user,
    departmentExternalIds
  };
  if (
    user.primaryDepartmentExternalId &&
    departmentExternalIds.includes(user.primaryDepartmentExternalId)
  ) {
    filtered.primaryDepartmentExternalId = user.primaryDepartmentExternalId;
  } else {
    delete filtered.primaryDepartmentExternalId;
  }
  return filtered;
}

function sortSnapshot(snapshot: NormalizedOrgSnapshot): NormalizedOrgSnapshot {
  snapshot.departments.sort((left, right) => {
    if (left.sortOrder !== right.sortOrder) {
      return left.sortOrder - right.sortOrder;
    }
    return left.externalId.localeCompare(right.externalId);
  });

  snapshot.users.sort((left, right) => left.userId.localeCompare(right.userId));

  return snapshot;
}

export class DingTalkOrgProvider {
  private readonly detailRefreshIntervalMs: number;
  private readonly detailFetchConcurrency: number;

  constructor(
    private readonly client: DingTalkClient,
    private readonly options: DingTalkOrgProviderOptions = {}
  ) {
    this.detailRefreshIntervalMs = options.detailRefreshIntervalMs ?? DEFAULT_DETAIL_REFRESH_INTERVAL_MS;
    this.detailFetchConcurrency = Math.max(1, Math.floor(options.detailFetchConcurrency ?? DEFAULT_DETAIL_FETCH_CONCURRENCY));
  }

  async fetchFullOrganization(): Promise<NormalizedOrgSnapshot> {
    const departments = await this.collectDepartmentTree(DINGTALK_ROOT_DEPARTMENT_ID);
    const departmentIds = new Set(departments.map((department) => department.externalId));
    const users = await this.collectUsersForDepartments(departments.map((department) => department.externalId));
    await this.enrichUsersWithCachedAndFreshDetails(users);

    return sortSnapshot({
      departments: departments.map(normalizeDepartment),
      users: [...users.values()].map((user) => filterUserToDepartmentSet(user, departmentIds))
    });
  }

  async fetchDepartmentScope(externalDepartmentId: string): Promise<NormalizedOrgSnapshot> {
    const departments = await this.collectDepartmentTree(DINGTALK_ROOT_DEPARTMENT_ID);
    const subtree = this.selectDepartmentSubtree(departments, externalDepartmentId);
    const departmentIds = new Set(subtree.map((department) => department.externalId));
    const users = await this.collectUsersForDepartments(subtree.map((department) => department.externalId));
    await this.enrichUsersWithCachedAndFreshDetails(users);

    return sortSnapshot({
      departments: subtree.map(normalizeDepartment),
      users: [...users.values()].map((user) => filterUserToDepartmentSet(user, departmentIds))
    });
  }

  async fetchUserScope(externalUserId: string): Promise<NormalizedOrgSnapshot> {
    const user = await this.client.getUser({ userId: externalUserId });
    if (!user) {
      return { departments: [], users: [] };
    }

    const departments = await this.collectDepartmentTree(DINGTALK_ROOT_DEPARTMENT_ID);
    const requestedDepartmentIds = new Set(uniqueStrings(user.departmentExternalIds));
    const linkedDepartments = departments.filter((department) => requestedDepartmentIds.has(department.externalId));
    const linkedDepartmentIds = new Set(linkedDepartments.map((department) => department.externalId));
    const detailSyncedAt = this.now().toISOString();
    const normalizedUser = filterUserToDepartmentSet(
      {
        ...mergeUser(undefined, user),
        detailAttemptedAt: detailSyncedAt,
        detailSyncedAt,
        detailSyncStatus: "success"
      },
      linkedDepartmentIds
    );

    return sortSnapshot({
      departments: linkedDepartments.map(normalizeDepartment),
      users: [normalizedUser]
    });
  }

  private async collectDepartmentTree(parentId: string): Promise<DingTalkDepartment[]> {
    const collected: DingTalkDepartment[] = [];
    const seen = new Set<string>();

    const visit = async (currentParentId: string) => {
      const children = await this.client.listDepartments({ parentId: currentParentId });
      for (const child of children) {
        if (seen.has(child.externalId)) continue;
        seen.add(child.externalId);
        collected.push(child);
        await visit(child.externalId);
      }
    };

    await visit(parentId);
    return collected;
  }

  private selectDepartmentSubtree(
    departments: DingTalkDepartment[],
    rootDepartmentId: string
  ): DingTalkDepartment[] {
    const byParentId = new Map<string, DingTalkDepartment[]>();
    for (const department of departments) {
      const parentId = department.parentExternalId ?? "";
      const siblings = byParentId.get(parentId) ?? [];
      siblings.push(department);
      byParentId.set(parentId, siblings);
    }

    const selected: DingTalkDepartment[] = [];
    const seen = new Set<string>();
    const visit = (departmentId: string) => {
      for (const department of departments) {
        if (department.externalId !== departmentId || seen.has(department.externalId)) continue;
        seen.add(department.externalId);
        selected.push(department);
        for (const child of byParentId.get(department.externalId) ?? []) {
          visit(child.externalId);
        }
      }
    };

    visit(rootDepartmentId);
    return selected;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private async loadDetailCache(userIds: string[]): Promise<Map<string, DingTalkUserDetailCacheEntry>> {
    if (!this.options.loadUserDetailCache || userIds.length === 0) {
      return new Map();
    }
    const cache = await this.options.loadUserDetailCache(userIds);
    return normalizeCacheResult(cache);
  }

  private async enrichUsersWithCachedAndFreshDetails(users: Map<string, NormalizedOrgUser>): Promise<void> {
    if (!this.options.loadUserDetailCache || users.size === 0) {
      return;
    }

    const now = this.now();
    const cache = await this.loadDetailCache([...users.keys()]);
    const dueUserIds: string[] = [];

    for (const [userId, user] of users) {
      const cached = cache.get(userId);
      const cachedUser = applyEnterpriseDetail(user, cached?.detail);
      if (cached?.detailAttemptedAt) cachedUser.detailAttemptedAt = toIsoString(cached.detailAttemptedAt);
      if (cached?.detailSyncedAt) cachedUser.detailSyncedAt = toIsoString(cached.detailSyncedAt);
      users.set(userId, cachedUser);
      if (isDetailRefreshDue(cached, now, this.detailRefreshIntervalMs)) {
        dueUserIds.push(userId);
      }
    }

    await this.fetchFreshDetails(users, dueUserIds, now);
  }

  private async fetchFreshDetails(users: Map<string, NormalizedOrgUser>, userIds: string[], attemptedAt: Date): Promise<void> {
    if (userIds.length === 0) {
      return;
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(this.detailFetchConcurrency, userIds.length) }, async () => {
      for (;;) {
        const userId = userIds[cursor];
        cursor += 1;
        if (!userId) return;

        const existing = users.get(userId);
        if (!existing) continue;

        try {
          const detail = await this.client.getUser({ userId });
          if (!detail) {
            users.set(userId, {
              ...existing,
              detailAttemptedAt: attemptedAt.toISOString(),
              detailSyncStatus: "not_found"
            });
            continue;
          }
          users.set(userId, {
            ...applyEnterpriseDetail(existing, detail),
            detailAttemptedAt: attemptedAt.toISOString(),
            detailSyncedAt: attemptedAt.toISOString(),
            detailSyncStatus: "success"
          });
        } catch {
          users.set(userId, {
            ...existing,
            detailAttemptedAt: attemptedAt.toISOString(),
            detailSyncStatus: "failed"
          });
        }
      }
    });

    await Promise.all(workers);
  }

  private async collectUsersForDepartments(departmentIds: string[]): Promise<Map<string, NormalizedOrgUser>> {
    const users = new Map<string, NormalizedOrgUser>();

    for (const departmentId of departmentIds) {
      const members = await this.client.listDepartmentUsers({ departmentId });
      for (const member of members) {
        users.set(member.userId, mergeUser(users.get(member.userId), member, departmentId));
      }
    }

    return users;
  }
}
