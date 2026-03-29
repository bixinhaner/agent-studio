import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchRoles: vi.fn(),
  createRole: vi.fn(),
  cloneRole: vi.fn(),
  disableRole: vi.fn()
}));

vi.mock("./RoleDetailView", () => ({
  RoleDetailView: ({ roleId }: { roleId: string }) => <section>Role detail {roleId}</section>
}));

import { cloneRole, createRole, disableRole, fetchRoles } from "./api";
import { RolesView } from "./RolesView";

const mockedFetchRoles = vi.mocked(fetchRoles);
const mockedCreateRole = vi.mocked(createRole);
const mockedCloneRole = vi.mocked(cloneRole);
const mockedDisableRole = vi.mocked(disableRole);

describe("RolesView", () => {
  beforeEach(() => {
    mockedFetchRoles.mockReset();
    mockedCreateRole.mockReset();
    mockedCloneRole.mockReset();
    mockedDisableRole.mockReset();
  });

  it("creates, clones, disables, and selects roles", async () => {
    mockedFetchRoles
      .mockResolvedValueOnce({
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
      })
      .mockResolvedValue({
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
          },
          {
            id: "role-ops-copy",
            slug: "ops_manager_copy",
            name: "Ops Manager Copy",
            isSystem: false,
            isActive: true,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z"
          }
        ]
      });
    mockedCreateRole.mockResolvedValue({
      role: {
        id: "role-ops-new",
        slug: "ops_new",
        name: "Ops New",
        isSystem: false,
        isActive: true,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });
    mockedCloneRole.mockResolvedValue({
      role: {
        id: "role-ops-copy",
        slug: "ops_manager_copy",
        name: "Ops Manager Copy",
        isSystem: false,
        isActive: true,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });
    mockedDisableRole.mockResolvedValue({
      role: {
        id: "role-ops",
        slug: "ops_manager",
        name: "Ops Manager",
        isSystem: false,
        isActive: false,
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });

    render(<RolesView />);

    expect(await screen.findByText("角色列表")).toBeTruthy();
    expect(await screen.findByText("Role detail role-admin")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("角色 slug"), { target: { value: "ops_new" } });
    fireEvent.change(screen.getByLabelText("角色名称"), { target: { value: "Ops New" } });
    fireEvent.click(screen.getByRole("button", { name: "新建角色" }));

    await waitFor(() => {
      expect(mockedCreateRole).toHaveBeenCalledWith({ slug: "ops_new", name: "Ops New", description: null });
    });

    fireEvent.click(screen.getAllByRole("button", { name: "复制" })[1]!);
    await waitFor(() => {
      expect(mockedCloneRole).toHaveBeenCalledWith("role-ops", {
        slug: "ops_manager_copy",
        name: "Ops Manager Copy",
        description: null
      });
    });

    fireEvent.click(screen.getAllByRole("button", { name: "禁用" })[0]!);
    await waitFor(() => {
      expect(mockedDisableRole).toHaveBeenCalledWith("role-ops");
    });

    fireEvent.click(screen.getAllByRole("button", { name: "查看" })[1]!);
    expect(await screen.findByText("Role detail role-ops")).toBeTruthy();
  });
});
