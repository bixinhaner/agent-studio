import { describe, expect, it } from "vitest";
import { processStepKey, summarizeAssistantProcess } from "./assistant-process-summary";

describe("summarizeAssistantProcess", () => {
  it("merges start/finish pairs and counts by category", () => {
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
    expect(summary.counts.command).toBe(9);
    expect(summary.steps.every((step) => step.status === "done")).toBe(true);
    expect(summary.skills).toEqual([{ id: "a", name: "dingtalk-chat", kind: "skill" }]);
  });

  it("pairs web searches, keeps the query as subject and counts sources and duration", () => {
    const summary = summarizeAssistantProcess([
      { type: "data", name: "codex_process", data: { kind: "process", title: "Searching the web", at: "2026-09-28T01:00:00Z" } },
      { type: "data", name: "codex_process", data: { kind: "process", title: "Search completed", detail: "平平 福双 大熊猫 出生 ...", at: "2026-09-28T01:00:04Z" } },
      { type: "data", name: "codex_process", data: { kind: "process", title: "Searching the web", at: "2026-09-28T01:00:05Z" } },
      { type: "data", name: "codex_process", data: { kind: "process", title: "Search completed", detail: "大熊猫 平平 母亲", at: "2026-09-28T01:00:12Z" } },
      { type: "source", url: "https://a.example" },
      { type: "source", url: "https://b.example" },
      { type: "source", url: "https://a.example" }
    ]);
    expect(summary.steps.length).toBe(2);
    expect(summary.counts.search).toBe(2);
    expect(summary.steps[0].subject).toBe("平平 福双 大熊猫 出生");
    expect(summary.sourceCount).toBe(2);
    expect(summary.durationMs).toBe(12_000);
  });

  it("keeps an unfinished step running while the run is live", () => {
    const content = [
      { type: "data", name: "codex_commentary", data: { status: "streaming", entries: [{ id: "e1", lines: ["先查出生信息", "再梳理时间线"], status: "streaming" }] } },
      { type: "data", name: "codex_process", data: { kind: "process", title: "Searching the web" } }
    ];
    const live = summarizeAssistantProcess(content, { running: true });
    expect(live.thinking).toBe(true);
    expect(live.thoughts).toEqual(["先查出生信息", "再梳理时间线"]);
    expect(live.steps[0].status).toBe("running");
    expect(summarizeAssistantProcess(content).steps[0].status).toBe("done");
  });

  it("hides bookkeeping rows and keeps errors", () => {
    const summary = summarizeAssistantProcess([
      { type: "data", name: "codex_process", data: { kind: "process", title: "Analyzing context" } },
      { type: "data", name: "codex_process", data: { kind: "process", title: "Response completed" } },
      { type: "data", name: "codex_process", data: { kind: "error", title: "Needs attention", detail: "boom" } }
    ]);
    expect(summary.steps.map((step) => step.status)).toEqual(["error"]);
    expect(summary.hasError).toBe(true);
  });

  it("returns no process for plain text answers", () => {
    expect(summarizeAssistantProcess([{ type: "text", text: "hello" }]).hasProcess).toBe(false);
  });

  it("normalizes generic running/completed wording", () => {
    expect(processStepKey("Running workspace operation")).toBe(processStepKey("Workspace operation completed"));
    expect(processStepKey("正在发送图片")).toBe(processStepKey("发送图片完成"));
  });
});
