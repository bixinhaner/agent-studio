import { api } from "../../lib/api";
import type { CodexManagedSkill, CodexSkillDraft } from "./types";

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
