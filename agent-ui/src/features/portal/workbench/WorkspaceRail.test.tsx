import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { fetchPortalWorkspaceNodes, type PortalWorkspaceNode } from "../workspace";
import { WORKSPACE_RAIL_TASK_LIMIT, WorkspaceRail } from "./WorkspaceRail";

vi.mock("../workspace", async (importOriginal) => {
  const original = await importOriginal<typeof import("../workspace")>();
  return {
    ...original,
    fetchPortalWorkspaceNodes: vi.fn()
  };
});

function folder(id: string, name: string, parentId: string | null = null): PortalWorkspaceNode {
  return {
    id,
    parent_id: parentId,
    kind: "folder",
    name,
    system_key: null,
    mime_type: null,
    size_bytes: null,
    checksum: null,
    state: "active",
    created_by_type: "user",
    source_thread_id: null,
    created_at: "2026-07-27T00:00:00.000Z",
    updated_at: "2026-07-27T00:00:00.000Z"
  };
}

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "zh-CN");
  vi.mocked(fetchPortalWorkspaceNodes).mockReset();
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("WorkspaceRail", () => {
  it("loads child folders when expanded and keeps folder navigation separate", async () => {
    const onSelectFolder = vi.fn();
    vi.mocked(fetchPortalWorkspaceNodes).mockResolvedValue([folder("child-1", "01 数据与表格", "root-1")]);

    render(
      <PortalI18nProvider>
        <WorkspaceRail
          workspace={null}
          rootNodes={[folder("root-1", "员工AI培训")]}
          selectedFolderId=""
          searchValue=""
          onSearchChange={vi.fn()}
          onSelectFolder={onSelectFolder}
          onCreateFolder={vi.fn()}
          onNewTask={vi.fn()}
          onViewAllTasks={vi.fn()}
        />
      </PortalI18nProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: "展开员工AI培训" }));
    expect(await screen.findByRole("button", { name: "01 数据与表格" })).toBeTruthy();
    expect(fetchPortalWorkspaceNodes).toHaveBeenCalledWith("root-1");
    expect(onSelectFolder).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "01 数据与表格" }));
    expect(onSelectFolder).toHaveBeenCalledWith("child-1");
  });

  it("restores the selected folder new-task action and a task preview capped at five items", () => {
    const onNewTask = vi.fn();
    const onViewAllTasks = vi.fn();

    render(
      <PortalI18nProvider>
        <WorkspaceRail
          workspace={null}
          rootNodes={[folder("root-1", "员工AI培训")]}
          selectedFolderId="root-1"
          searchValue=""
          unreadFolderIds={new Set(["root-1"])}
          taskList={
            <>
              {Array.from({ length: WORKSPACE_RAIL_TASK_LIMIT }, (_, index) => (
                <button type="button" key={index}>{`任务 ${index + 1}`}</button>
              ))}
            </>
          }
          taskCount={6}
          onSearchChange={vi.fn()}
          onSelectFolder={vi.fn()}
          onCreateFolder={vi.fn()}
          onNewTask={onNewTask}
          onViewAllTasks={onViewAllTasks}
        />
      </PortalI18nProvider>
    );

    expect(screen.getAllByText(/^任务 \d$/)).toHaveLength(5);
    expect(screen.getByLabelText("未读任务")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新任务" }));
    expect(onNewTask).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole("button", { name: "查看全部 6 个任务" }));
    expect(onViewAllTasks).toHaveBeenCalledOnce();
  });
});
