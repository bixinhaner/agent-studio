import type {
  DingTalkClient,
  DingTalkDepartment,
  DingTalkOrganizationUser
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
  departmentExternalIds: string[];
  primaryDepartmentExternalId?: string;
  lifecycleState: "active" | "disabled" | "departed";
};

export type NormalizedOrgSnapshot = {
  departments: NormalizedOrgDepartment[];
  users: NormalizedOrgUser[];
};

type DingTalkOrgReader = Required<
  Pick<DingTalkClient, "listDepartments" | "listDepartmentUsers" | "getUser">
>;

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
  constructor(private readonly client: DingTalkClient) {}

  async fetchFullOrganization(): Promise<NormalizedOrgSnapshot> {
    const departments = await this.collectDepartmentTree("0");
    const departmentIds = new Set(departments.map((department) => department.externalId));
    const users = await this.collectUsersForDepartments(departments.map((department) => department.externalId));

    return sortSnapshot({
      departments: departments.map(normalizeDepartment),
      users: [...users.values()].map((user) => filterUserToDepartmentSet(user, departmentIds))
    });
  }

  async fetchDepartmentScope(externalDepartmentId: string): Promise<NormalizedOrgSnapshot> {
    const departments = await this.collectDepartmentTree("0");
    const subtree = this.selectDepartmentSubtree(departments, externalDepartmentId);
    const departmentIds = new Set(subtree.map((department) => department.externalId));
    const users = await this.collectUsersForDepartments(subtree.map((department) => department.externalId));

    return sortSnapshot({
      departments: subtree.map(normalizeDepartment),
      users: [...users.values()].map((user) => filterUserToDepartmentSet(user, departmentIds))
    });
  }

  async fetchUserScope(externalUserId: string): Promise<NormalizedOrgSnapshot> {
    const client = this.getOrgReader();
    const user = await client.getUser({ userId: externalUserId });
    if (!user) {
      return { departments: [], users: [] };
    }

    const departments = await this.collectDepartmentTree("0");
    const requestedDepartmentIds = new Set(uniqueStrings(user.departmentExternalIds));
    const linkedDepartments = departments.filter((department) => requestedDepartmentIds.has(department.externalId));
    const linkedDepartmentIds = new Set(linkedDepartments.map((department) => department.externalId));
    const normalizedUser = filterUserToDepartmentSet(
      mergeUser(undefined, user),
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
    const client = this.getOrgReader();

    const visit = async (currentParentId: string) => {
      const children = await client.listDepartments({ parentId: currentParentId });
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

  private async collectUsersForDepartments(departmentIds: string[]): Promise<Map<string, NormalizedOrgUser>> {
    const users = new Map<string, NormalizedOrgUser>();
    const client = this.getOrgReader();

    for (const departmentId of departmentIds) {
      const members = await client.listDepartmentUsers({ departmentId });
      for (const member of members) {
        users.set(member.userId, mergeUser(users.get(member.userId), member, departmentId));
      }
    }

    return users;
  }

  private getOrgReader(): DingTalkOrgReader {
    if (!this.client.listDepartments || !this.client.listDepartmentUsers || !this.client.getUser) {
      throw new Error("DingTalk client does not support organization reads");
    }

    return {
      listDepartments: (input) => this.client.listDepartments!(input),
      listDepartmentUsers: (input) => this.client.listDepartmentUsers!(input),
      getUser: (input) => this.client.getUser!(input)
    };
  }
}
