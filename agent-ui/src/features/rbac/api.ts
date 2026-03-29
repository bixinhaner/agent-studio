import { api } from "../../lib/api";

import type {
  CloneRoleInput,
  CreateRoleInput,
  ReplaceRolePermissionsInput,
  ReplaceRoleResourcePoliciesInput,
  ReplaceUserRolesInput,
  RoleAuditLogResponse,
  RoleDetailResponse,
  RoleListResponse,
  RoleMutationResponse,
  RolePermissionResponse,
  RoleResourcePolicyResponse,
  UserRoleResponse
} from "./types";

export async function fetchRoles(): Promise<RoleListResponse> {
  return api<RoleListResponse>("/api/admin/roles");
}

export async function fetchRoleDetail(roleId: string): Promise<RoleDetailResponse> {
  return api<RoleDetailResponse>(`/api/admin/roles/${encodeURIComponent(roleId)}`);
}

export async function createRole(input: CreateRoleInput): Promise<RoleMutationResponse> {
  return api<RoleMutationResponse>("/api/admin/roles", { method: "POST", json: input });
}

export async function cloneRole(roleId: string, input: CloneRoleInput): Promise<RoleMutationResponse> {
  return api<RoleMutationResponse>(`/api/admin/roles/${encodeURIComponent(roleId)}/clone`, {
    method: "POST",
    json: input
  });
}

export async function disableRole(roleId: string): Promise<RoleMutationResponse> {
  return api<RoleMutationResponse>(`/api/admin/roles/${encodeURIComponent(roleId)}/disable`, {
    method: "POST"
  });
}

export async function putRolePermissions(
  roleId: string,
  input: ReplaceRolePermissionsInput
): Promise<RolePermissionResponse> {
  return api<RolePermissionResponse>(`/api/admin/roles/${encodeURIComponent(roleId)}/permissions`, {
    method: "PUT",
    json: input
  });
}

export async function putRoleResourcePolicies(
  roleId: string,
  input: ReplaceRoleResourcePoliciesInput
): Promise<RoleResourcePolicyResponse> {
  return api<RoleResourcePolicyResponse>(`/api/admin/roles/${encodeURIComponent(roleId)}/resource-policies`, {
    method: "PUT",
    json: input
  });
}

export async function fetchUserRoles(userId: string): Promise<UserRoleResponse> {
  return api<UserRoleResponse>(`/api/admin/users/${encodeURIComponent(userId)}/roles`);
}

export async function putUserRoles(userId: string, input: ReplaceUserRolesInput): Promise<UserRoleResponse> {
  return api<UserRoleResponse>(`/api/admin/users/${encodeURIComponent(userId)}/roles`, {
    method: "PUT",
    json: input
  });
}

export async function fetchRoleAuditLogs(roleId: string): Promise<RoleAuditLogResponse> {
  return api<RoleAuditLogResponse>(`/api/admin/audit-logs?targetType=role&targetId=${encodeURIComponent(roleId)}`);
}
