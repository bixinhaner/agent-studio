import { describe, expect, it } from "vitest";

import {
  buildExternalSkillCreatorPrompt,
  collectSkillRootPathsFromChanges,
  isSkillCreationIntent,
  toExternalSkillFileChangeData
} from "./SkillDraftStatusBlock";

describe("external Skill creation", () => {
  it("surfaces only generated SKILL.md files, re-rooted away from server paths", () => {
    const data = toExternalSkillFileChangeData({
      at: "2026-11-06T00:00:00.000Z",
      changes: [
        { path: "/usr/local/agent-studio/temp/workspaces/u1/thread-1/skill-drafts/alarm-triage/SKILL.md", kind: "add" },
        { path: "/usr/local/agent-studio/temp/workspaces/u1/thread-1/skill-drafts/alarm-triage/references/codes.md", kind: "add" },
        { path: "./skill-drafts/site-audit/SKILL.md", kind: "update" },
        { path: "/srv/thread-1/notes/SKILL.md", kind: "add" },
        { path: "/srv/thread-1/skill-drafts/removed/SKILL.md", kind: "delete" },
        { path: "/srv/thread-1/skill-drafts/../SKILL.md", kind: "add" },
        { path: "/srv/thread-1/report.docx", kind: "add" }
      ]
    });

    expect(data).toEqual({
      at: "2026-11-06T00:00:00.000Z",
      skill_only: true,
      changes: [
        { path: "skill-drafts/alarm-triage/SKILL.md", kind: "add" },
        { path: "skill-drafts/site-audit/SKILL.md", kind: "update" }
      ]
    });
    expect(collectSkillRootPathsFromChanges(
      data!.changes.map((change) => ({ ...change, displayPath: change.path, canPreview: false, canDownload: false }))
    )).toEqual(["skill-drafts/alarm-triage", "skill-drafts/site-audit"]);
  });

  it("drops file changes that contain no Skill", () => {
    expect(toExternalSkillFileChangeData({ changes: [{ path: "/srv/thread-1/report.docx", kind: "add" }] })).toBeUndefined();
    expect(toExternalSkillFileChangeData(undefined)).toBeUndefined();
  });

  it("asks for a reviewable summary without exposing paths or runtime names", () => {
    const prompt = buildExternalSkillCreatorPrompt("把告警排查流程做成 SOP");
    expect(prompt.startsWith("把告警排查流程做成 SOP")).toBe(true);
    expect(prompt).toContain("./skill-drafts/<skill-name>/");
    expect(prompt).toContain("Do not mention file system paths");
    expect(prompt).not.toMatch(/codex|CODEX_HOME|agent studio|bailey/i);
  });

  it("recognizes SOP requests as Skill creation", () => {
    expect(isSkillCreationIntent("把这个流程做成SOP")).toBe(true);
    expect(isSkillCreationIntent("Turn this checklist into an SOP")).toBe(true);
    expect(isSkillCreationIntent("把这个排查流程做成 sop")).toBe(true);
    expect(isSkillCreationIntent("帮我创建一个技能")).toBe(true);
    expect(isSkillCreationIntent("总结这份 SOP 文档")).toBe(false);
  });
});
