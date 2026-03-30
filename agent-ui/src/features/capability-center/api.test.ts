import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../lib/api", () => ({
  api: vi.fn(),
  apiBase: () => "http://127.0.0.1:8787",
  authHeaders: () => ({ Authorization: "Bearer test-token" }),
  notifyAuthInvalidStatus: vi.fn()
}));

import { api } from "../../lib/api";
import {
  copyAgentMode,
  copyRunProfile,
  copySkillPackage,
  createAgentMode,
  createRunProfile,
  createSkillPackage,
  fetchAgentModes,
  fetchCapabilityPolicies,
  fetchRunProfiles,
  fetchSkillPackages,
  putAgentModeInstructionSources,
  putAgentModeSkillPackages,
  putAgentModeWorkspaces,
  putCapabilityPolicies,
  putSkillPackageItems,
  putSkillPackageRuntimeBindings,
  updateAgentMode,
  updateRunProfile,
  updateSkillPackage
} from "./api";

const mockedApi = vi.mocked(api);

describe("capability center api helpers", () => {
  beforeEach(() => {
    mockedApi.mockReset();
  });

  it("calls the expected admin endpoints for run profiles, skill packages, agent modes, and policies", async () => {
    mockedApi
      .mockResolvedValueOnce({ runProfiles: [] })
      .mockResolvedValueOnce({ runProfile: { id: "run-profile-1" } })
      .mockResolvedValueOnce({ runProfile: { id: "run-profile-1" } })
      .mockResolvedValueOnce({ runProfile: { id: "run-profile-1-copy" } })
      .mockResolvedValueOnce({ skillPackages: [] })
      .mockResolvedValueOnce({ skillPackage: { id: "skill-package-1" } })
      .mockResolvedValueOnce({ skillPackage: { id: "skill-package-1" } })
      .mockResolvedValueOnce({ skillPackage: { id: "skill-package-1-copy" } })
      .mockResolvedValueOnce({ skillPackage: { id: "skill-package-1" } })
      .mockResolvedValueOnce({ skillPackage: { id: "skill-package-1" } })
      .mockResolvedValueOnce({ agentModes: [] })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1" } })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1" } })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1-copy" } })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1" } })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1" } })
      .mockResolvedValueOnce({ agentMode: { id: "agent-mode-1" } })
      .mockResolvedValueOnce({ policies: [] })
      .mockResolvedValueOnce({ policies: [] });

    await fetchRunProfiles();
    await createRunProfile({
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
      webSearchMode: "live"
    });
    await updateRunProfile("run-profile-1", { description: "updated" });
    await copyRunProfile("run-profile-1", { name: "Copy", slug: "copy" });

    await fetchSkillPackages();
    await createSkillPackage({
      name: "Support Tools",
      slug: "support-tools",
      status: "active",
      visibleToUsers: true
    });
    await updateSkillPackage("skill-package-1", { description: "updated" });
    await copySkillPackage("skill-package-1", { name: "Support Tools Copy", slug: "support-tools-copy" });
    await putSkillPackageItems("skill-package-1", [
      {
        capabilityKey: "ticket.search",
        description: "search tickets",
        runtimeBindings: []
      }
    ]);
    await putSkillPackageRuntimeBindings("skill-package-1", [
      {
        capabilityKey: "ticket.search",
        description: "search tickets",
        runtimeBindings: [
          {
            runtimeType: "codex",
            bindingType: "config_fragment",
            bindingPayload: { prompt: "search tickets" }
          }
        ]
      }
    ]);

    await fetchAgentModes();
    await createAgentMode({
      name: "Coding",
      slug: "coding",
      status: "active",
      visibleToUsers: true,
      runProfileId: "run-profile-1"
    });
    await updateAgentMode("agent-mode-1", { description: "updated" });
    await copyAgentMode("agent-mode-1", { name: "Coding Copy", slug: "coding-copy" });
    await putAgentModeSkillPackages("agent-mode-1", ["skill-package-1"]);
    await putAgentModeWorkspaces("agent-mode-1", [
      {
        workspaceId: "workspace-1",
        isDefault: true,
        allowDirectorySelection: true,
        directoryScope: "authorized_workspace_and_knowledge_set",
        loadWorkspaceAgentsMd: true
      }
    ]);
    await putAgentModeInstructionSources("agent-mode-1", [
      {
        sourceType: "inline_text",
        sourceRef: "You are concise.",
        sortOrder: 0
      }
    ]);

    await fetchCapabilityPolicies("agent_mode", "agent-mode-1");
    await putCapabilityPolicies("skill_package", "skill-package-1", [
      { subjectType: "role", subjectId: "employee", effect: "allow" }
    ]);

    expect(mockedApi).toHaveBeenNthCalledWith(1, "/api/admin/run-profiles");
    expect(mockedApi).toHaveBeenNthCalledWith(2, "/api/admin/run-profiles", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(3, "/api/admin/run-profiles/run-profile-1", expect.objectContaining({ method: "PATCH" }));
    expect(mockedApi).toHaveBeenNthCalledWith(
      4,
      "/api/admin/run-profiles/run-profile-1/copy",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(5, "/api/admin/skill-packages");
    expect(mockedApi).toHaveBeenNthCalledWith(6, "/api/admin/skill-packages", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(
      7,
      "/api/admin/skill-packages/skill-package-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      8,
      "/api/admin/skill-packages/skill-package-1/copy",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      9,
      "/api/admin/skill-packages/skill-package-1/items",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      10,
      "/api/admin/skill-packages/skill-package-1/runtime-bindings",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(11, "/api/admin/agent-modes");
    expect(mockedApi).toHaveBeenNthCalledWith(12, "/api/admin/agent-modes", expect.objectContaining({ method: "POST" }));
    expect(mockedApi).toHaveBeenNthCalledWith(
      13,
      "/api/admin/agent-modes/agent-mode-1",
      expect.objectContaining({ method: "PATCH" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      14,
      "/api/admin/agent-modes/agent-mode-1/copy",
      expect.objectContaining({ method: "POST" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      15,
      "/api/admin/agent-modes/agent-mode-1/skill-packages",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      16,
      "/api/admin/agent-modes/agent-mode-1/workspaces",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(
      17,
      "/api/admin/agent-modes/agent-mode-1/instruction-sources",
      expect.objectContaining({ method: "PUT" })
    );
    expect(mockedApi).toHaveBeenNthCalledWith(18, "/api/admin/resources/agent-modes/agent-mode-1/policies");
    expect(mockedApi).toHaveBeenNthCalledWith(
      19,
      "/api/admin/resources/skill-packages/skill-package-1/policies",
      expect.objectContaining({ method: "PUT" })
    );
  });
});
