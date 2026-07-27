import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConversationAuditMarkdown } from "../ConversationAuditView";

describe("ConversationAuditMarkdown", () => {
  it("renders agent-style LaTeX delimiters in conversation history", () => {
    const { container } = render(
      <ConversationAuditMarkdown
        text={[
          "面向 \\(\\tau\\) 的轻量短时预测。",
          "",
          "\\[",
          "\\mathbf H_{\\mathrm{FR1}}^{\\mathrm{UL}}(t) \\neq \\mathbf H_{\\mathrm{FR2}}^{\\mathrm{DL}}(t)",
          "\\]"
        ].join("\n")}
      />
    );

    expect(container.querySelectorAll(".katex").length).toBe(2);
    expect(container.querySelector(".katex-display")).toBeTruthy();
    expect(container.querySelector(".katex-error")).toBeNull();
  });

  it("opens bare external domains as external links instead of app routes", () => {
    render(<ConversationAuditMarkdown text="[DingTalk docs](open.dingtalk.com/document)" />);

    const link = screen.getByRole("link", { name: "DingTalk docs" });
    expect(link.getAttribute("href")).toBe("https://open.dingtalk.com/document");
    expect(link.getAttribute("target")).toBe("_blank");
  });

  it("renders safe inline data images", () => {
    const dataUrl =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";

    render(<ConversationAuditMarkdown text={`![tiny image](${dataUrl})`} />);

    const image = screen.getByRole("img", { name: "tiny image" });
    expect(image.getAttribute("src")).toBe(dataUrl);
  });

  it("resolves relative thread files through the admin file endpoint", () => {
    render(
      <ConversationAuditMarkdown
        text="[report](reports/weekly.pdf)"
        threadId="thread-123"
        workspace="/tmp/agent-studio/thread-thread-123"
      />
    );

    const openLink = screen.getByRole("link", { name: "Open" });
    expect(openLink.getAttribute("href")).toBe(
      "/api/admin/conversations/thread-123/files/content?path=reports%2Fweekly.pdf"
    );
  });

  it("renders admin conversation file endpoint images", () => {
    render(
      <ConversationAuditMarkdown
        text="![chart](/api/admin/conversations/thread-123/files/content?relative_path=chart.png)"
        threadId="thread-123"
        workspace="/tmp/agent-studio/thread-thread-123"
      />
    );

    const image = screen.getByRole("img", { name: "chart" });
    expect(image.getAttribute("src")).toBe(
      "/api/admin/conversations/thread-123/files/content?relative_path=chart.png"
    );
  });

  it("renders Codex file citations as compact reusable links without exposing raw directives", () => {
    const citation =
      ':codex-file-citation{path="/tmp/agent-studio/thread-thread-123/.agent-studio/uploads/thread-123/' +
      '1785117779460-d78fcf64a32c-招标文件[定稿](1).docx" artifact_kind="document" page_number="3"}';
    const { container } = render(
      <ConversationAuditMarkdown
        text={`结论来自招标文件。${citation}`}
        threadId="thread-123"
        workspace="/tmp/agent-studio/thread-thread-123"
      />
    );

    expect(container.textContent).not.toContain(":codex-file-citation");
    expect(container.textContent).toContain("上传文件引用 · 1 个文件 / 1 个位置");
    expect(container.textContent).toContain("招标文件[定稿](1).docx");
    const citationLinks = screen.getAllByRole("link", { name: "引用 1：招标文件[定稿](1).docx" });
    expect(citationLinks).toHaveLength(2);
    expect(citationLinks[0]?.getAttribute("href")).toBe(
      "/api/admin/conversations/thread-123/files/content?path=.agent-studio%2Fuploads%2Fthread-123%2F1785117779460-d78fcf64a32c-%E6%8B%9B%E6%A0%87%E6%96%87%E4%BB%B6%5B%E5%AE%9A%E7%A8%BF%5D%281%29.docx&preview=pdf#page=3"
    );
  });
});
