import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchCapabilityPolicies: vi.fn(),
  putCapabilityPolicies: vi.fn()
}));

import { fetchCapabilityPolicies, putCapabilityPolicies } from "./api";
import { CapabilityPolicyEditor } from "./CapabilityPolicyEditor";

const mockedFetchCapabilityPolicies = vi.mocked(fetchCapabilityPolicies);
const mockedPutCapabilityPolicies = vi.mocked(putCapabilityPolicies);

describe("CapabilityPolicyEditor", () => {
  beforeEach(() => {
    mockedFetchCapabilityPolicies.mockReset();
    mockedPutCapabilityPolicies.mockReset();
  });

  it("edits and saves single-resource capability policies", async () => {
    mockedFetchCapabilityPolicies.mockResolvedValue({
      policies: [
        {
          id: "policy-1",
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "run-profile-1",
          effect: "allow"
        }
      ]
    });
    mockedPutCapabilityPolicies.mockResolvedValue({
      policies: [
        {
          subjectType: "role",
          subjectId: "employee",
          resourceType: "run_profile",
          resourceId: "run-profile-1",
          effect: "allow"
        },
        {
          subjectType: "department",
          subjectId: "dept-rd",
          resourceType: "run_profile",
          resourceId: "run-profile-1",
          effect: "deny"
        }
      ]
    });

    render(<CapabilityPolicyEditor resourceType="run_profile" resourceId="run-profile-1" />);

    expect(await screen.findByDisplayValue("employee")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "新增策略" }));
    fireEvent.change(screen.getByLabelText("主体类型 2"), { target: { value: "department" } });
    fireEvent.change(screen.getByLabelText("主体标识 2"), { target: { value: "dept-rd" } });
    fireEvent.change(screen.getByLabelText("授权效果 2"), { target: { value: "deny" } });

    fireEvent.click(screen.getByRole("button", { name: "保存授权" }));

    await waitFor(() => {
      expect(mockedPutCapabilityPolicies).toHaveBeenCalledWith("run_profile", "run-profile-1", [
        { subjectType: "role", subjectId: "employee", effect: "allow" },
        { subjectType: "department", subjectId: "dept-rd", effect: "deny" }
      ]);
    });
  });

  it("keeps save disabled when capability policies fail to load", async () => {
    mockedFetchCapabilityPolicies.mockRejectedValue(new Error("load failed"));

    render(<CapabilityPolicyEditor resourceType="skill_package" resourceId="skill-package-1" />);

    expect(await screen.findByText("load failed")).toBeTruthy();
    expect((screen.getByRole("button", { name: "保存授权" }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: "新增策略" }) as HTMLButtonElement).disabled).toBe(true);
  });
});
