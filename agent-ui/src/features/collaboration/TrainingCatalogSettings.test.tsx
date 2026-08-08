import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  fetchTrainingCatalogConfiguration,
  fetchTrainingEnglishPrewarm,
  fetchTrainingRootFolders,
  saveTrainingCatalogConfiguration,
  startTrainingEnglishPrewarm
} from "./api";
import { TrainingCatalogSettings } from "./TrainingCatalogSettings";

vi.mock("./api", () => ({
  fetchTrainingCatalogConfiguration: vi.fn(),
  fetchTrainingEnglishPrewarm: vi.fn(),
  fetchTrainingRootFolders: vi.fn(),
  saveTrainingCatalogConfiguration: vi.fn(),
  startTrainingEnglishPrewarm: vi.fn()
}));

const configuration = {
  enabled: true,
  sourceEmail: "like@baicells.com",
  rootFolderName: "员工AI培训",
  validationStatus: "valid" as const,
  validationMessage: "配置有效",
  folderCount: 12,
  threadCount: 54
};

describe("TrainingCatalogSettings", () => {
  it("shows the saved source, visibility boundary, and live validation", async () => {
    vi.mocked(fetchTrainingCatalogConfiguration).mockResolvedValue(configuration);
    vi.mocked(fetchTrainingRootFolders).mockResolvedValue([
      { id: "folder-1", name: "员工AI培训", workspaceId: "workspace-1" }
    ]);
    vi.mocked(saveTrainingCatalogConfiguration).mockResolvedValue(configuration);
    vi.mocked(fetchTrainingEnglishPrewarm).mockResolvedValue({
      status: "idle", totalThreads: 0, completedThreads: 0, totalMessages: 0, completedMessages: 0
    });
    vi.mocked(startTrainingEnglishPrewarm).mockResolvedValue({
      status: "running", totalThreads: 0, completedThreads: 0, totalMessages: 0, completedMessages: 0
    });

    render(<TrainingCatalogSettings users={[{
      source: { userType: "internal_employee" },
      synced: { email: "like@baicells.com", displayName: "李可" },
      effective: { status: "active" }
    } as never]} />);

    expect(await screen.findByText("培训案例配置")).toBeTruthy();
    expect(screen.getByText("仅内部员工")).toBeTruthy();
    expect(screen.getByText("12 个目录 · 54 个会话 · 内容实时同步")).toBeTruthy();
    expect(screen.getByRole("button", { name: "保存配置" }).getAttribute("disabled")).not.toBeNull();

    fireEvent.click(screen.getByRole("switch", { name: "启用培训案例" }));
    expect(screen.getByText("有尚未保存的修改")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "保存配置" }));

    await waitFor(() => expect(saveTrainingCatalogConfiguration).toHaveBeenCalledWith({
      enabled: false,
      sourceEmail: "like@baicells.com",
      rootFolderName: "员工AI培训"
    }));
  });
});
