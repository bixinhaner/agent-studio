import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchRoles: vi.fn(),
  fetchUserRoles: vi.fn(),
  putUserRoles: vi.fn()
}));

import { fetchRoles, fetchUserRoles, putUserRoles } from "./api";
import { UserRoleEditor } from "./UserRoleEditor";

const mockedFetchRoles = vi.mocked(fetchRoles);
const mockedFetchUserRoles = vi.mocked(fetchUserRoles);
const mockedPutUserRoles = vi.mocked(putUserRoles);

describe("UserRoleEditor", () => {
  beforeEach(() => {
    mockedFetchRoles.mockReset();
    mockedFetchUserRoles.mockReset();
    mockedPutUserRoles.mockReset();
  });

  it("saves multi-role assignments with one primary role", async () => {
    mockedFetchRoles.mockResolvedValue({
      roles: [
        { id: "role-admin", slug: "admin", name: "Admin", isSystem: true, isActive: true, createdAt: "", updatedAt: "" },
        { id: "role-ops", slug: "ops_manager", name: "Ops Manager", isSystem: false, isActive: true, createdAt: "", updatedAt: "" }
      ]
    });
    mockedFetchUserRoles.mockResolvedValue({
      userRoles: [
        { roleId: "role-admin", roleSlug: "admin", roleName: "Admin", roleIsSystem: true, roleIsActive: true, isPrimary: true }
      ]
    });
    mockedPutUserRoles.mockResolvedValue({
      userRoles: [
        { roleId: "role-admin", roleSlug: "admin", roleName: "Admin", roleIsSystem: true, roleIsActive: true, isPrimary: true },
        { roleId: "role-ops", roleSlug: "ops_manager", roleName: "Ops Manager", roleIsSystem: false, roleIsActive: true, isPrimary: false }
      ]
    });

    render(<UserRoleEditor userId="user-1" />);

    expect(await screen.findByText("角色分配")).toBeTruthy();
    fireEvent.click(await screen.findByLabelText("选择角色 ops_manager"));
    fireEvent.click(screen.getByLabelText("设为主角色 admin"));
    fireEvent.click(screen.getByRole("button", { name: "保存角色分配" }));

    await waitFor(() => {
      expect(mockedPutUserRoles).toHaveBeenCalledWith("user-1", {
        assignments: [
          { roleId: "role-admin", isPrimary: true },
          { roleId: "role-ops", isPrimary: false }
        ]
      });
    });
  });
});
