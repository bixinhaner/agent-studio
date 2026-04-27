import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UsersView } from "../UsersView";
import { fetchAdminCustomerOrganizations, fetchAdminUsers, fetchDepartmentTree } from "../api";

vi.mock("../api");

beforeAll(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn().mockImplementation((query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  });
});

describe("UsersView", () => {
  beforeEach(() => {
    (fetchAdminUsers as any).mockResolvedValue({
      users: [
        {
          id: "1",
          source: {
            userType: "internal_employee",
            primaryOrganizationId: "org_internal",
            identities: [{ provider: "dingtalk", email: "john@example.com", lastLoginAt: new Date().toISOString() }],
            organizations: [
              {
                organizationId: "org_internal",
                organizationSlug: "internal",
                organizationName: "Baicells Internal",
                organizationType: "internal",
                membershipType: "employee",
                status: "active"
              }
            ]
          },
          synced: {
            displayName: "John Doe",
            email: "john@example.com",
            dingtalkUserId: "ding-001",
            departmentIds: ["dept-001", "dept-002"],
            primaryDepartmentId: "dept-001"
          },
          local: { role: "employee", manualDisabled: false, adminNote: null },
          assignedRoles: [],
          primaryRole: null,
          effective: {
            status: "active",
            statusSource: "sync",
            syncState: "active",
            lastSyncedAt: new Date().toISOString()
          }
        }
      ]
    });
    (fetchAdminCustomerOrganizations as any).mockResolvedValue({
      organizations: []
    });
    (fetchDepartmentTree as any).mockResolvedValue({
      departments: [
        {
          id: "dept-node-1",
          organizationId: "org_internal",
          externalId: "dept-001",
          name: "研发部",
          parentDepartmentId: null,
          sortOrder: 0,
          status: "active",
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          memberCount: 3,
          children: []
        },
        {
          id: "dept-node-2",
          organizationId: "org_internal",
          externalId: "dept-002",
          name: "交付部",
          parentDepartmentId: null,
          sortOrder: 1,
          status: "active",
          lastSyncedAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          memberCount: 2,
          children: []
        }
      ]
    });
  });

  it("renders the users list", async () => {
    render(<UsersView />);
    expect(screen.getAllByPlaceholderText(/搜索/i).length).toBeGreaterThan(0);

    const userRow = await screen.findByText("John Doe");
    expect(userRow).toBeTruthy();
    expect(await screen.findByText(/部门: 研发部 .* 交付部/)).toBeTruthy();
    fireEvent.click(await screen.findByRole("tab", { name: "客户组织与邀请" }));
    expect(await screen.findByRole("button", { name: "创建客户组织" })).toBeTruthy();
  });

  it("filters users by text", async () => {
    render(<UsersView />);
    const searchInputs = screen.getAllByPlaceholderText(/搜索/i);
    fireEvent.change(searchInputs[0], { target: { value: "John" } });
    expect(await screen.findByText("John Doe")).toBeTruthy();
  });
});
