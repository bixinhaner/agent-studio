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
        {
          id: "role-admin",
          slug: "admin",
          name: "Admin",
          isSystem: true,
          isActive: true,
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        },
        {
          id: "role-ops",
          slug: "ops_manager",
          name: "Ops Manager",
          isSystem: false,
          isActive: true,
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchUserRoles.mockResolvedValue({
      userRoles: [
        {
          roleId: "role-admin",
          roleSlug: "admin",
          roleName: "Admin",
          roleIsSystem: true,
          roleIsActive: true,
          isPrimary: true
        }
      ]
    });
    mockedPutUserRoles.mockResolvedValue({ userRoles: [] });

    render(<UserRoleEditor userId="user-1" />);

    await screen.findByText("Admin");
    fireEvent.click(screen.getByLabelText("选择角色 ops_manager"));
    fireEvent.click(screen.getByLabelText("设为主角色 ops_manager"));
    fireEvent.click(screen.getByRole("button", { name: "保存角色分配" }));

    await waitFor(() => {
      expect(mockedPutUserRoles).toHaveBeenCalledWith("user-1", {
        assignments: [
          { roleId: "role-admin", isPrimary: false },
          { roleId: "role-ops", isPrimary: true }
        ]
      });
    });
  });
});
