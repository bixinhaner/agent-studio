import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import {
  fetchPortalFolderTasks,
  fetchPortalWorkspaceNodes,
  type PortalWorkspaceNode,
  type PortalWorkspaceTask
} from "../workspace";
import { WorkspaceFolderHome } from "./WorkspaceFolderHome";

vi.mock("../workspace", async (importOriginal) => {
  const original = await importOriginal<typeof import("../workspace")>();
  return {
    ...original,
    fetchPortalFolderTasks: vi.fn(),
    fetchPortalWorkspaceNodes: vi.fn()
  };
});

const file: PortalWorkspaceNode = {
  id: "file-1",
  parent_id: "folder-1",
  kind: "file",
  name: "检查结果.xlsx",
  system_key: null,
  mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  size_bytes: 1024,
  checksum: null,
  state: "active",
  created_by_type: "agent",
  source_thread_id: "task-1",
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z"
};

const task: PortalWorkspaceTask = {
  id: "task-1",
  title: "检查两张考核表",
  status: "regular",
  folder_id: "folder-1",
  file_count: 1,
  created_at: "2026-07-31T00:00:00.000Z",
  updated_at: "2026-07-31T00:00:00.000Z"
};

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "zh-CN");
  vi.mocked(fetchPortalWorkspaceNodes).mockResolvedValue([file]);
  vi.mocked(fetchPortalFolderTasks).mockResolvedValue({
    tasks: [task],
    summary: { task_count: 1, tasks_with_files: 1, file_count: 1 }
  });
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  vi.clearAllMocks();
});

describe("WorkspaceFolderHome", () => {
  it("shows tasks by default and preserves the existing file list under the Files tab", async () => {
    render(
      <PortalI18nProvider>
        <WorkspaceFolderHome
          folderId="folder-1"
          folderName="01 数据与表格"
          onOpenFolder={vi.fn()}
          onOpenFile={vi.fn()}
          onOpenTask={vi.fn()}
          onNewTask={vi.fn()}
        />
      </PortalI18nProvider>
    );

    expect(await screen.findByText("检查两张考核表")).toBeTruthy();
    expect(screen.getByRole("tab", { name: "任务 1" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText("检查结果.xlsx")).toBeNull();

    fireEvent.click(screen.getByRole("tab", { name: "文件 1" }));

    await waitFor(() => {
      expect(screen.getByText("检查结果.xlsx")).toBeTruthy();
    });
    expect(screen.queryByText("检查两张考核表")).toBeNull();
    expect(screen.getByRole("tab", { name: "文件 1" }).getAttribute("aria-selected")).toBe("true");
  });
});
