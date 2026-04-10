import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { UsersView } from "../UsersView";
import { fetchAdminCustomerOrganizations, fetchAdminUsers } from "../api";

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
            departmentIds: [],
            primaryDepartmentId: null
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
  });

  it("renders the users list", async () => {
    render(<UsersView />);
    expect(screen.getAllByPlaceholderText(/搜索/i).length).toBeGreaterThan(0);

    const userRow = await screen.findByText("John Doe");
    expect(userRow).toBeTruthy();
    expect(await screen.findByRole("button", { name: "创建客户组织" })).toBeTruthy();
  });

  it("filters users by text", async () => {
    render(<UsersView />);
    const searchInputs = screen.getAllByPlaceholderText(/搜索/i);
    fireEvent.change(searchInputs[0], { target: { value: "John" } });
    expect(await screen.findByText("John Doe")).toBeTruthy();
  });
});
