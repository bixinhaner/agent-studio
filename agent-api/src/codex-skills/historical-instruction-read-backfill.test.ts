import { describe, expect, it } from "vitest";

import {
  buildHistoricalInstructionReadPatches,
  parseHistoricalInstructionReadRollout,
  type HistoricalStoredMessage
} from "./historical-instruction-read-backfill.js";

function line(timestamp: string, type: string, payload: Record<string, unknown>): string {
  return JSON.stringify({ timestamp, type, payload });
}

function portalMessages(status: string = "complete"): HistoricalStoredMessage[] {
  return [
    {
      id: "user-db",
      externalId: "user-visible-id",
      role: "user",
      content: { id: "user-visible-id", role: "user", content: [{ type: "text", text: "help" }] },
      runConfig: { channel: "portal" },
      position: 0,
      createdAt: new Date("2026-08-11T10:00:00.000Z")
    },
    {
      id: "assistant-db",
      externalId: "assistant-visible-id",
      role: "assistant",
      parentId: "user-visible-id",
      content: {
        id: "assistant-visible-id",
        role: "assistant",
        status: { type: status },
        content: [{ type: "text", text: "done" }]
      },
      runConfig: {},
      position: 1,
      createdAt: new Date("2026-08-11T10:00:12.000Z")
    }
  ];
}

describe("historical instruction read backfill", () => {
  it("extracts selected Skill injections and automatic plugin reads from one rollout turn", () => {
    const input = [
      line("2026-08-11T10:00:01.000Z", "turn_context", {
        turn_id: "turn-1",
        cwd: "/var/lib/agent-studio/sessions/internal/user/agent/thread-thread-1"
      }),
      line("2026-08-11T10:00:01.100Z", "response_item", {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "<skill><name>private-help</name><path>/home/agentstudio/.codex/skills/user/private-help/SKILL.md</path>body</skill>"
        }]
      }),
      line("2026-08-11T10:00:04.000Z", "response_item", {
        type: "custom_tool_call",
        call_id: "call-1",
        input: "const r = await tools.exec_command({cmd:\"sed -n '1,200p' SKILL.md\",workdir:\"/home/agentstudio/.codex/plugins/cache/office/pdf/1.0/skills/pdf\"});"
      }),
      line("2026-08-11T10:00:04.500Z", "response_item", {
        type: "custom_tool_call_output",
        call_id: "call-1",
        output: [{ type: "input_text", text: "Script completed\n---\nname: pdf\n---" }]
      })
    ].join("\n");

    const result = parseHistoricalInstructionReadRollout(input, "rollout.jsonl");

    expect(result.invalidLines).toBe(0);
    expect(result.turns).toEqual([
      expect.objectContaining({
        threadId: "thread-1",
        turnId: "turn-1",
        sourceFile: "rollout.jsonl",
        reads: [
          expect.objectContaining({ name: "private-help", kind: "skill", trigger: "selected" }),
          expect.objectContaining({ name: "pdf", kind: "capability", trigger: "automatic" })
        ]
      })
    ]);
  });

  it("does not record a failed SKILL.md tool read", () => {
    const input = [
      line("2026-08-11T10:00:01.000Z", "turn_context", {
        turn_id: "turn-1",
        cwd: "/tmp/thread-thread-1"
      }),
      line("2026-08-11T10:00:02.000Z", "response_item", {
        type: "custom_tool_call",
        call_id: "call-1",
        input: "cat /home/agentstudio/.codex/skills/openai-docs/SKILL.md"
      }),
      line("2026-08-11T10:00:02.200Z", "response_item", {
        type: "custom_tool_call_output",
        call_id: "call-1",
        is_error: true,
        output: "Script failed with exit code 1"
      })
    ].join("\n");

    expect(parseHistoricalInstructionReadRollout(input).turns).toEqual([]);
  });

  it("matches a completed Portal assistant message and prepends the persisted data part", () => {
    const turns = parseHistoricalInstructionReadRollout([
      line("2026-08-11T10:00:01.000Z", "turn_context", {
        turn_id: "turn-1",
        cwd: "/tmp/thread-thread-1"
      }),
      line("2026-08-11T10:00:01.100Z", "response_item", {
        type: "message",
        role: "user",
        content: [{
          type: "input_text",
          text: "<skill><name>private-help</name><path>/skills/private-help/SKILL.md</path>body</skill>"
        }]
      })
    ].join("\n")).turns;

    const result = buildHistoricalInstructionReadPatches({
      threadId: "thread-1",
      turns,
      messages: portalMessages()
    });

    expect(result.patches).toHaveLength(1);
    expect(result.patches[0]?.content.content).toEqual([
      expect.objectContaining({ name: "codex_instruction_reads" }),
      { type: "text", text: "done" }
    ]);
  });

  it("skips existing markers and incomplete responses", () => {
    const turns = [{
      threadId: "thread-1",
      turnId: "turn-1",
      startedAt: "2026-08-11T10:00:01.000Z",
      reads: [{
        id: "instruction-read-skill-private-help",
        name: "private-help",
        kind: "skill" as const,
        trigger: "selected" as const,
        readAt: "2026-08-11T10:00:01.100Z"
      }]
    }];
    const existing = portalMessages();
    (existing[1]!.content as any).content.unshift({
      type: "data",
      name: "codex_instruction_reads",
      data: { reads: turns[0]!.reads }
    });
    const existingResult = buildHistoricalInstructionReadPatches({
      threadId: "thread-1",
      turns,
      messages: existing
    });
    const incompleteResult = buildHistoricalInstructionReadPatches({
      threadId: "thread-1",
      turns,
      messages: portalMessages("incomplete")
    });

    expect(existingResult.patches).toEqual([]);
    expect(existingResult.stats.alreadyMarkedMessages).toBe(1);
    expect(incompleteResult.patches).toEqual([]);
    expect(incompleteResult.stats.incompleteAssistantMessages).toBe(1);
  });

  it("does not guess when more than one completed assistant message fits a turn", () => {
    const messages = portalMessages();
    messages.push({
      ...messages[1]!,
      id: "assistant-db-2",
      externalId: "assistant-visible-id-2",
      createdAt: new Date("2026-08-11T10:00:13.000Z"),
      position: 2
    });
    const result = buildHistoricalInstructionReadPatches({
      threadId: "thread-1",
      turns: [{
        threadId: "thread-1",
        turnId: "turn-1",
        startedAt: "2026-08-11T10:00:01.000Z",
        reads: [{
          id: "instruction-read-skill-private-help",
          name: "private-help",
          kind: "skill",
          trigger: "selected",
          readAt: "2026-08-11T10:00:01.100Z"
        }]
      }],
      messages
    });

    expect(result.patches).toEqual([]);
    expect(result.stats.ambiguousTurns).toBe(1);
  });
});
