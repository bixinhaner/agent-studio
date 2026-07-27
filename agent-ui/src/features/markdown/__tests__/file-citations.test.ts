import { describe, expect, it } from "vitest";

import {
  buildCodexFileCitationPreviewAnchor,
  parseCodexFileCitationHref,
  parseCodexFileCitationPreviewAnchor,
  projectCodexFileCitations
} from "../file-citations";

const workbookPath =
  "/var/lib/agent-studio/sessions/internal/user/agent/thread-thread-1/.agent-studio/uploads/thread-1/" +
  "1785117798875-8e071247530d-工程量清单.xlsx";
const documentPath =
  "/var/lib/agent-studio/sessions/internal/user/agent/thread-thread-1/.agent-studio/uploads/thread-1/" +
  "1785117779460-d78fcf64a32c-招标文件[定稿](1).docx";

function workbookCitation(sheet: string, range: string): string {
  return `:codex-file-citation{path="${workbookPath}" artifact_kind="workbook" sheet="${sheet}" range="${range}"}`;
}

function documentCitation(page: number): string {
  return `:codex-file-citation{path="${documentPath}" artifact_kind="document" page_number="${page}"}`;
}

describe("projectCodexFileCitations", () => {
  it("projects stable inline references and groups unique locations by file", () => {
    const result = projectCodexFileCitations(
      [
        `第一条结论。${workbookCitation("设备更新", "A2:T29")} ${workbookCitation("设备维护", "A2:S32")}`,
        "",
        `第二条结论。${documentCitation(3)} ${documentCitation(22)}`,
        "",
        `第三条结论复用证据。${documentCitation(3)}`
      ].join("\n"),
      "zh"
    );

    expect(result.citations).toHaveLength(4);
    expect(result.groups).toHaveLength(2);
    expect(result.markdown).not.toContain(":codex-file-citation");
    expect(result.markdown).toContain("第一条结论。[1]");
    expect(result.markdown).toContain("第二条结论。[3]");
    expect(result.markdown).toContain("第三条结论复用证据。[3]");
    expect(result.markdown).toContain("上传文件引用 · 2 个文件 / 4 个位置");
    expect(result.markdown).toContain("招标文件&#91;定稿&#93;(1).docx");
    expect(result.groups[0]?.citations.map((citation) => citation.id)).toEqual([1, 2]);
    expect(result.groups[1]?.citations.map((citation) => citation.id)).toEqual([3, 4]);
  });

  it("removes an exact duplicate in one paragraph but keeps its shared reference id later", () => {
    const citation = workbookCitation("设备更新", "A2:T29");
    const result = projectCodexFileCitations(`同一段。${citation} ${citation}\n\n另一段。${citation}`);

    expect(result.citations).toHaveLength(1);
    expect(result.markdown.split("[1](</__codex-file-citation").length - 1).toBe(2);
    expect(result.markdown).toContain("[1 · 设备更新 · A2:T29]");
  });

  it("does not project directives inside inline or fenced code", () => {
    const citation = documentCitation(3);
    const source = [`\`${citation}\``, "```text", citation, "```", `正文。${citation}`].join("\n");
    const result = projectCodexFileCitations(source);

    expect(result.citations).toHaveLength(1);
    expect(result.markdown).toContain(`\`${citation}\``);
    expect(result.markdown).toContain(`\`\`\`text\n${citation}\n\`\`\``);
    expect(result.markdown).toContain("正文。[1]");
  });

  it("hides an incomplete streaming directive instead of exposing implementation text", () => {
    const result = projectCodexFileCitations(
      `正在生成引用。:codex-file-citation{path="${documentPath}" artifact_kind="document"`
    );

    expect(result.markdown).toBe("正在生成引用。");
    expect(result.citations).toHaveLength(0);
  });

  it("round-trips citation links without exposing the server workspace prefix", () => {
    const result = projectCodexFileCitations(`结论。${documentCitation(3)}`);
    const linkMatch = result.markdown.match(/\[1\]\(<([^>]+)>\)/);
    const citation = parseCodexFileCitationHref(linkMatch?.[1] || "");

    expect(citation?.displayName).toBe("招标文件[定稿](1).docx");
    expect(citation?.previewPath).toBe(".agent-studio/uploads/thread-1/1785117779460-d78fcf64a32c-招标文件[定稿](1).docx");
    expect(linkMatch?.[1]).not.toContain("/var/lib/agent-studio");
  });
});

describe("file citation preview anchors", () => {
  it("preserves workbook sheet and range targets", () => {
    const anchor = buildCodexFileCitationPreviewAnchor({
      sheet: "管廊内设备更新与购置",
      range: "A2:T29"
    });

    expect(parseCodexFileCitationPreviewAnchor(anchor)).toEqual({
      sheet: "管廊内设备更新与购置",
      range: "A2:T29"
    });
  });

  it("preserves document page targets", () => {
    expect(parseCodexFileCitationPreviewAnchor("codex-file-citation?page_number=22")).toEqual({
      pageNumber: 22
    });
  });
});
