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
    expect(isSkillCreationIntent("那帮更新到skills")).toBe(true);
    expect(isSkillCreationIntent("小区无法激活的skills 也来一份")).toBe(true);
    expect(isSkillCreationIntent("新做一个skills 峰值业务不达标")).toBe(true);
    expect(isSkillCreationIntent("给我安装这个skills")).toBe(true);
    expect(isSkillCreationIntent("[ran-dl-throughput-analysis](skill:managed%3Acmwm194fs003jp1x8fu28a2z0) 使用这个skills 分析下")).toBe(false);
    expect(isSkillCreationIntent("[ran-dl](skill:managed%3Aabc) 看下要不要优化这个参数")).toBe(false);
  });
});
