import { describe, expect, it } from "vitest";

import { stripAssistantControlDirectives } from "./control-directives";

describe("stripAssistantControlDirectives", () => {
  it("removes standalone inline visualization directives", () => {
    expect(
      stripAssistantControlDirectives(
        '结果如下：\n\n::codex-inline-vis{file="capability-duration-trend.html"}\n\n请查看右侧预览。'
      )
    ).toBe("结果如下：\n\n\n请查看右侧预览。");
  });

  it("removes a partially streamed directive line", () => {
    expect(stripAssistantControlDirectives("结果如下：\n::codex-inline-vis{file=\"capability")).toBe("结果如下：\n");
  });

  it("preserves directive examples inside fenced code blocks", () => {
    const markdown = [
      "示例：",
      "```text",
      '::codex-inline-vis{file="example.html"}',
      "```",
      "完成。"
    ].join("\n");

    expect(stripAssistantControlDirectives(markdown)).toBe(markdown);
  });

  it("does not alter ordinary Markdown", () => {
    const markdown = "## 报告\n\n- 文件已生成\n- 可以预览";
    expect(stripAssistantControlDirectives(markdown)).toBe(markdown);
  });
});
