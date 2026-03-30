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

import { createAgentMode, createRunProfile, createSkillPackage, fetchAgentModes, fetchRunProfiles, fetchSkillPackages } from "./api";
import { CapabilityCenterShell } from "./CapabilityCenterShell";

const mockedFetchRunProfiles = vi.mocked(fetchRunProfiles);
const mockedFetchSkillPackages = vi.mocked(fetchSkillPackages);
const mockedFetchAgentModes = vi.mocked(fetchAgentModes);
const mockedCreateRunProfile = vi.mocked(createRunProfile);
const mockedCreateSkillPackage = vi.mocked(createSkillPackage);
const mockedCreateAgentMode = vi.mocked(createAgentMode);

describe("CapabilityCenterShell", () => {
  beforeEach(() => {
    mockedFetchRunProfiles.mockReset();
    mockedFetchSkillPackages.mockReset();
    mockedFetchAgentModes.mockReset();
    mockedCreateRunProfile.mockReset();
    mockedCreateSkillPackage.mockReset();
    mockedCreateAgentMode.mockReset();
  });

  it("loads capability resources through the typed api helpers and starts on agent modes", async () => {
    mockedFetchRunProfiles.mockResolvedValue({ runProfiles: [] });
    mockedFetchSkillPackages.mockResolvedValue({ skillPackages: [] });
    mockedFetchAgentModes.mockResolvedValue({ agentModes: [] });

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
    fireEvent.change(screen.getByLabelText("能力 slug"), { target: { value: "coding-copy" } });
    fireEvent.click(screen.getByRole("button", { name: "创建能力" }));

    expect(mockedCreateAgentMode).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Coding Copy",
        slug: "coding-copy"
      })
    );
    expect(await screen.findByRole("heading", { name: "Coding Copy" })).toBeTruthy();
  });
});
