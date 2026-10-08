import { describe, expect, it } from "vitest";

import { CodexMemoryReadObserver } from "./memory-read-observer.js";

const HOME = "/srv/codex-homes/internal/user1/agent-mode-a-abcdef";

function command(cmd: string, options: { exit?: number; output?: string } = {}) {
  return {
    type: "item.completed",
    raw: {
      type: "item.completed",
      item: { type: "command_execution", command: cmd, exit_code: options.exit ?? 0, aggregated_output: options.output ?? "12: prefers tables" }
    }
  };
}

describe("CodexMemoryReadObserver", () => {
  it("marks a turn only once, when a successful command read the run's memory folder", () => {
    const observer = new CodexMemoryReadObserver({ codexHome: `${HOME}/` });
    expect(observer.contentPart()).toBeUndefined();
    expect(observer.push(command(`/bin/bash -lc "rg -n 'PPT|deck' ${HOME}/memories/MEMORY.md"`))).toBe(true);
    expect(observer.push(command(`cat ${HOME}/memories/rollout_summaries/a.md`))).toBe(false);
    expect(observer.contentPart()).toEqual({ type: "data", name: "agent_studio_memory_context", data: { used: true } });
  });

  it("ignores searches without matches, failed calls, other homes and unrelated files", () => {
    const observer = new CodexMemoryReadObserver({ codexHome: HOME });
    expect(observer.push(command(`rg -n 'nothing' ${HOME}/memories/MEMORY.md`, { exit: 1, output: "" }))).toBe(false);
    expect(observer.push(command(`cat ${HOME}/memories/MEMORY.md`, { output: "  " }))).toBe(false);
    expect(observer.push(command("cat /srv/codex-homes/internal/user2/agent-mode-a-abcdef/memories/MEMORY.md"))).toBe(false);
    expect(observer.push(command(`cat ${HOME}/memories-backup.txt ./memories/notes.md`))).toBe(false);
    expect(observer.push({ type: "item.started", raw: { type: "item.started", item: { type: "command_execution", command: `cat ${HOME}/memories/MEMORY.md` } } })).toBe(false);
    expect(observer.contentPart()).toBeUndefined();
  });

  it("detects $CODEX_HOME paths and tool calls with JSON-escaped arguments", () => {
    expect(new CodexMemoryReadObserver({ codexHome: HOME }).push(command('sed -n 1,80p "${CODEX_HOME}/memories/skills/ppt/SKILL.md"'))).toBe(true);
    const tool = new CodexMemoryReadObserver({ codexHome: HOME });
    expect(tool.push({
      type: "item.completed",
      raw: {
        type: "item.completed",
        item: { type: "mcp_tool_call", arguments: { path: `${HOME.replace(/\//g, "\\/")}\\/memories\\/MEMORY.md` }, result: { content: [{ text: "x" }] } }
      }
    })).toBe(true);
    expect(new CodexMemoryReadObserver({}).push(command(`cat ${HOME}/memories/MEMORY.md`))).toBe(false);
  });
});
