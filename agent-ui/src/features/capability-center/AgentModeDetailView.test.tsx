import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  updateAgentMode: vi.fn(),
  putAgentModeSkillPackages: vi.fn(),
  putAgentModeWorkspaces: vi.fn(),
  putAgentModeInstructionSources: vi.fn()
}));

vi.mock("./CapabilityPolicyEditor", () => ({
  CapabilityPolicyEditor: (props: { resourceType: string; resourceId: string }) => (
    <section>{`能力授权编辑器 ${props.resourceType} ${props.resourceId}`}</section>
  )
}));

import {
  putAgentModeInstructionSources,
  putAgentModeSkillPackages,
  putAgentModeWorkspaces,
  updateAgentMode
} from "./api";
import { AgentModeDetailView } from "./AgentModeDetailView";
import type { AgentModeRecord, RunProfileRecord, SkillPackageRecord } from "./types";
import type { WorkspaceRecord } from "../resources-center/types";

const mockedUpdateAgentMode = vi.mocked(updateAgentMode);
const mockedPutAgentModeSkillPackages = vi.mocked(putAgentModeSkillPackages);
const mockedPutAgentModeWorkspaces = vi.mocked(putAgentModeWorkspaces);
const mockedPutAgentModeInstructionSources = vi.mocked(putAgentModeInstructionSources);

const runProfiles: RunProfileRecord[] = [
  {
    id: "run-profile-1",
    organizationId: "org-1",
    name: "Coding Default",
    slug: "coding-default",
    description: "",
    status: "active",
    defaultModel: "gpt-5.4",
    allowedModels: ["gpt-5.4"],
    defaultReasoningEffort: "high",
    sandboxMode: "workspace-write",
    approvalPolicy: "never",
    networkAccessEnabled: true,
    webSearchMode: "live",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  },
  {
    id: "run-profile-2",
    organizationId: "org-1",
    name: "Support Default",
    slug: "support-default",
    description: "",
    status: "active",
    defaultModel: "gpt-5.4-mini",
    allowedModels: ["gpt-5.4-mini"],
    defaultReasoningEffort: "medium",
    sandboxMode: "read-only",
    approvalPolicy: "on-request",
    networkAccessEnabled: false,
    webSearchMode: "cached",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  }
];

const skillPackages: SkillPackageRecord[] = [
  {
    id: "skill-package-1",
    organizationId: "org-1",
    name: "Support Tools",
    slug: "support-tools",
    description: "",
    status: "active",
    visibleToUsers: true,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    items: []
  },
  {
    id: "skill-package-2",
    organizationId: "org-1",
    name: "Ops Tools",
    slug: "ops-tools",
    description: "",
    status: "active",
    visibleToUsers: false,
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z",
    items: []
  }
];

const workspaces: WorkspaceRecord[] = [
  {
    id: "workspace-1",
    organizationId: "org-1",
    name: "Workspace A",
    slug: "workspace-a",
    description: "",
    status: "active",
    sourceType: "filesystem",
    rootPath: "/srv/workspace-a",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  },
  {
    id: "workspace-2",
    organizationId: "org-1",
    name: "Workspace B",
    slug: "workspace-b",
    description: "",
    status: "active",
    sourceType: "filesystem",
    rootPath: "/srv/workspace-b",
    createdAt: "2026-03-30T00:00:00.000Z",
    updatedAt: "2026-03-30T00:00:00.000Z"
  }
];

const agentMode: AgentModeRecord = {
  id: "agent-mode-1",
  organizationId: "org-1",
  name: "Coding",
  slug: "coding",
  description: "default",
  status: "active",
  visibleToUsers: true,
  runProfileId: "run-profile-1",
  skillPackages: [{ id: "binding-1", skillPackageId: "skill-package-1", createdAt: "", updatedAt: "" }],
  workspaceRules: [
    {
      id: "workspace-rule-1",
      workspaceId: "workspace-1",
      isDefault: true,
      allowDirectorySelection: false,
      directoryScope: "workspace_only",
      loadWorkspaceAgentsMd: false,
      createdAt: "2026-03-30T00:00:00.000Z",
      updatedAt: "2026-03-30T00:00:00.000Z"
    }
  ],
  instructionSources: [
    { id: "source-1", sourceType: "inline_text", sourceRef: "Always write tests first.", sortOrder: 0, createdAt: "", updatedAt: "" }
  ],
  createdAt: "2026-03-30T00:00:00.000Z",
  updatedAt: "2026-03-30T00:00:00.000Z"
};

describe("AgentModeDetailView", () => {
  beforeEach(() => {
    mockedUpdateAgentMode.mockReset();
    mockedPutAgentModeSkillPackages.mockReset();
    mockedPutAgentModeWorkspaces.mockReset();
    mockedPutAgentModeInstructionSources.mockReset();
  });

  it("saves basic fields, bindings, and instruction sources in order", async () => {
    const onAgentModeUpdated = vi.fn();

    mockedUpdateAgentMode.mockResolvedValue({
      agentMode: {
        ...agentMode,
        name: "Coding Updated",
        slug: "coding-updated",
        description: "updated",
        status: "disabled",
        visibleToUsers: false,
        runProfileId: "run-profile-2"
      }
    });
    mockedPutAgentModeSkillPackages.mockResolvedValue({
      agentMode: {
        ...agentMode,
        runProfileId: "run-profile-2",
        skillPackages: [
          { id: "binding-1", skillPackageId: "skill-package-1", createdAt: "", updatedAt: "" },
          { id: "binding-2", skillPackageId: "skill-package-2", createdAt: "", updatedAt: "" }
        ]
      }
    });
    mockedPutAgentModeWorkspaces.mockResolvedValue({
      agentMode: {
        ...agentMode,
        runProfileId: "run-profile-2",
        workspaceRules: [
          {
            id: "workspace-rule-1",
            workspaceId: "workspace-1",
            isDefault: false,
            allowDirectorySelection: true,
            directoryScope: "authorized_workspace_and_knowledge_set",
            loadWorkspaceAgentsMd: true,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z"
          },
          {
            id: "workspace-rule-2",
            workspaceId: "workspace-2",
            isDefault: true,
            allowDirectorySelection: false,
            directoryScope: "descendants_only",
            loadWorkspaceAgentsMd: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z"
          }
        ]
      }
    });
    mockedPutAgentModeInstructionSources.mockResolvedValue({
      agentMode: {
        ...agentMode,
        name: "Coding Updated",
        slug: "coding-updated",
        description: "updated",
        status: "disabled",
        visibleToUsers: false,
        runProfileId: "run-profile-2",
        skillPackages: [
          { id: "binding-1", skillPackageId: "skill-package-2", createdAt: "", updatedAt: "" }
        ],
        workspaceRules: [
          {
            id: "workspace-rule-1",
            workspaceId: "workspace-1",
            isDefault: false,
            allowDirectorySelection: true,
            directoryScope: "authorized_workspace_and_knowledge_set",
            loadWorkspaceAgentsMd: true,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z"
          },
          {
            id: "workspace-rule-2",
            workspaceId: "workspace-2",
            isDefault: true,
            allowDirectorySelection: false,
            directoryScope: "descendants_only",
            loadWorkspaceAgentsMd: false,
            createdAt: "2026-03-30T00:00:00.000Z",
            updatedAt: "2026-03-30T00:00:00.000Z"
          }
        ],
        instructionSources: [
          {
            id: "source-1",
            sourceType: "workspace_agents_md",
            sourceRef: "workspace-2",
            sortOrder: 0,
            createdAt: "",
            updatedAt: ""
          },
          {
            id: "source-2",
            sourceType: "knowledge_set_document",
            sourceRef: "knowledge-set-1#/docs/intro.md",
            sortOrder: 1,
            createdAt: "",
            updatedAt: ""
          }
        ]
      }
    });

    render(
      <AgentModeDetailView
        agentMode={agentMode}
        runProfiles={runProfiles}
        skillPackages={skillPackages}
        workspaces={workspaces}
        onAgentModeUpdated={onAgentModeUpdated}
      />
    );

    fireEvent.change(screen.getByLabelText("模式名称"), { target: { value: "Coding Updated" } });
    fireEvent.change(screen.getByLabelText("模式 slug"), { target: { value: "coding-updated" } });
    fireEvent.change(screen.getByLabelText("模式描述"), { target: { value: "updated" } });
    fireEvent.change(screen.getByLabelText("模式状态"), { target: { value: "disabled" } });
    fireEvent.change(screen.getByLabelText("对用户可见"), { target: { value: "hidden" } });

    fireEvent.click(screen.getByRole("tab", { name: "绑定关系" }));
    fireEvent.change(screen.getByLabelText("运行策略"), { target: { value: "run-profile-2" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "Support Tools" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Ops Tools" }));
    fireEvent.click(screen.getByRole("button", { name: "添加工作区" }));
    fireEvent.change(screen.getByLabelText("默认工作区 1"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("允许选择目录 1"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("目录范围 1"), { target: { value: "authorized_workspace_and_knowledge_set" } });
    fireEvent.change(screen.getByLabelText("加载 AGENTS.md 1"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("默认工作区 2"), { target: { value: "true" } });
    fireEvent.change(screen.getByLabelText("允许选择目录 2"), { target: { value: "false" } });
    fireEvent.change(screen.getByLabelText("目录范围 2"), { target: { value: "descendants_only" } });
    fireEvent.change(screen.getByLabelText("加载 AGENTS.md 2"), { target: { value: "false" } });
    fireEvent.click(screen.getByRole("button", { name: "新增指令源" }));
    fireEvent.change(screen.getByLabelText("来源类型 2"), { target: { value: "knowledge_set_document" } });
    fireEvent.change(screen.getByLabelText("来源引用 2"), { target: { value: "knowledge-set-1#/docs/intro.md" } });
    fireEvent.click(screen.getByRole("button", { name: "上移 2" }));
    fireEvent.click(screen.getByRole("button", { name: "保存模式配置" }));

    await waitFor(() => {
      expect(mockedUpdateAgentMode).toHaveBeenCalledWith("agent-mode-1", {
        name: "Coding Updated",
        slug: "coding-updated",
        description: "updated",
        status: "disabled",
        visibleToUsers: false,
        runProfileId: "run-profile-2"
      });
    });
    expect(mockedPutAgentModeSkillPackages).toHaveBeenCalledWith("agent-mode-1", ["skill-package-2"]);
    expect(mockedPutAgentModeWorkspaces).toHaveBeenCalledWith("agent-mode-1", [
      {
        workspaceId: "workspace-1",
        isDefault: false,
        allowDirectorySelection: true,
        directoryScope: "authorized_workspace_and_knowledge_set",
        loadWorkspaceAgentsMd: true
      },
      {
        workspaceId: "workspace-2",
        isDefault: true,
        allowDirectorySelection: false,
        directoryScope: "descendants_only",
        loadWorkspaceAgentsMd: false
      }
    ]);
    expect(mockedPutAgentModeInstructionSources).toHaveBeenCalledWith("agent-mode-1", [
      {
        sourceType: "knowledge_set_document",
        sourceRef: "knowledge-set-1#/docs/intro.md",
        sortOrder: 0
      },
      {
        sourceType: "inline_text",
        sourceRef: "Always write tests first.",
        sortOrder: 1
      }
    ]);
    expect(onAgentModeUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: "Coding Updated" }));
    expect(await screen.findByText("模式已保存")).toBeTruthy();
  });

  it("shows the authorization tab through the shared capability policy editor", async () => {
    render(
      <AgentModeDetailView
        agentMode={agentMode}
        runProfiles={runProfiles}
        skillPackages={skillPackages}
        workspaces={workspaces}
        onAgentModeUpdated={vi.fn()}
      />
    );

    fireEvent.click(screen.getByRole("tab", { name: "授权" }));
    expect(screen.getByText("能力授权编辑器 agent_mode agent-mode-1")).toBeTruthy();
  });
});
