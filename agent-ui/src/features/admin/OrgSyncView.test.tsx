import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchOrgSyncConfig: vi.fn(),
  fetchOrgSyncJobs: vi.fn(),
  triggerFullOrgSync: vi.fn(),
  triggerDepartmentOrgSync: vi.fn(),
  triggerUserOrgSync: vi.fn()
}));

import {
  fetchOrgSyncConfig,
  fetchOrgSyncJobs,
  triggerDepartmentOrgSync,
  triggerFullOrgSync,
  triggerUserOrgSync
} from "./api";
import { OrgSyncView } from "./OrgSyncView";

const mockedFetchOrgSyncConfig = vi.mocked(fetchOrgSyncConfig);
const mockedFetchOrgSyncJobs = vi.mocked(fetchOrgSyncJobs);
const mockedTriggerFullOrgSync = vi.mocked(triggerFullOrgSync);
const mockedTriggerDepartmentOrgSync = vi.mocked(triggerDepartmentOrgSync);
const mockedTriggerUserOrgSync = vi.mocked(triggerUserOrgSync);

describe("OrgSyncView", () => {
  beforeEach(() => {
    mockedFetchOrgSyncConfig.mockReset();
    mockedFetchOrgSyncJobs.mockReset();
    mockedTriggerFullOrgSync.mockReset();
    mockedTriggerDepartmentOrgSync.mockReset();
    mockedTriggerUserOrgSync.mockReset();
  });

  it("renders jobs and triggers org sync actions", async () => {
    mockedFetchOrgSyncConfig.mockResolvedValue({
      orgSync: {
        enabled: true,
        intervalMinutes: 1440
      }
    });
    mockedFetchOrgSyncJobs.mockResolvedValue({
      jobs: [
        {
          id: "job-1",
          status: "succeeded",
          provider: "dingtalk",
          scopeType: "full",
          scopeExternalId: null,
          triggerType: "manual",
          triggeredByUserId: "admin-1",
          startedAt: "2026-03-29T08:00:00.000Z",
          finishedAt: "2026-03-29T08:01:00.000Z",
          createdAt: "2026-03-29T08:00:00.000Z",
          updatedAt: "2026-03-29T08:01:00.000Z",
          summary: { totalUsers: 2 }
        }
      ]
    });
    mockedTriggerFullOrgSync.mockResolvedValue({
      job: { id: "job-2", status: "succeeded", summary: null }
    });
    mockedTriggerDepartmentOrgSync.mockResolvedValue({
      job: { id: "job-3", status: "succeeded", summary: null }
    });
    mockedTriggerUserOrgSync.mockResolvedValue({
      job: { id: "job-4", status: "succeeded", summary: null }
    });

    render(<OrgSyncView />);

    expect(await screen.findByText("同步任务")).toBeTruthy();
    expect(await screen.findByText(/每日同步/)).toBeTruthy();
    expect(await screen.findByText(/job-1/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "立即全量同步" }));
    await waitFor(() => {
      expect(mockedTriggerFullOrgSync).toHaveBeenCalled();
    });

    fireEvent.change(screen.getByLabelText("部门 External ID"), { target: { value: "dept-rd" } });
    fireEvent.click(screen.getByRole("button", { name: "按部门同步" }));
    await waitFor(() => {
      expect(mockedTriggerDepartmentOrgSync).toHaveBeenCalledWith("dept-rd");
    });

    fireEvent.change(screen.getByLabelText("用户 External ID"), { target: { value: "ding-u1" } });
    fireEvent.click(screen.getByRole("button", { name: "按用户补同步" }));
    await waitFor(() => {
      expect(mockedTriggerUserOrgSync).toHaveBeenCalledWith("ding-u1");
    });
  });
});
