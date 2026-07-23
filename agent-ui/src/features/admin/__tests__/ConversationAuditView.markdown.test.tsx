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
});
