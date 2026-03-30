import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchWorkspaceKnowledgeSetBindings: vi.fn(),
  updateWorkspace: vi.fn(),
  putWorkspaceKnowledgeSetBindings: vi.fn()
}));

vi.mock("./ResourcePolicyEditor", () => ({
  ResourcePolicyEditor: () => <section>资源策略编辑器</section>
}));

import {
  fetchWorkspaceKnowledgeSetBindings,
  putWorkspaceKnowledgeSetBindings,
  updateWorkspace
} from "./api";
import type { KnowledgeSetRecord, WorkspaceRecord } from "./types";
import { WorkspaceDetailView } from "./WorkspaceDetailView";

const mockedFetchBindings = vi.mocked(fetchWorkspaceKnowledgeSetBindings);
const mockedUpdateWorkspace = vi.mocked(updateWorkspace);
const mockedPutBindings = vi.mocked(putWorkspaceKnowledgeSetBindings);

const workspace: WorkspaceRecord = {
  id: "workspace-1",
  organizationId: "org-1",
  name: "Docs Workspace",
  slug: "docs-workspace",
  description: "Primary docs",
  status: "active",
  sourceType: "filesystem",
  rootPath: "/workspace/docs",
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z"
};

const knowledgeSets: KnowledgeSetRecord[] = [
  {
    id: "ks-1",
    organizationId: "org-1",
    name: "FAQ",
    slug: "faq",
    description: "",
    status: "active",
    sourceType: "managed_upload",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  },
  {
    id: "ks-2",
    organizationId: "org-1",
    name: "Runbooks",
    slug: "runbooks",
    description: "",
    status: "active",
    sourceType: "managed_upload",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  }
];

describe("WorkspaceDetailView", () => {
  beforeEach(() => {
    mockedFetchBindings.mockReset();
    mockedUpdateWorkspace.mockReset();
    mockedPutBindings.mockReset();
  });

  it("saves workspace metadata and bindings", async () => {
    mockedFetchBindings.mockResolvedValue({
      bindings: [{ knowledgeSetId: "ks-1", mountType: "default" }]
    });
    mockedUpdateWorkspace.mockResolvedValue({
      workspace: {
        ...workspace,
        name: "Updated Workspace",
        description: "Updated docs"
      }
    });
    mockedPutBindings.mockResolvedValue({
      bindings: [
        { knowledgeSetId: "ks-1", mountType: "default" },
        { knowledgeSetId: "ks-2", mountType: "optional" }
      ]
    });

    const onWorkspaceUpdated = vi.fn();

    render(
      <WorkspaceDetailView
        workspace={workspace}
        knowledgeSets={knowledgeSets}
        onWorkspaceUpdated={onWorkspaceUpdated}
      />
    );

    expect(await screen.findByText("资源策略编辑器")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("工作区名称"), { target: { value: "Updated Workspace" } });
    fireEvent.change(screen.getByLabelText("工作区描述"), { target: { value: "Updated docs" } });
    fireEvent.click(screen.getByLabelText("绑定资料集 Runbooks"));

    await waitFor(() => {
      expect(screen.getByLabelText("挂载方式 Runbooks")).toBeTruthy();
    });
    fireEvent.change(screen.getByLabelText("挂载方式 Runbooks"), { target: { value: "optional" } });

    fireEvent.click(screen.getByRole("button", { name: "保存工作区配置" }));

    await waitFor(() => {
      expect(mockedUpdateWorkspace).toHaveBeenCalledWith("workspace-1", {
        name: "Updated Workspace",
        slug: "docs-workspace",
        description: "Updated docs",
        status: "active",
        rootPath: "/workspace/docs"
      });
    });
    expect(mockedPutBindings).toHaveBeenCalledWith("workspace-1", [
      { knowledgeSetId: "ks-1", mountType: "default" },
      { knowledgeSetId: "ks-2", mountType: "optional" }
    ]);
    expect(onWorkspaceUpdated).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "workspace-1",
        name: "Updated Workspace",
        description: "Updated docs"
      })
    );
  });
});
