import { describe, expect, it } from "vitest";
import { attachmentReference, inlineAttachmentIds } from "./inline-attachments";
import { skillReference, parseInlineReferences, inlineSkillIds, inlineReferencePlainText, hasInlineComposerRequest } from "./inline-references";

describe("inline skills and files", () => {
  it("keeps distinct identities, order and escaped labels across persisted message text", () => {
    const text = `使用 ${skillReference("managed:设计", "设计[核心]\\v2")} 分析 ${attachmentReference("real-file", "方案.pptx")}。`;
    expect(parseInlineReferences(text).map(part => part.type)).toEqual(["text", "skill", "text", "attachment", "text"]);
    expect([...inlineSkillIds(text)]).toEqual(["managed:设计"]);
    expect([...inlineAttachmentIds(text)]).toEqual(["real-file"]);
    expect(inlineReferencePlainText(text)).toBe("使用 设计[核心]\\v2 分析 方案.pptx。");
  });
  it("does not interpret an attachment label containing skill syntax as an actual skill", () => {
    const text = attachmentReference("file", "[danger](skill:unknown).txt");
    expect(inlineSkillIds(text).size).toBe(0);
    expect(inlineReferencePlainText(text)).toBe("[danger](skill:unknown).txt");
  });
  it("leaves malformed references and ordinary URLs as literal text", () => {
    const text = "[bad](skill:%E0) [url](https://example.com)";
    expect(parseInlineReferences(text)).toEqual([{ type: "text", text }]);
  });
  it("does not enable sending with only selected skills, but still accepts files or prose", () => {
    const skills = `${skillReference("one", "first")} ${skillReference("two", "second")}\n`;
    expect(hasInlineComposerRequest(skills)).toBe(false);
    expect(hasInlineComposerRequest(skills + "分析一下")).toBe(true);
    expect(hasInlineComposerRequest(skills, 1)).toBe(true);
    expect(hasInlineComposerRequest(attachmentReference("file", "test.md"))).toBe(true);
  });
});
