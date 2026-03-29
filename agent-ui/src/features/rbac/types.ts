export type RoleSummary = {
  id: string;
  organizationId?: string;
  slug: string;
  name: string;
  description?: string;
  isSystem: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PermissionSummary = {
  id: string;
  key: string;
  name: string;
  description?: string;
  category: string;
  isSystem: boolean;
  isActive: boolean;
  assigned?: boolean;
};

export type ResourcePolicySummary = {
  id: string;
  subjectType: "role" | "department" | "user";
  subjectId: string;
  resourceType: "workspace" | "knowledge_set" | "agent_mode" | "skill_package" | "run_profile";
  resourceId: string;
  effect: "allow" | "deny";
};

export type AuditLogSummary = {
  id: string;
  actorUserId?: string;
  actionType: string;
  targetType: string;
  targetId?: string;
  createdAt: string;
};

export type RoleDetailResponse = {
  role: RoleSummary;
  permissions: PermissionSummary[];
  resourcePolicies: ResourcePolicySummary[];
  memberCount: number;
  recentAuditEntries: AuditLogSummary[];
};

export type RoleListResponse = {
  roles: RoleSummary[];
};

export type RoleMutationResponse = {
  role: RoleSummary;
};

export type RolePermissionResponse = {
  bindings: Array<{ roleId: string; permissionId: string }>;
};

export type RoleResourcePolicyResponse = {
  policies: ResourcePolicySummary[];
};

export type UserRoleAssignment = {
  roleId: string;
  roleSlug: string;
  roleName: string;
  roleIsSystem: boolean;
  roleIsActive: boolean;
  isPrimary: boolean;
};

export type UserRoleResponse = {
  userRoles: UserRoleAssignment[];
};

export type RoleAuditLogResponse = {
  auditLogs: AuditLogSummary[];
};

export type CreateRoleInput = {
  slug: string;
  name: string;
  description?: string | null;
};

export type CloneRoleInput = {
  slug: string;
  name: string;
  description?: string | null;
};

export type ReplaceRolePermissionsInput = {
  permissionIds: string[];
};

export type ReplaceRoleResourcePoliciesInput = {
  resourceType: ResourcePolicySummary["resourceType"];
  policies: Array<{ resourceId: string; effect: "allow" | "deny" }>;
};

export type ReplaceUserRolesInput = {
  assignments: Array<{ roleId: string; isPrimary: boolean }>;
};
