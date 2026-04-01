import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./api", () => ({
  fetchRunProfiles: vi.fn(),
  fetchSkillPackages: vi.fn(),
  fetchAgentModes: vi.fn(),
  createRunProfile: vi.fn(),
  createSkillPackage: vi.fn(),
  createAgentMode: vi.fn()
}));

vi.mock("../resources-center/api", () => ({
  fetchWorkspaces: vi.fn()
}));

import { createAgentMode, createRunProfile, createSkillPackage, fetchAgentModes, fetchRunProfiles, fetchSkillPackages } from "./api";
import { fetchWorkspaces } from "../resources-center/api";
import { CapabilityCenterShell } from "./CapabilityCenterShell";

const mockedFetchRunProfiles = vi.mocked(fetchRunProfiles);
const mockedFetchSkillPackages = vi.mocked(fetchSkillPackages);
const mockedFetchAgentModes = vi.mocked(fetchAgentModes);
const mockedCreateRunProfile = vi.mocked(createRunProfile);
const mockedCreateSkillPackage = vi.mocked(createSkillPackage);
const mockedCreateAgentMode = vi.mocked(createAgentMode);
const mockedFetchWorkspaces = vi.mocked(fetchWorkspaces);

describe("CapabilityCenterShell", () => {
  beforeEach(() => {
    mockedFetchRunProfiles.mockReset();
    mockedFetchSkillPackages.mockReset();
    mockedFetchAgentModes.mockReset();
    mockedCreateRunProfile.mockReset();
    mockedCreateSkillPackage.mockReset();
    mockedCreateAgentMode.mockReset();
    mockedFetchWorkspaces.mockReset();
  });

  it("loads capability resources through the typed api helpers and starts on agent modes", async () => {
    mockedFetchRunProfiles.mockResolvedValue({ runProfiles: [] });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });

    render(<CapabilityCenterShell />);

    expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Agent Modes" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Skill Packages" })).toBeTruthy();
    expect(await screen.findByRole("tab", { name: "Run Profiles" })).toBeTruthy();
    expect(await screen.findByText("没有可用能力资源")).toBeTruthy();
  });

  it("filters capability resources and creates an agent mode from the shell", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchSkillPackages.mockResolvedValue({
      skillPackages: [
        {
          id: "skill-package-1",
          name: "Support Tools",
          slug: "support-tools",
          description: "",
          status: "disabled",
          visibleToUsers: false,
          items: [],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchAgentModes.mockResolvedValue({
      agentModes: [
        {
          id: "agent-mode-1",
          name: "Coding",
          slug: "coding",
          description: "",
          status: "active",
          visibleToUsers: true,
          runProfileId: "run-profile-1",
          skillPackages: [],
          workspaceRules: [],
          instructionSources: [],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedCreateAgentMode.mockResolvedValue({
      agentMode: {
        id: "agent-mode-copy",
        name: "Coding Copy",
        slug: "coding-copy",
        description: "",
        status: "active",
        visibleToUsers: true,
        runProfileId: "run-profile-1",
        skillPackages: [],
        workspaceRules: [],
        instructionSources: [],
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });

    render(<CapabilityCenterShell />);

    expect(await screen.findByText("Coding")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Skill Packages" }));
    expect(await screen.findByText("Support Tools")).toBeTruthy();
    fireEvent.click(screen.getByRole("tab", { name: "Run Profiles" }));
    expect(await screen.findByText("Coding Default")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Agent Modes" }));
    fireEvent.click(screen.getByRole("button", { name: "新建能力资源" }));
    fireEvent.change(screen.getByLabelText("能力名称"), { target: { value: "Coding Copy" } });
    expect((screen.getByLabelText("能力 slug") as HTMLInputElement).value).toBe("coding-copy");
    fireEvent.click(screen.getByRole("button", { name: "创建能力" }));

    expect(mockedCreateAgentMode).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Coding Copy",
        slug: "coding-copy"
      })
    );
    expect(await screen.findByRole("heading", { name: "Coding Copy" })).toBeTruthy();
  });

  it("suggests a unique slug for new agent modes based on the name", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({
      agentModes: [
        {
          id: "agent-mode-1",
          name: "Coding",
          slug: "coding",
          description: "",
          status: "active",
          visibleToUsers: true,
          runProfileId: "run-profile-1",
          skillPackages: [],
          workspaceRules: [],
          instructionSources: [],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });

    render(<CapabilityCenterShell />);

    expect(await screen.findByText("Coding")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "新建能力资源" }));
    fireEvent.change(screen.getByLabelText("能力名称"), { target: { value: "Coding" } });

    expect((screen.getByLabelText("能力 slug") as HTMLInputElement).value).toBe("coding-2");
  });

  it("resets the create draft when switching tabs so the active tab controls the created resource type", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });
    mockedCreateSkillPackage.mockResolvedValue({
      skillPackage: {
        id: "skill-package-2",
        name: "Support Tools",
        slug: "support-tools",
        description: "",
        status: "active",
        visibleToUsers: false,
        items: [],
        createdAt: "2026-03-30T00:00:00.000Z",
        updatedAt: "2026-03-30T00:00:00.000Z"
      }
    });

    render(<CapabilityCenterShell />);

    expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "新建能力资源" }));
    expect(screen.getByLabelText("运行策略")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Skill Packages" }));
    expect(await screen.findByText("Skill Packages")).toBeTruthy();
    expect(screen.queryByLabelText("运行策略")).toBeNull();

    fireEvent.change(screen.getByLabelText("能力名称"), { target: { value: "Support Tools" } });
    fireEvent.change(screen.getByLabelText("能力 slug"), { target: { value: "support-tools" } });
    fireEvent.click(screen.getByRole("button", { name: "创建能力" }));

    expect(mockedCreateAgentMode).not.toHaveBeenCalled();
    expect(mockedCreateSkillPackage).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Support Tools",
        slug: "support-tools"
      })
    );
  });

  it("mounts the run profile detail view when a run profile is selected", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });
    mockedFetchWorkspaces.mockResolvedValue({ workspaces: [] });

    render(<CapabilityCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "Run Profiles" }));
    fireEvent.click((await screen.findByText("Coding Default")).closest("button") as HTMLButtonElement);

    expect(await screen.findByRole("button", { name: "保存运行策略" })).toBeTruthy();
    expect(screen.queryByText("后续任务会在这里接入完整的编辑器、绑定编辑和授权编辑。")).toBeNull();
  });

  it("mounts the agent mode detail view when an agent mode is selected", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchSkillPackages.mockResolvedValue({
      skillPackages: [
        {
          id: "skill-package-1",
          name: "Support Tools",
          slug: "support-tools",
          description: "",
          status: "active",
          visibleToUsers: false,
          items: [],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchAgentModes.mockResolvedValue({
      agentModes: [
        {
          id: "agent-mode-1",
          name: "Coding",
          slug: "coding",
          description: "",
          status: "active",
          visibleToUsers: true,
          runProfileId: "run-profile-1",
          skillPackages: [],
          workspaceRules: [],
          instructionSources: [],
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });
    mockedFetchWorkspaces.mockResolvedValue({
      workspaces: [
        {
          id: "workspace-1",
          organizationId: "org-1",
          name: "Workspace A",
          slug: "workspace-a",
          description: "Workspace A",
          status: "active",
          sourceType: "filesystem",
          rootPath: "/srv/workspace-a",
          createdAt: "2026-03-30T00:00:00.000Z",
          updatedAt: "2026-03-30T00:00:00.000Z"
        }
      ]
    });

    render(<CapabilityCenterShell />);

    fireEvent.click(await screen.findByRole("tab", { name: "Agent Modes" }));
    fireEvent.click(screen.getByRole("button", { name: /Coding/ }));

    expect(await screen.findByRole("button", { name: "保存模式配置" })).toBeTruthy();
    expect(screen.queryByText("后续任务会在这里接入完整的编辑器、绑定编辑和授权编辑。")).toBeNull();
  });

  it("degrades agent mode workspace loading without failing the whole capability center", async () => {
    mockedFetchRunProfiles.mockResolvedValue({
      runProfiles: [
        {
          id: "run-profile-1",
          name: "Coding Default",
          slug: "coding-default",
          description: "default",
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
        }
      ]
    });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });
    mockedFetchWorkspaces.mockRejectedValue(new Error("workspace load failed"));

    render(<CapabilityCenterShell />);

    expect(await screen.findByRole("heading", { name: "能力配置中心" })).toBeTruthy();
    expect(await screen.findByText("工作区加载失败，Agent Mode 绑定编辑已降级：workspace load failed")).toBeTruthy();

    fireEvent.click(screen.getByRole("tab", { name: "Run Profiles" }));
    expect(screen.queryByText("工作区加载失败，Agent Mode 绑定编辑已降级：workspace load failed")).toBeNull();
    expect(await screen.findByText("Coding Default")).toBeTruthy();
  });

});
