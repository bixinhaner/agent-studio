import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchRoleDetail: vi.fn(),
  fetchRoleAuditLogs: vi.fn(),
  putRolePermissions: vi.fn(),
  putRoleResourcePolicies: vi.fn()
}));

import {
  fetchRoleAuditLogs,
  fetchRoleDetail,
  putRolePermissions,
  putRoleResourcePolicies
} from "./api";
import { RoleDetailView } from "./RoleDetailView";

const mockedFetchRoleDetail = vi.mocked(fetchRoleDetail);
const mockedFetchRoleAuditLogs = vi.mocked(fetchRoleAuditLogs);
const mockedPutRolePermissions = vi.mocked(putRolePermissions);
const mockedPutRoleResourcePolicies = vi.mocked(putRoleResourcePolicies);

describe("RoleDetailView", () => {
  beforeEach(() => {
    mockedFetchRoleDetail.mockReset();
    mockedFetchRoleAuditLogs.mockReset();
    mockedPutRolePermissions.mockReset();
    mockedPutRoleResourcePolicies.mockReset();
  });

  it("edits role permissions and role-scoped resource policies from one detail view", async () => {
    mockedFetchRoleDetail.mockResolvedValue({
      role: {
        id: "role-ops",
        slug: "ops_manager",
        name: "Ops Manager",
        isSystem: false,
        isActive: true,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      },
      permissions: [
        {
          id: "permission-role-write",
          key: "role.write",
          name: "Write roles",
          category: "role",
          isSystem: true,
          isActive: true,
          assigned: false
        }
      ],
      resourcePolicies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "role-ops",
          resourceType: "workspace",
          resourceId: "workspace-rd",
          effect: "allow"
        }
      ],
      memberCount: 1,
      recentAuditEntries: []
    });
    mockedFetchRoleAuditLogs.mockResolvedValue({ auditLogs: [] });
    mockedPutRolePermissions.mockResolvedValue({ bindings: [] });
    mockedPutRoleResourcePolicies.mockResolvedValue({ policies: [] });

    render(<RoleDetailView roleId="role-ops" />);

    await screen.findByText("功能权限");
    fireEvent.click(screen.getByLabelText("permission role.write"));
    fireEvent.click(screen.getByRole("tab", { name: "资源授权" }));
    fireEvent.click(screen.getByLabelText("workspace workspace-rd allow"));
    fireEvent.click(screen.getByRole("button", { name: "保存角色配置" }));

    await waitFor(() => {
      expect(mockedPutRolePermissions).toHaveBeenCalledWith("role-ops", {
        permissionIds: ["permission-role-write"]
      });
    });
    expect(mockedPutRoleResourcePolicies).toHaveBeenCalledWith("role-ops", {
      resourceType: "workspace",
      policies: []
    });
  });
});
