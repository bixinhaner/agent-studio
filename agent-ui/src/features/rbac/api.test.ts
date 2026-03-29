import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  createRole,
  disableRole,
  fetchRoleAuditLogs,
  fetchRoleDetail,
  fetchRoles,
  fetchUserRoles,
  putRolePermissions,
  putRoleResourcePolicies,
  putUserRoles
} from "./api";

describe("rbac api helpers", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        text: async () => "{}"
      })
    );
  });

  it("calls the unified /api/admin endpoints instead of the old /api/admin/rbac prefix", async () => {
    await fetchRoles();
    await fetchRoleDetail("role-1");
    await createRole({ slug: "ops", name: "Ops" });
    await disableRole("role-1");
    await putRolePermissions("role-1", { permissionIds: ["perm-1"] });
    await putRoleResourcePolicies("role-1", {
      resourceType: "workspace",
      policies: [{ resourceId: "workspace-1", effect: "allow" }]
    });
    await fetchUserRoles("user-1");
    await putUserRoles("user-1", { assignments: [{ roleId: "role-1", isPrimary: true }] });
    await fetchRoleAuditLogs("role-1");

    const calls = vi.mocked(fetch).mock.calls.map((call) => String(call[0]));
    expect(calls).toEqual([
      "http://127.0.0.1:8787/api/admin/roles",
      "http://127.0.0.1:8787/api/admin/roles/role-1",
      "http://127.0.0.1:8787/api/admin/roles",
      "http://127.0.0.1:8787/api/admin/roles/role-1/disable",
      "http://127.0.0.1:8787/api/admin/roles/role-1/permissions",
      "http://127.0.0.1:8787/api/admin/roles/role-1/resource-policies",
      "http://127.0.0.1:8787/api/admin/users/user-1/roles",
      "http://127.0.0.1:8787/api/admin/users/user-1/roles",
      "http://127.0.0.1:8787/api/admin/audit-logs?targetType=role&targetId=role-1"
    ]);
  });
});
