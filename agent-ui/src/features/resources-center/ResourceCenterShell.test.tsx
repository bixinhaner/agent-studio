import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchWorkspaces: vi.fn(),
  fetchKnowledgeSets: vi.fn()
}));

import { fetchKnowledgeSets, fetchWorkspaces } from "./api";
import { ResourceCenterShell } from "./ResourceCenterShell";

const mockedFetchWorkspaces = vi.mocked(fetchWorkspaces);
const mockedFetchKnowledgeSets = vi.mocked(fetchKnowledgeSets);

describe("ResourceCenterShell", () => {
  beforeEach(() => {
    mockedFetchWorkspaces.mockReset();
    mockedFetchKnowledgeSets.mockReset();
  });

  it("loads workspaces and knowledge sets through the typed resource-center API", async () => {
    mockedFetchWorkspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          name: "docs-workspace",
          slug: "docs-workspace",
          description: "docs",
          status: "active",
          sourceType: "filesystem",
          rootPath: "/workspace/docs",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchKnowledgeSets.mockResolvedValue({
      knowledgeSets: [
        {
          id: "knowledge-set-1",
          name: "FAQ",
          slug: "faq",
          description: "answers",
          status: "active",
          sourceType: "managed_upload",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });

    render(<ResourceCenterShell />);

    expect(await screen.findByRole("heading", { name: "资源配置中心" })).toBeTruthy();
    expect(await screen.findByText("docs-workspace")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "资料集" }));
    expect(await screen.findByText("FAQ")).toBeTruthy();
  });

  it("filters the active resource list and shows placeholder detail mount points", async () => {
    mockedFetchWorkspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          name: "docs-workspace",
          slug: "docs-workspace",
          description: "",
          status: "active",
          sourceType: "filesystem",
          rootPath: "/workspace/docs",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        },
        {
          id: "workspace-2",
          name: "legacy-workspace",
          slug: "legacy-workspace",
          description: "",
          status: "disabled",
          sourceType: "filesystem",
          rootPath: "/workspace/legacy",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchKnowledgeSets.mockResolvedValue({ knowledgeSets: [] });

    render(<ResourceCenterShell />);

    expect(await screen.findByText("docs-workspace")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("搜索资源"), { target: { value: "legacy" } });
    expect(screen.queryByText("docs-workspace")).toBeNull();
    expect(screen.getByText("legacy-workspace")).toBeTruthy();
    fireEvent.change(screen.getByLabelText("状态筛选"), { target: { value: "active" } });
    expect(screen.queryByText("legacy-workspace")).toBeNull();
    fireEvent.change(screen.getByLabelText("搜索资源"), { target: { value: "" } });
    expect(screen.getByText("请选择左侧资源以继续配置。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "新建工作区" })).toBeTruthy();
  });
});
