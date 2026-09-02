import { api } from "../../lib/api";
import type { CodexManagedSkill, CodexSkillDraft } from "./types";

export type ManagedSkillShareMember = {
  userId: string;
  displayName?: string;
  email?: string;
};

export type ManagedSkillSharingState = {
  skillId: string;
  ownerUserId: string;
  owner?: ManagedSkillShareMember;
  members: ManagedSkillShareMember[];
  availableMembers: ManagedSkillShareMember[];
};

export type ManagedSkillInstallConflict = {
  skillId: string;
  skillName: string;
  ownerUserId: string;
  ownerDisplayName?: string;
  ownerEmail?: string;
  suggestedName: string;
};

export async function createPortalSkillDraft(input: {
  prompt: string;
  threadId?: string;
  modeId?: string;
}): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>("/api/portal/skill-drafts", {
    method: "POST",
    json: {
      prompt: input.prompt,
      thread_id: input.threadId,
      mode_id: input.modeId
    }
  });
}

export async function createPortalSkillDraftFromThreadPath(input: {
  threadId: string;
  path: string;
  prompt?: string;
  modeId?: string;
}): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>("/api/portal/skill-drafts/from-thread-path", {
    method: "POST",
    json: {
      thread_id: input.threadId,
      path: input.path,
      prompt: input.prompt,
      mode_id: input.modeId
    }
  });
}

export async function installPortalSkillFromThreadPath(input: {
  threadId: string;
  path: string;
  prompt?: string;
  modeId?: string;
  conflictAction?: "fork";
}): Promise<{ skill: CodexManagedSkill }> {
  return api<{ skill: CodexManagedSkill }>("/api/portal/codex-managed-skills/install-from-thread-path", {
    method: "POST",
    json: {
      thread_id: input.threadId,
      path: input.path,
      prompt: input.prompt,
      mode_id: input.modeId,
      conflict_action: input.conflictAction
    }
  });
}

export async function fetchPortalManagedSkills(): Promise<{ skills: CodexManagedSkill[] }> {
  return api<{ skills: CodexManagedSkill[] }>("/api/portal/codex-managed-skills");
}

export async function uninstallPortalManagedSkill(input: {
  id: string;
  reason?: string;
}): Promise<{ skill: CodexManagedSkill }> {
  return api<{ skill: CodexManagedSkill }>(`/api/portal/codex-managed-skills/${encodeURIComponent(input.id)}/uninstall`, {
    method: "POST",
    json: { reason: input.reason }
  });
}

export async function fetchPortalManagedSkillSharing(id: string): Promise<ManagedSkillSharingState> {
  return api<ManagedSkillSharingState>(`/api/portal/codex-managed-skills/${encodeURIComponent(id)}/sharing`);
}

export async function updatePortalManagedSkillSharing(input: {
  id: string;
  userIds: string[];
}): Promise<ManagedSkillSharingState> {
  return api<ManagedSkillSharingState>(`/api/portal/codex-managed-skills/${encodeURIComponent(input.id)}/sharing`, {
    method: "PUT",
    json: { user_ids: input.userIds }
  });
}

export async function fetchPortalSkillDraft(id: string): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>(`/api/portal/skill-drafts/${encodeURIComponent(id)}`);
}

export async function revisePortalSkillDraft(id: string, instruction: string): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>(`/api/portal/skill-drafts/${encodeURIComponent(id)}/revise`, {
    method: "POST",
    json: { instruction }
  });
}

export async function createPortalSkillDraftNewVersion(id: string, instruction: string): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>(`/api/portal/skill-drafts/${encodeURIComponent(id)}/new-version`, {
    method: "POST",
    json: { instruction }
  });
}

export async function fetchAdminSkillDrafts(status?: string): Promise<{ drafts: CodexSkillDraft[] }> {
  const query = status && status !== "all" ? `?status=${encodeURIComponent(status)}` : "";
  return api<{ drafts: CodexSkillDraft[] }>(`/api/admin/codex-skill-drafts${query}`);
}

export async function fetchAdminSkillDraftDetail(id: string): Promise<{ draft: CodexSkillDraft; content: string }> {
  return api<{ draft: CodexSkillDraft; content: string }>(`/api/admin/codex-skill-drafts/${encodeURIComponent(id)}`);
}

export async function updateAdminSkillDraftMarkdown(id: string, content: string): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>(`/api/admin/codex-skill-drafts/${encodeURIComponent(id)}/skill-md`, {
    method: "PUT",
    json: { content }
  });
}

export async function reviewAdminSkillDraft(input: {
  id: string;
  action: "reject" | "changes_requested";
  note?: string;
}): Promise<{ draft: CodexSkillDraft }> {
  return api<{ draft: CodexSkillDraft }>(`/api/admin/codex-skill-drafts/${encodeURIComponent(input.id)}/review`, {
    method: "POST",
    json: {
      action: input.action,
      note: input.note
    }
  });
}

export async function publishAdminSkillDraft(input: {
  id: string;
  reviewNote?: string;
  activationPrompt?: string;
  skillPackageId?: string;
  agentModeIds?: string[];
}): Promise<{ draft: CodexSkillDraft; managedSkill: CodexManagedSkill }> {
  return api<{ draft: CodexSkillDraft; managedSkill: CodexManagedSkill }>(
    `/api/admin/codex-skill-drafts/${encodeURIComponent(input.id)}/publish`,
    {
      method: "POST",
      json: {
        review_note: input.reviewNote,
        activation_prompt: input.activationPrompt,
        skill_package_id: input.skillPackageId,
        agent_mode_ids: input.agentModeIds
      }
    }
  );
}

export async function fetchAdminManagedSkills(): Promise<{ skills: CodexManagedSkill[] }> {
  return api<{ skills: CodexManagedSkill[] }>("/api/admin/codex-managed-skills");
}

export async function updateAdminManagedSkillStatus(input: {
  id: string;
  status: "active" | "disabled" | "archived";
}): Promise<{ skill: CodexManagedSkill }> {
  return api<{ skill: CodexManagedSkill }>(`/api/admin/codex-managed-skills/${encodeURIComponent(input.id)}/status`, {
    method: "POST",
    json: { status: input.status }
  });
}

export async function removeAdminManagedSkill(input: {
  id: string;
  reason?: string;
}): Promise<{ skill: CodexManagedSkill }> {
  return api<{ skill: CodexManagedSkill }>(`/api/admin/codex-managed-skills/${encodeURIComponent(input.id)}/remove`, {
    method: "POST",
    json: { reason: input.reason }
  });
}

export async function shareAdminManagedSkill(input: {
  id: string;
  activationPrompt?: string;
  skillPackageId?: string;
  agentModeIds?: string[];
}): Promise<{ managedSkill: CodexManagedSkill; skillPackage?: unknown }> {
  return api<{ managedSkill: CodexManagedSkill; skillPackage?: unknown }>(
    `/api/admin/codex-managed-skills/${encodeURIComponent(input.id)}/share`,
    {
      method: "POST",
      json: {
        activation_prompt: input.activationPrompt,
        skill_package_id: input.skillPackageId,
        agent_mode_ids: input.agentModeIds
      }
    }
  );
}
