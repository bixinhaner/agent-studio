import type {
  BroadcastAudienceConfig,
  BroadcastAudienceRule,
  BroadcastAudienceSnapshot
} from "../persistence/broadcast-repository.js";

export type BroadcastAudienceRecipient = {
  userId: string;
  displayName?: string;
  email?: string;
  status: string;
  role?: string;
  userType?: string;
  organizationId?: string;
  organizationName?: string;
  organizationType?: string;
  preferences?: Record<string, unknown>;
};

export type BroadcastAudiencePreview = {
  recipients: BroadcastAudienceRecipient[];
  snapshot: BroadcastAudienceSnapshot;
  excluded: {
    disabled: number;
    missingEmail: number;
    emailOptOut: number;
    rules: number;
  };
};

type UserRow = {
  id: string;
  email: string | null;
  displayName: string | null;
  status: string;
  role: string | null;
  userType: string | null;
  primaryOrganizationId: string | null;
  manualDisabled?: boolean | null;
  preferencesJson?: unknown;
  primaryOrganization?: OrganizationRow | null;
  organizationMemberships?: Array<{
    organizationId: string;
    status: string;
    organization?: OrganizationRow | null;
  }>;
};

type OrganizationRow = {
  id: string;
  name: string;
  type: string;
  status: string;
};

type DepartmentRow = {
  id: string;
  parentDepartmentId: string | null;
  status: string;
};

type DepartmentMembershipRow = {
  userId: string;
  departmentId: string;
};

type UserRoleRow = {
  userId: string;
  roleId: string;
};

type BroadcastAudienceDb = {
  user: {
    findMany(args?: unknown): Promise<UserRow[]>;
  };
  organization?: {
    findMany(args?: unknown): Promise<OrganizationRow[]>;
  };
  department?: {
    findMany(args?: unknown): Promise<DepartmentRow[]>;
  };
  departmentMembership?: {
    findMany(args?: unknown): Promise<DepartmentMembershipRow[]>;
  };
  userRole?: {
    findMany(args?: unknown): Promise<UserRoleRow[]>;
  };
};

type Directory = {
  users: UserRow[];
  departments: DepartmentRow[];
  departmentMemberships: DepartmentMembershipRow[];
  userRoles: UserRoleRow[];
};

function trimOrUndefined(value: string | null | undefined): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed || undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function isActiveUser(user: UserRow): boolean {
  return user.status === "active" && user.manualDisabled !== true;
}

function isEmailOptOut(user: UserRow): boolean {
  const preferences = asRecord(user.preferencesJson);
  return (
    preferences.marketingEmailOptOut === true ||
    preferences.emailOptOut === true ||
    preferences.engagementEmailOptOut === true
  );
}

function normalizeOrganizationType(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (value === "external") return "customer";
  return value;
}

function organizationForUser(user: UserRow): OrganizationRow | undefined {
  if (user.primaryOrganization) return user.primaryOrganization;
  return user.organizationMemberships?.find((membership) => membership.status === "active" && membership.organization)?.organization ?? undefined;
}

function userOrganizationIds(user: UserRow): Set<string> {
  const ids = new Set<string>();
  if (user.primaryOrganizationId) ids.add(user.primaryOrganizationId);
  for (const membership of user.organizationMemberships ?? []) {
    if (membership.status === "active" && membership.organizationId) ids.add(membership.organizationId);
  }
  return ids;
}

function userOrganizationTypes(user: UserRow): Set<string> {
  const types = new Set<string>();
  if (user.primaryOrganization?.type) types.add(user.primaryOrganization.type);
  for (const membership of user.organizationMemberships ?? []) {
    if (membership.status === "active" && membership.organization?.type) types.add(membership.organization.type);
  }
  return types;
}

function collectDepartmentIds(rule: BroadcastAudienceRule, departments: DepartmentRow[]): Set<string> {
  const root = trimOrUndefined(rule.id);
  const ids = new Set<string>();
  if (!root) return ids;
  ids.add(root);
  if (!rule.includeChildren) return ids;

  let changed = true;
  while (changed) {
    changed = false;
    for (const department of departments) {
      if (department.status !== "active") continue;
      if (department.parentDepartmentId && ids.has(department.parentDepartmentId) && !ids.has(department.id)) {
        ids.add(department.id);
        changed = true;
      }
    }
  }
  return ids;
}

function usersForRule(rule: BroadcastAudienceRule, directory: Directory): Set<string> {
  const userIds = new Set<string>();
  const id = trimOrUndefined(rule.id);
  const value = trimOrUndefined(rule.value);

  switch (rule.type) {
    case "all_users":
      for (const user of directory.users) {
        if (isActiveUser(user)) userIds.add(user.id);
      }
      break;
    case "organization_type": {
      const targetType = normalizeOrganizationType(value);
      if (!targetType) break;
      for (const user of directory.users) {
        if (isActiveUser(user) && userOrganizationTypes(user).has(targetType)) userIds.add(user.id);
      }
      break;
    }
    case "organization":
      if (!id) break;
      for (const user of directory.users) {
        if (isActiveUser(user) && userOrganizationIds(user).has(id)) userIds.add(user.id);
      }
      break;
    case "department": {
      const departmentIds = collectDepartmentIds(rule, directory.departments);
      if (!departmentIds.size) break;
      for (const membership of directory.departmentMemberships) {
        if (departmentIds.has(membership.departmentId)) userIds.add(membership.userId);
      }
      break;
    }
    case "user":
      if (id && directory.users.some((user) => user.id === id && isActiveUser(user))) userIds.add(id);
      break;
    case "role":
      if (!id) break;
      for (const user of directory.users) {
        if (isActiveUser(user) && user.role === id) userIds.add(user.id);
      }
      for (const assignment of directory.userRoles) {
        if (assignment.roleId === id) userIds.add(assignment.userId);
      }
      break;
    case "disabled_users":
      for (const user of directory.users) {
        if (!isActiveUser(user)) userIds.add(user.id);
      }
      break;
    case "missing_email":
      for (const user of directory.users) {
        if (!trimOrUndefined(user.email)) userIds.add(user.id);
      }
      break;
    case "email_opt_out":
      for (const user of directory.users) {
        if (isEmailOptOut(user)) userIds.add(user.id);
      }
      break;
  }

  return userIds;
}

function toRecipient(user: UserRow): BroadcastAudienceRecipient {
  const organization = organizationForUser(user);
  return {
    userId: user.id,
    displayName: trimOrUndefined(user.displayName),
    email: trimOrUndefined(user.email),
    status: user.status,
    role: trimOrUndefined(user.role),
    userType: trimOrUndefined(user.userType),
    organizationId: organization?.id,
    organizationName: organization?.name,
    organizationType: organization?.type,
    preferences: asRecord(user.preferencesJson)
  };
}

function buildSnapshot(recipients: BroadcastAudienceRecipient[], excludedCount: number): BroadcastAudienceSnapshot {
  return {
    recipientCount: recipients.length,
    emailReachableCount: recipients.filter((recipient) => Boolean(recipient.email)).length,
    internalCount: recipients.filter((recipient) => recipient.organizationType === "internal").length,
    externalCount: recipients.filter((recipient) => recipient.organizationType && recipient.organizationType !== "internal").length,
    excludedCount,
    sampleRecipients: recipients.slice(0, 20).map((recipient) => ({
      userId: recipient.userId,
      displayName: recipient.displayName,
      email: recipient.email,
      organizationName: recipient.organizationName,
      organizationType: recipient.organizationType
    })),
    calculatedAt: new Date().toISOString()
  };
}

export class BroadcastAudienceResolver {
  constructor(private readonly db: BroadcastAudienceDb) {}

  async preview(config: BroadcastAudienceConfig): Promise<BroadcastAudiencePreview> {
    const directory = await this.loadDirectory();
    const included = new Set<string>();
    for (const rule of config.include) {
      for (const userId of usersForRule(rule, directory)) {
        included.add(userId);
      }
    }

    const explicitExcluded = new Set<string>();
    for (const rule of config.exclude) {
      for (const userId of usersForRule(rule, directory)) {
        explicitExcluded.add(userId);
      }
    }

    const usersById = new Map(directory.users.map((user) => [user.id, user]));
    const disabled = new Set<string>();
    const missingEmail = new Set<string>();
    const emailOptOut = new Set<string>();
    for (const user of directory.users) {
      if (!isActiveUser(user)) disabled.add(user.id);
      if (!trimOrUndefined(user.email)) missingEmail.add(user.id);
      if (isEmailOptOut(user)) emailOptOut.add(user.id);
    }

    const excluded = new Set([...explicitExcluded, ...disabled, ...missingEmail, ...emailOptOut]);
    const recipients = [...included]
      .filter((userId) => !excluded.has(userId))
      .map((userId) => usersById.get(userId))
      .filter((user): user is UserRow => Boolean(user))
      .map(toRecipient)
      .sort((a, b) => (a.displayName || a.email || a.userId).localeCompare(b.displayName || b.email || b.userId));

    return {
      recipients,
      snapshot: buildSnapshot(recipients, [...included].filter((userId) => excluded.has(userId)).length),
      excluded: {
        disabled: [...included].filter((userId) => disabled.has(userId)).length,
        missingEmail: [...included].filter((userId) => missingEmail.has(userId)).length,
        emailOptOut: [...included].filter((userId) => emailOptOut.has(userId)).length,
        rules: [...included].filter((userId) => explicitExcluded.has(userId)).length
      }
    };
  }

  private async loadDirectory(): Promise<Directory> {
    const [users, departments, departmentMemberships, userRoles] = await Promise.all([
      this.db.user.findMany({
        orderBy: { createdAt: "asc" },
        include: {
          primaryOrganization: true,
          organizationMemberships: {
            where: { status: "active" },
            include: { organization: true }
          }
        }
      }),
      this.db.department?.findMany({ orderBy: { sortOrder: "asc" } }) ?? Promise.resolve([]),
      this.db.departmentMembership?.findMany({ orderBy: { createdAt: "asc" } }) ?? Promise.resolve([]),
      this.db.userRole?.findMany({ orderBy: { createdAt: "asc" } }) ?? Promise.resolve([])
    ]);
    return { users, departments, departmentMemberships, userRoles };
  }
}
