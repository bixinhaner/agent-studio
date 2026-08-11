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

function dynamicToolEvent(input: {
  arguments: unknown;
  output?: unknown;
  success?: boolean;
}) {
  return {
    type: "item.completed",
    raw: {
      item: {
        id: "dynamic-tool-1",
        type: "mcp_tool_call",
        server: "functions",
        tool: "exec",
        arguments: input.arguments,
        contentItems: input.output === undefined
          ? [{ type: "inputText", text: "# Skill instructions\nUse this workflow." }]
          : input.output,
        success: input.success ?? true,
        status: input.success === false ? "failed" : "completed"
      }
    }
  };
}

describe("CodexInstructionReadObserver", () => {
  it("records selected Skill instructions when the app-server starts the turn", () => {
    const observer = new CodexInstructionReadObserver({
      selectedSkills: [{ name: "siteapp-surge-support", path: "/runtime/skills/siteapp-surge-support/SKILL.md" }],
      now: () => new Date("2026-08-12T02:03:04.000Z")
    });

    expect(observer.push({ type: "turn.started", raw: { type: "turn.started" } })).toEqual([{
      id: "instruction-read-skill-siteapp-surge-support",
      name: "siteapp-surge-support",
      kind: "skill",
      trigger: "selected",
      readAt: "2026-08-12T02:03:04.000Z"
    }]);
    expect(observer.push({ type: "turn.started", raw: { type: "turn.started" } })).toEqual([]);
  });

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

  it("recognizes the production functions.exec event, including a relative SKILL.md", () => {
    const observer = new CodexInstructionReadObserver();
    expect(observer.push(dynamicToolEvent({
      arguments: `const r = await tools.exec_command({cmd:"sed -n '1,260p' SKILL.md",workdir:"/home/agentstudio/.codex/plugins/cache/agentstudio-office/pdf/1.0.0/skills/pdf"}); text(r.output);`
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
    expect(observer.push(dynamicToolEvent({
      arguments: { cmd: "find /skills -name SKILL.md", workdir: "/skills" }
    }))).toEqual([]);
    expect(observer.push(dynamicToolEvent({
      arguments: { cmd: "cat SKILL.md", workdir: "/skills/private-two" },
      success: false
    }))).toEqual([]);
    expect(observer.push(dynamicToolEvent({
      arguments: { cmd: "cat SKILL.md", workdir: "/skills/private-two" },
      output: []
    }))).toEqual([]);
    expect(observer.contentPart()).toMatchObject({
      type: "data",
      name: "codex_instruction_reads",
      data: { reads: [{ name: "private-one" }] }
    });
  });
});
