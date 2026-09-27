import { describe, expect, it } from "vitest";
import { processStepKey, summarizeAssistantProcess } from "./assistant-process-summary";

describe("summarizeAssistantProcess", () => {
  it("merges start/finish trace pairs into single steps", () => {
    const rows = [];
    for (let index = 0; index < 9; index += 1) {
      rows.push({ id: `r${index}a`, kind: "process", title: "Running workspace operation" });
      rows.push({ id: `r${index}b`, kind: "process", title: "Workspace operation completed" });
    }
    const summary = summarizeAssistantProcess([
      { type: "data", name: "codex_instruction_reads", data: { reads: [{ id: "a", name: "dingtalk-chat", kind: "skill" }] } },
      { type: "data", name: "codex_trace_batch", data: { rows } },
      { type: "text", text: "4 张图片均已成功发送给贵亚。" }
    ]);
    expect(summary.steps.length).toBe(9);
    expect(summary.steps[0].title).toBe("Workspace operation completed");
    expect(summary.skills).toEqual([{ id: "a", name: "dingtalk-chat", kind: "skill" }]);
    expect(summary.hasProcess).toBe(true);
  });

  it("keeps distinct steps and reports streaming commentary as live text", () => {
    const summary = summarizeAssistantProcess([
      {
        type: "data",
        name: "codex_commentary",
        data: { status: "streaming", entries: [{ id: "e1", lines: ["先读取站点规划状态", "再核对操作限制"], status: "streaming" }] }
      },
      {
        type: "data",
        name: "codex_trace_batch",
        data: {
          rows: [
            { id: "1", kind: "tool", title: "读取站点规划状态" },
            { id: "2", kind: "process", title: "核对操作限制" }
          ]
        }
      }
    ]);
    expect(summary.thinking).toBe(true);
    expect(summary.thoughts).toEqual(["先读取站点规划状态", "再核对操作限制"]);
    expect(summary.steps.map((step) => step.title)).toEqual(["读取站点规划状态", "核对操作限制"]);
    expect(summary.liveText).toBe("再核对操作限制");
  });

  it("flags errors and never merges them away", () => {
    const summary = summarizeAssistantProcess([
      { type: "data", name: "codex_process", data: { kind: "process", title: "Running workspace operation" } },
      { type: "data", name: "codex_process", data: { kind: "error", title: "Workspace operation completed" } }
    ]);
    expect(summary.hasError).toBe(true);
    expect(summary.steps.length).toBe(2);
  });

  it("returns no process for plain text answers", () => {
    const summary = summarizeAssistantProcess([{ type: "text", text: "hello" }]);
    expect(summary.hasProcess).toBe(false);
    expect(summary.liveText).toBe("");
  });

  it("normalizes running/completed wording", () => {
    expect(processStepKey("Running workspace operation")).toBe(processStepKey("Workspace operation completed"));
    expect(processStepKey("正在发送图片")).toBe(processStepKey("发送图片完成"));
  });
});
