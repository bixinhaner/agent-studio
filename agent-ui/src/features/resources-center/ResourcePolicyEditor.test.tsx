import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchResourcePolicies: vi.fn(),
  putResourcePolicies: vi.fn()
}));

import { fetchResourcePolicies, putResourcePolicies } from "./api";
import { ResourcePolicyEditor } from "./ResourcePolicyEditor";

const mockedFetchResourcePolicies = vi.mocked(fetchResourcePolicies);
const mockedPutResourcePolicies = vi.mocked(putResourcePolicies);

describe("ResourcePolicyEditor", () => {
  beforeEach(() => {
    mockedFetchResourcePolicies.mockReset();
    mockedPutResourcePolicies.mockReset();
  });

  it("edits and saves single-resource policies", async () => {
    mockedFetchResourcePolicies.mockResolvedValue({
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-1",
          effect: "allow"
        }
      ]
    });
    mockedPutResourcePolicies.mockResolvedValue({
      policies: [
        {
          subjectType: "role",
          subjectId: "employee",
          resourceType: "workspace",
          resourceId: "workspace-1",
          effect: "allow"
        },
        {
          subjectType: "department",
          subjectId: "dept-rd",
          resourceType: "workspace",
          resourceId: "workspace-1",
          effect: "deny"
        }
      ]
    });

    render(
      <ResourcePolicyEditor
        resourceType="workspace"
        resourceId="workspace-1"
        title="资源授权"
      />
    );

    expect(await screen.findByDisplayValue("employee")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "新增策略" }));
    fireEvent.change(screen.getByLabelText("主体类型 2"), { target: { value: "department" } });
    fireEvent.change(screen.getByLabelText("主体标识 2"), { target: { value: "dept-rd" } });
    fireEvent.change(screen.getByLabelText("授权效果 2"), { target: { value: "deny" } });

    fireEvent.click(screen.getByRole("button", { name: "保存资源授权" }));

    await waitFor(() => {
      expect(mockedPutResourcePolicies).toHaveBeenCalledWith("workspace", "workspace-1", [
        { subjectType: "role", subjectId: "employee", effect: "allow" },
        { subjectType: "department", subjectId: "dept-rd", effect: "deny" }
      ]);
    });
  });

  it("keeps save disabled when policies fail to load", async () => {
    mockedFetchResourcePolicies.mockRejectedValue(new Error("load failed"));

    render(
      <ResourcePolicyEditor
        resourceType="workspace"
        resourceId="workspace-1"
        title="资源授权"
      />
    );

    expect(await screen.findByText("load failed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存资源授权" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新增策略" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
