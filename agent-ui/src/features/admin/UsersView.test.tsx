import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchAdminUsers: vi.fn(),
  patchAdminUserLocalSettings: vi.fn()
}));

import { fetchAdminUsers, patchAdminUserLocalSettings } from "./api";
import { UsersView } from "./UsersView";

const mockedFetchAdminUsers = vi.mocked(fetchAdminUsers);
const mockedPatchAdminUserLocalSettings = vi.mocked(patchAdminUserLocalSettings);

describe("UsersView", () => {
  beforeEach(() => {
    mockedFetchAdminUsers.mockReset();
    mockedPatchAdminUserLocalSettings.mockReset();
  });

  it("submits only local governance fields", async () => {
    mockedFetchAdminUsers.mockResolvedValue({
      users: [
        {
          id: "user-1",
          synced: {
            displayName: "Alice",
            email: "alice@example.com",
            dingtalkUserId: "ding-u1",
            dingtalkOpenId: null,
            dingtalkCorpId: null,
            departmentIds: ["dept-rd"],
            primaryDepartmentId: "dept-rd"
          },
          local: {
            role: "employee",
            manualDisabled: false,
            adminNote: null
          },
          effective: {
            status: "active",
            statusSource: "sync",
            syncState: "active",
            lastSyncedAt: "2026-03-29T10:00:00.000Z"
          }
        }
      ]
    });
    mockedPatchAdminUserLocalSettings.mockResolvedValue({
      user: {
        id: "user-1",
        synced: {
          displayName: "Alice",
          email: "alice@example.com",
          dingtalkUserId: "ding-u1",
          dingtalkOpenId: null,
          dingtalkCorpId: null,
          departmentIds: ["dept-rd"],
          primaryDepartmentId: "dept-rd"
        },
        local: {
          role: "admin",
          manualDisabled: true,
          adminNote: "temporary hold"
        },
        effective: {
          status: "disabled",
          statusSource: "manual_disable",
          syncState: "active",
          lastSyncedAt: "2026-03-29T10:00:00.000Z"
        }
      }
    });

    render(<UsersView />);

    expect(await screen.findByText("Alice")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "编辑 Alice" }));
    fireEvent.change(screen.getByLabelText("角色"), { target: { value: "admin" } });
    fireEvent.click(screen.getByLabelText("手动禁用"));
    fireEvent.change(screen.getByLabelText("备注"), { target: { value: "temporary hold" } });
    fireEvent.click(screen.getByRole("button", { name: "保存" }));

    await waitFor(() => {
      expect(mockedPatchAdminUserLocalSettings).toHaveBeenCalledWith("user-1", {
        role: "admin",
        manualDisabled: true,
        adminNote: "temporary hold"
      });
    });
  });

  it("filters users by synced profile text", async () => {
    mockedFetchAdminUsers.mockResolvedValue({
      users: [
        {
          id: "user-1",
          synced: {
            displayName: "Alice",
            email: "alice@example.com",
            dingtalkUserId: "ding-u1",
            dingtalkOpenId: null,
            dingtalkCorpId: null,
            departmentIds: ["dept-rd"],
            primaryDepartmentId: "dept-rd"
          },
          local: {
            role: "employee",
            manualDisabled: false,
            adminNote: null
          },
          effective: {
            status: "active",
            statusSource: "sync",
            syncState: "active",
            lastSyncedAt: "2026-03-29T10:00:00.000Z"
          }
        },
        {
          id: "user-2",
          synced: {
            displayName: "Bob",
            email: "bob@example.com",
            dingtalkUserId: "ding-u2",
            dingtalkOpenId: null,
            dingtalkCorpId: null,
            departmentIds: ["dept-ops"],
            primaryDepartmentId: "dept-ops"
          },
          local: {
            role: "admin",
            manualDisabled: false,
            adminNote: null
          },
          effective: {
            status: "active",
            statusSource: "sync",
            syncState: "active",
            lastSyncedAt: "2026-03-29T10:00:00.000Z"
          }
        }
      ]
    });

    render(<UsersView />);

    expect(await screen.findByText("Alice")).toBeTruthy();
    expect(screen.getByText("Bob")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("搜索用户"), { target: { value: "bob@" } });

    await waitFor(() => {
      expect(screen.queryByText("Alice")).toBeNull();
      expect(screen.getByText("Bob")).toBeTruthy();
    });
  });
});
