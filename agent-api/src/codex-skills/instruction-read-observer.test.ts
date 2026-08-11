import { describe, expect, it } from "vitest";

import { CodexInstructionReadObserver } from "./instruction-read-observer.js";

function commandEvent(input: { command: string; output?: string; exitCode?: number }) {
  return {
    type: "item.completed",
    raw: {
      item: {
        id: "command-1",
        type: "command_execution",
        command: input.command,
        aggregated_output: input.output ?? "# Skill instructions\nUse this workflow.",
        exit_code: input.exitCode ?? 0
      }
    }
  };
}

describe("CodexInstructionReadObserver", () => {
  it("records an explicitly selected private or shared Skill only after SKILL.md returns content", () => {
    const observer = new CodexInstructionReadObserver({
      selectedSkills: [{ name: "siteapp-surge-support", path: "/runtime/skills/siteapp-surge-support/SKILL.md" }],
      now: () => new Date("2026-08-12T02:03:04.000Z")
    });

    expect(observer.push(commandEvent({
      command: "sed -n '1,240p' /runtime/skills/siteapp-surge-support/SKILL.md"
    }))).toEqual([{
      id: "instruction-read-skill-siteapp-surge-support",
      name: "siteapp-surge-support",
      kind: "skill",
      trigger: "selected",
      readAt: "2026-08-12T02:03:04.000Z"
    }]);
  });

  it("classifies an automatically read plugin Skill as a capability", () => {
    const observer = new CodexInstructionReadObserver();
    expect(observer.push(commandEvent({
      command: "cat /var/lib/codex/plugins/cache/agentstudio-office/pdf/1.0.0/skills/pdf/SKILL.md"
    }))[0]).toMatchObject({
      name: "pdf",
      kind: "capability",
      trigger: "automatic"
    });
  });

  it("classifies an implicitly read system Skill as an automatic Skill", () => {
    const observer = new CodexInstructionReadObserver();
    expect(observer.push(commandEvent({
      command: "sed -n '1,220p' \"/var/lib/codex/skills/.system/openai-docs/SKILL.md\""
    }))[0]).toMatchObject({
      name: "openai-docs",
      kind: "skill",
      trigger: "automatic"
    });
  });

  it("does not report discovery, failed commands, empty reads, or duplicate reads", () => {
    const observer = new CodexInstructionReadObserver();
    expect(observer.push(commandEvent({ command: "find /var/lib/codex -name SKILL.md" }))).toEqual([]);
    expect(observer.push(commandEvent({ command: "cat /skills/private-one/SKILL.md", exitCode: 1 }))).toEqual([]);
    expect(observer.push(commandEvent({ command: "cat /skills/private-one/SKILL.md", output: "" }))).toEqual([]);
    expect(observer.push(commandEvent({ command: "cat /skills/private-one/SKILL.md" }))).toHaveLength(1);
    expect(observer.push(commandEvent({ command: "head -80 /skills/private-one/SKILL.md" }))).toEqual([]);
    expect(observer.contentPart()).toMatchObject({
      type: "data",
      name: "codex_instruction_reads",
      data: { reads: [{ name: "private-one" }] }
    });
  });
});
