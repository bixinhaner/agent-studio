import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchWorkspaces: vi.fn(),
  fetchKnowledgeSets: vi.fn(),
  createWorkspace: vi.fn(),
  createKnowledgeSet: vi.fn()
}));

vi.mock("./WorkspaceDetailView", () => ({
  WorkspaceDetailView: ({ workspace }: { workspace: { name: string } }) => <section>详情: {workspace.name}</section>
}));

vi.mock("./KnowledgeSetDetailView", () => ({
  KnowledgeSetDetailView: ({ knowledgeSet }: { knowledgeSet: { name: string } }) => <section>资料集详情: {knowledgeSet.name}</section>
}));

import { createKnowledgeSet, createWorkspace, fetchKnowledgeSets, fetchWorkspaces } from "./api";
import { ResourceCenterShell } from "./ResourceCenterShell";

const mockedCreateWorkspace = vi.mocked(createWorkspace);
const mockedCreateKnowledgeSet = vi.mocked(createKnowledgeSet);
const mockedFetchWorkspaces = vi.mocked(fetchWorkspaces);
const mockedFetchKnowledgeSets = vi.mocked(fetchKnowledgeSets);

describe("ResourceCenterShell", () => {
  beforeEach(() => {
    mockedCreateWorkspace.mockReset();
    mockedCreateKnowledgeSet.mockReset();
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

  it("resets an invalid managed_upload filter when switching back to the workspace tab", async () => {
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
        }
      ]
    });
    mockedFetchKnowledgeSets.mockResolvedValue({
      knowledgeSets: [
        {
          id: "knowledge-set-1",
          name: "Uploads",
          slug: "uploads",
          description: "",
          status: "active",
          sourceType: "managed_upload",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "资料集" }));
    fireEvent.change(screen.getByLabelText("类型筛选"), { target: { value: "managed_upload" } });
    expect(screen.getByText("Uploads")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "工作区" }));

    expect(await screen.findByText("docs-workspace")).toBeTruthy();
    expect((screen.getByLabelText("类型筛选") as HTMLSelectElement).value).toBe("all");
  });

  it("mounts the workspace detail view when a workspace is selected", async () => {
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
        }
      ]
    });
    mockedFetchKnowledgeSets.mockResolvedValue({ knowledgeSets: [] });

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("button", { name: /docs-workspace/i }));

    expect(await screen.findByText("详情: docs-workspace")).toBeTruthy();
  });

  it("mounts the knowledge-set detail view when a knowledge set is selected", async () => {
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchKnowledgeSets.mockResolvedValue({
      knowledgeSets: [
        {
          id: "knowledge-set-1",
          name: "FAQ",
          slug: "faq",
          description: "",
          status: "active",
          sourceType: "managed_upload",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "资料集" }));
    fireEvent.click(await screen.findByRole("button", { name: /faq/i }));

    expect(await screen.findByText("资料集详情: FAQ")).toBeTruthy();
  });

  it("creates a workspace, appends it to the list, and mounts its detail view", async () => {
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchKnowledgeSets.mockResolvedValue({ knowledgeSets: [] });
    mockedCreateWorkspace.mockResolvedValue({
      workspace: {
        id: "workspace-new",
        name: "New Workspace",
        slug: "new-workspace",
        description: "",
        status: "active",
        sourceType: "filesystem",
        rootPath: "/srv/docs",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("button", { name: "新建工作区" }));
    fireEvent.change(screen.getByLabelText("新建工作区名称"), { target: { value: "New Workspace" } });
    fireEvent.change(screen.getByLabelText("新建工作区 slug"), { target: { value: "new-workspace" } });
    fireEvent.change(screen.getByLabelText("新建工作区根目录"), { target: { value: "/srv/docs" } });
    fireEvent.click(screen.getByRole("button", { name: "保存新工作区" }));

    expect(mockedCreateWorkspace).toHaveBeenCalledWith({
      name: "New Workspace",
      slug: "new-workspace",
      description: "",
      status: "active",
      sourceType: "filesystem",
      rootPath: "/srv/docs"
    });
    expect(await screen.findByText("New Workspace")).toBeTruthy();
    expect(await screen.findByText("详情: New Workspace")).toBeTruthy();
  });

  it("creates a knowledge set with source-type specific fields and mounts its detail view", async () => {
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchKnowledgeSets.mockResolvedValue({ knowledgeSets: [] });
    mockedCreateKnowledgeSet.mockResolvedValue({
      knowledgeSet: {
        id: "knowledge-set-new",
        name: "FAQ",
        slug: "faq",
        description: "",
        status: "active",
        sourceType: "managed_upload",
        storageKey: "faq-storage",
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "资料集" }));
    fireEvent.click(screen.getByRole("button", { name: "新建资料集" }));
    fireEvent.change(screen.getByLabelText("新建资料集名称"), { target: { value: "FAQ" } });
    fireEvent.change(screen.getByLabelText("新建资料集 slug"), { target: { value: "faq" } });
    fireEvent.change(screen.getByLabelText("新建资料集类型"), { target: { value: "managed_upload" } });
    fireEvent.change(screen.getByLabelText("新建资料集存储键"), { target: { value: "faq-storage" } });
    fireEvent.click(screen.getByRole("button", { name: "保存新资料集" }));

    expect(mockedCreateKnowledgeSet).toHaveBeenCalledWith({
      name: "FAQ",
      slug: "faq",
      description: "",
      status: "active",
      sourceType: "managed_upload",
      storageKey: "faq-storage"
    });
    expect(await screen.findByText("FAQ")).toBeTruthy();
    expect(await screen.findByText("资料集详情: FAQ")).toBeTruthy();
  });

  it("shows create errors and supports canceling the create panel", async () => {
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchKnowledgeSets.mockResolvedValue({ knowledgeSets: [] });
    mockedCreateWorkspace.mockRejectedValue(new Error("create failed"));

    render(<ResourceCenterShell />);

    fireEvent.click(await screen.findByRole("button", { name: "新建工作区" }));
    fireEvent.change(screen.getByLabelText("新建工作区名称"), { target: { value: "Broken" } });
    fireEvent.change(screen.getByLabelText("新建工作区 slug"), { target: { value: "broken" } });
    fireEvent.change(screen.getByLabelText("新建工作区根目录"), { target: { value: "/srv/broken" } });
    fireEvent.click(screen.getByRole("button", { name: "保存新工作区" }));

    expect(await screen.findByText("create failed")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "取消创建" }));
    expect(screen.queryByLabelText("新建工作区名称")).toBeNull();
  });
});
