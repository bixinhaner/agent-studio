import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PortalI18nProvider } from "../i18n";
import { WorkspaceRail } from "./WorkspaceRail";

beforeEach(() => {
  window.localStorage.setItem("agent-studio.portal.locale.v1", "zh-CN");
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("WorkspaceRail", () => {
  it("keeps the selected folder, its new-task action, and three recent titles in one hierarchy", () => {
    const onNewTask = vi.fn();
    render(
      <PortalI18nProvider>
        <WorkspaceRail
          workspace={null}
          rootNodes={[
            {
              id: "history-1",
              parent_id: null,
              kind: "folder",
              name: "History",
              system_key: "history_unfiled",
              mime_type: null,
              size_bytes: null,
              checksum: null,
              state: "active",
              created_by_type: "migration",
              source_thread_id: null,
              created_at: "2026-07-27T00:00:00.000Z",
              updated_at: "2026-07-27T00:00:00.000Z"
            }
          ]}
          selectedFolderId="history-1"
          searchValue=""
          taskList={<span>最近任务标题</span>}
          taskCount={243}
          onSearchChange={vi.fn()}
          onSelectFolder={vi.fn()}
          onCreateFolder={vi.fn()}
          onNewTask={onNewTask}
          onViewAllTasks={vi.fn()}
        />
      </PortalI18nProvider>
    );

    expect(screen.getByRole("button", { name: "历史任务" })).toBeTruthy();
    expect(screen.getByText("最近任务标题").closest(".workspace-folder-entry")).toBeTruthy();
    expect(screen.getByRole("button", { name: "查看全部 243 个任务" })).toBeTruthy();
    expect(screen.queryByText("最近使用")).toBeNull();
    expect(screen.queryByText("智能体产出")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "新任务" }));
    expect(onNewTask).toHaveBeenCalledOnce();
  });
});
